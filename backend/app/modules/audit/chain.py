"""Tamper-evident audit trail (blueprint SOL-13, §14.6).

Each entry stores hash = SHA-256(prev_hash || canonical_json(entry)). Writers serialise on a transaction-scoped
advisory lock, so the chain has one order. Checkpoints sign a Merkle root over a range of entry hashes with an
Ed25519 key held outside the database; the verifier recomputes the chain and checks every checkpoint.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings

GENESIS = b"\x00" * 32
_LOCK_KEY = 7_326_211  # arbitrary constant: the audit chain's advisory lock id


def _canonical(
    seq: int,
    at: dt.datetime,
    actor_id: str | None,
    actor_unit_id: str | None,
    action: str,
    entity_type: str | None,
    entity_id: str | None,
    payload: dict[str, Any],
) -> bytes:
    body = {
        "seq": seq,
        "at": at.astimezone(dt.UTC).isoformat(timespec="microseconds"),
        "actor_id": actor_id,
        "actor_unit_id": actor_unit_id,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "payload": payload,
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode()


def entry_hash(prev_hash: bytes, canonical: bytes) -> bytes:
    return hashlib.sha256(prev_hash + canonical).digest()


def _json_safe(payload: dict[str, Any]) -> dict[str, Any]:
    # Round-trip through JSON so what we hash is exactly what JSONB stores and returns.
    return json.loads(json.dumps(payload, default=str))


def record(
    db: Session,
    action: str,
    *,
    actor_id: uuid.UUID | None = None,
    actor_unit_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: Any = None,
    payload: dict[str, Any] | None = None,
) -> int:
    """Append one audit entry inside the caller's transaction. Returns its sequence number."""
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    last = db.execute(text("SELECT seq, hash FROM audit_event ORDER BY seq DESC LIMIT 1")).first()
    seq = (last.seq + 1) if last else 1
    prev = bytes(last.hash) if last else GENESIS
    at = dt.datetime.now(dt.UTC)
    body = _json_safe(payload or {})
    aid = str(actor_id) if actor_id else None
    auid = str(actor_unit_id) if actor_unit_id else None
    eid = str(entity_id) if entity_id is not None else None
    digest = entry_hash(prev, _canonical(seq, at, aid, auid, action, entity_type, eid, body))
    db.execute(
        text(
            "INSERT INTO audit_event (seq, at, actor_id, actor_unit_id, action, entity_type, entity_id, payload, "
            "prev_hash, hash) VALUES (:seq, :at, :a, :au, :act, :et, :eid, CAST(:p AS jsonb), :prev, :h)"
        ),
        {
            "seq": seq,
            "at": at,
            "a": aid,
            "au": auid,
            "act": action,
            "et": entity_type,
            "eid": eid,
            "p": json.dumps(body),
            "prev": prev,
            "h": digest,
        },
    )
    return seq


def merkle_root(leaves: list[bytes]) -> bytes:
    if not leaves:
        return GENESIS
    level = list(leaves)
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [hashlib.sha256(b"\x01" + level[i] + level[i + 1]).digest() for i in range(0, len(level), 2)]
    return level[0]


@lru_cache
def _signing_key() -> Ed25519PrivateKey:
    seed = get_settings().audit_signing_key.get_secret_value()
    if not seed:
        raise RuntimeError("AUDIT_SIGNING_KEY is not set")
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(seed))


def public_key() -> Ed25519PublicKey:
    return _signing_key().public_key()


def key_id() -> str:
    raw = public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return hashlib.sha256(raw).hexdigest()[:16]


def create_checkpoint(db: Session) -> dict[str, Any] | None:
    """Sign a Merkle root over entries added since the last checkpoint. Returns None if nothing new."""
    last = db.execute(text("SELECT upto_seq FROM audit_checkpoint ORDER BY id DESC LIMIT 1")).scalar()
    start = (last or 0) + 1
    rows = db.execute(text("SELECT seq, hash FROM audit_event WHERE seq >= :s ORDER BY seq"), {"s": start}).all()
    if not rows:
        return None
    root = merkle_root([bytes(r.hash) for r in rows])
    head = bytes(rows[-1].hash)
    upto = rows[-1].seq
    message = f"{start}:{upto}:".encode() + root + head
    signature = _signing_key().sign(message)
    db.execute(
        text(
            "INSERT INTO audit_checkpoint (from_seq, upto_seq, merkle_root, chain_head, signature, key_id) "
            "VALUES (:f, :u, :r, :h, :s, :k)"
        ),
        {"f": start, "u": upto, "r": root, "h": head, "s": signature, "k": key_id()},
    )
    return {"from_seq": start, "upto_seq": upto, "merkle_root": root.hex(), "key_id": key_id()}


@dataclass
class VerifyResult:
    ok: bool
    entries: int
    checkpoints: int
    first_broken_seq: int | None = None
    problem: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "entries": self.entries,
            "checkpoints": self.checkpoints,
            "first_broken_seq": self.first_broken_seq,
            "problem": self.problem,
        }


def verify(db: Session, batch: int = 5000) -> VerifyResult:
    """Recompute every hash in order and check every signed checkpoint. O(n)."""
    prev = GENESIS
    expected_seq = 1
    count = 0
    hashes: dict[int, bytes] = {}
    after = 0
    while True:
        rows = db.execute(
            text(
                "SELECT seq, at, actor_id, actor_unit_id, action, entity_type, entity_id, payload, prev_hash, hash "
                "FROM audit_event WHERE seq > :after ORDER BY seq LIMIT :n"
            ),
            {"after": after, "n": batch},
        ).all()
        if not rows:
            break
        for r in rows:
            if r.seq != expected_seq:
                return VerifyResult(False, count, 0, expected_seq, f"Entry {expected_seq} is missing.")
            if bytes(r.prev_hash) != prev:
                return VerifyResult(False, count, 0, r.seq, f"Entry {r.seq} does not link to entry {r.seq - 1}.")
            canonical = _canonical(
                r.seq,
                r.at,
                str(r.actor_id) if r.actor_id else None,
                str(r.actor_unit_id) if r.actor_unit_id else None,
                r.action,
                r.entity_type,
                r.entity_id,
                r.payload,
            )
            digest = entry_hash(prev, canonical)
            if digest != bytes(r.hash):
                return VerifyResult(False, count, 0, r.seq, f"Entry {r.seq} was altered after it was written.")
            hashes[r.seq] = digest
            prev = digest
            expected_seq += 1
            count += 1
        after = rows[-1].seq

    pub = public_key()
    cps = db.execute(
        text("SELECT from_seq, upto_seq, merkle_root, chain_head, signature FROM audit_checkpoint ORDER BY id")
    ).all()
    for cp in cps:
        leaves = [hashes.get(s) for s in range(cp.from_seq, cp.upto_seq + 1)]
        if any(h is None for h in leaves):
            return VerifyResult(
                False,
                count,
                len(cps),
                cp.from_seq,
                f"Entries {cp.from_seq}–{cp.upto_seq} covered by a checkpoint are missing.",
            )
        root = merkle_root(leaves)  # type: ignore[arg-type]
        if root != bytes(cp.merkle_root) or leaves[-1] != bytes(cp.chain_head):
            return VerifyResult(
                False,
                count,
                len(cps),
                cp.from_seq,
                f"Entries {cp.from_seq}–{cp.upto_seq} no longer match their signed checkpoint.",
            )
        try:
            pub.verify(bytes(cp.signature), f"{cp.from_seq}:{cp.upto_seq}:".encode() + root + leaves[-1])
        except InvalidSignature:
            return VerifyResult(False, count, len(cps), cp.from_seq, "A checkpoint signature is invalid.")
    return VerifyResult(True, count, len(cps))
