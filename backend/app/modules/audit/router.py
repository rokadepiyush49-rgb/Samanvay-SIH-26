"""Audit trail search, chain verification and checkpoint signing."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.modules.audit import chain
from app.modules.auth.deps import current_user
from app.modules.policy.roles import CurrentUser, Role

router = APIRouter(prefix="/audit", tags=["audit"])
AUDIT_ROLES = {Role.AUDITOR, Role.SYS_ADMIN}


@router.get("")
def search(
    entity_type: str | None = None,
    entity_id: str | None = None,
    action: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    before: int | None = None,
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    user.require(AUDIT_ROLES, "read the audit trail")
    where, p = [], {"n": limit}
    if entity_type:
        where.append("a.entity_type = :et")
        p["et"] = entity_type
    if entity_id:
        where.append("a.entity_id = :eid")
        p["eid"] = entity_id
    if action:
        where.append("a.action LIKE :act")
        p["act"] = action.rstrip("*") + "%"
    if before:
        where.append("a.seq < :before")
        p["before"] = before
    sql = (
        "SELECT a.seq, a.at, a.action, a.entity_type, a.entity_id, a.payload, encode(a.hash, 'hex') AS hash, "
        "u.full_name AS actor, un.code AS unit FROM audit_event a LEFT JOIN app_user u ON u.id = a.actor_id "
        "LEFT JOIN unit un ON un.id = a.actor_unit_id "
        + ("WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY a.seq DESC LIMIT :n"
    )
    rows = db.execute(text(sql), p).all()
    head = db.execute(text("SELECT max(seq) FROM audit_event")).scalar()
    cp = db.execute(text("SELECT upto_seq, created_at, key_id FROM audit_checkpoint ORDER BY id DESC LIMIT 1")).first()
    return {
        "items": [{**dict(r._mapping), "at": r.at.isoformat()} for r in rows],
        "head_seq": head,
        "last_checkpoint": {"upto_seq": cp.upto_seq, "at": cp.created_at.isoformat(), "key_id": cp.key_id}
        if cp
        else None,
    }


@router.post("/verify")
def verify(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require(AUDIT_ROLES, "verify the audit chain")
    result = chain.verify(db).as_dict()
    chain.record(
        db,
        "audit.verified",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="audit",
        entity_id="chain",
        payload={"ok": result["ok"], "entries": result["entries"], "first_broken_seq": result["first_broken_seq"]},
    )
    db.commit()
    return {**result, "public_key_id": chain.key_id()}


@router.post("/checkpoint")
def checkpoint(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require({Role.SYS_ADMIN}, "sign audit checkpoints")
    cp = chain.create_checkpoint(db)
    db.commit()
    return cp or {"note": "No new entries since the last checkpoint."}
