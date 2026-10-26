"""Matching job: candidates → pair scores → typed case_link proposals → alert policy (blueprint SOL-04).

Runs in the worker with the BYPASSRLS role: overlaps must be found across all units. What reaches people is filtered
by recipient: links that involve a sealed case never open a cross-unit card; the guard reports them as
"restricted matter exists".
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import CaseLink
from app.modules.matching import scoring
from app.modules.matching.normalize import extract_entities, similarity_text
from app.modules.matching.similarity import get_backend, text_hash
from app.modules.sla import notify as nt

log = logging.getLogger("samanvay.matching")

_CASE_COLUMNS = """
  c.id, c.case_no, c.institution_id, c.category_code, c.status, c.holding_unit_id, c.received_on, c.complainant_hmac,
  c.refs, c.cpgrams_no, c.court_case_no, c.unit_file_no, c.language, c.sensitivity, c.disposed_on,
  c.holding_officer_id, cc.subject, cc.body, c.institution_raw, i.name AS inst_name, i.city AS inst_city,
  (SELECT (x->>'institution_id')::uuid FROM jsonb_array_elements(coalesce(c.refs->'institution_candidates', '[]')) x
    WHERE (x->>'probability')::float >= 0.6 ORDER BY (x->>'probability')::float DESC LIMIT 1) AS probable_id
"""

_CANDIDATES = text(
    f"""
    SELECT {_CASE_COLUMNS}
    FROM case_record c JOIN case_content cc ON cc.case_id = c.id LEFT JOIN institution i ON i.id = c.institution_id
    WHERE c.id <> :id
      AND (c.status NOT IN ('DISPOSED', 'REJECTED_AT_INTAKE') OR c.disposed_on >= :since OR c.updated_at >= :since)
      AND (
        (CAST(:inst AS uuid) IS NOT NULL AND c.institution_id = CAST(:inst AS uuid))
        OR (CAST(:probable AS uuid) IS NOT NULL AND c.institution_id = CAST(:probable AS uuid))
        OR (CAST(:hmac AS text) IS NOT NULL AND c.complainant_hmac = CAST(:hmac AS text))
        OR (c.cpgrams_no = ANY(:cpgrams)) OR (c.court_case_no = ANY(:courts))
      )
    LIMIT 500
    """
)


def _view(r) -> scoring.CaseView:
    refs = r.refs or {}
    body = f"{r.subject}\n{r.body}"
    return scoring.CaseView(
        id=r.id,
        case_no=r.case_no,
        institution_id=r.institution_id,
        probable_institution_id=r.probable_id,
        category_code=r.category_code,
        status=r.status,
        holding_unit_id=r.holding_unit_id,
        received_on=r.received_on,
        complainant_hmac=r.complainant_hmac,
        hard_refs=scoring.hard_refs_of(refs, r.cpgrams_no, r.court_case_no, r.unit_file_no),
        entities=extract_entities(body),
        text=body,
        language=r.language,
        sensitivity=r.sensitivity,
        sim_text=similarity_text(body, [r.institution_raw, r.inst_name], [r.inst_city]),
        extra={"holding_officer_id": r.holding_officer_id},
    )


def load_compat(db: Session) -> dict[tuple[str, str], float]:
    return {(r.a, r.b): float(r.score) for r in db.execute(text("SELECT a, b, score FROM category_compat")).all()}


def active_model(db: Session) -> tuple[str, dict]:
    row = db.execute(
        text("SELECT version, params FROM matching_model WHERE is_active ORDER BY created_at DESC LIMIT 1")
    ).first()
    return (row.version, dict(row.params)) if row else ("fs-rules-v1", {"a": 1.0, "b": -4.0})


def _attach_vectors(db: Session, backend, views: list[scoring.CaseView]) -> None:
    if not hasattr(backend, "vectors"):
        return
    ids = [v.id for v in views]
    cached = {
        r.case_id: (r.text_hash, list(r.vector))
        for r in db.execute(
            text("SELECT case_id, text_hash, vector FROM text_vector WHERE case_id = ANY(:ids) AND model = :m"),
            {"ids": ids, "m": backend.name},
        ).all()
    }
    missing = []
    for v in views:
        h = text_hash(v.sim_text or v.text)
        hit = cached.get(v.id)
        if hit and hit[0] == h:
            v.vector = hit[1]
        else:
            missing.append((v, h))
    if missing:
        vectors = backend.vectors([v.sim_text or v.text for v, _ in missing])
        for (v, h), vec in zip(missing, vectors, strict=True):
            v.vector = vec
            db.execute(
                text(
                    "INSERT INTO text_vector (case_id, model, text_hash, vector) VALUES (:c, :m, :h, :v) "
                    "ON CONFLICT (case_id) DO UPDATE SET model = EXCLUDED.model, text_hash = EXCLUDED.text_hash, "
                    "vector = EXCLUDED.vector"
                ),
                {"c": v.id, "m": backend.name, "h": h, "v": vec},
            )


def match_case(db: Session, case_id: uuid.UUID) -> dict:
    row = db.execute(
        text(
            f"SELECT {_CASE_COLUMNS} FROM case_record c JOIN case_content cc ON cc.case_id = c.id "
            "LEFT JOIN institution i ON i.id = c.institution_id WHERE c.id = :id"
        ),
        {"id": case_id},
    ).first()
    if row is None:
        return {"skipped": "case not found"}
    me = _view(row)
    hard = me.hard_refs
    since = dt.date.today() - dt.timedelta(days=365)
    rows = db.execute(
        _CANDIDATES,
        {
            "id": case_id,
            "since": since,
            "inst": me.institution_id,
            "probable": me.probable_institution_id,
            "hmac": me.complainant_hmac,
            "cpgrams": [h.split(":", 1)[1] for h in hard if h.startswith("cpgrams:")] or [""],
            "courts": [h.split(":", 1)[1] for h in hard if h.startswith("court:")] or [""],
        },
    ).all()
    others = [_view(r) for r in rows]
    backend = None
    note = None
    try:
        backend = get_backend()
        _attach_vectors(db, backend, [me, *others])
    except Exception as exc:  # noqa: BLE001 - degrade to rules-only scoring, never fail the job on the text service
        log.warning("text similarity unavailable: %s", exc)
        backend, note = None, str(exc)
    compat = load_compat(db)
    version, params = active_model(db)
    model_version = f"{version}+{backend.name if backend else 'rules-only'}"

    stats = {
        "candidates": len(others),
        "links": 0,
        "alerts": 0,
        "backend": backend.name if backend else None,
        "note": note,
    }
    for other in others:
        ps = scoring.score_pair(me, other, compat, backend, params)
        if ps.link_type is None:
            continue
        stats["links"] += 1
        link, is_new_alert = _upsert_link(db, me, other, ps, model_version)
        if is_new_alert:
            stats["alerts"] += _alert(db, link, me, other, ps)
    db.execute(text("UPDATE case_record SET matched_at = now() WHERE id = :id"), {"id": case_id})
    return stats


def _upsert_link(
    db: Session, a: scoring.CaseView, b: scoring.CaseView, ps: scoring.PairScore, model_version: str
) -> tuple[CaseLink, bool]:
    left, right = sorted((a.id, b.id))
    link = db.query(CaseLink).filter(CaseLink.left_id == left, CaseLink.right_id == right).with_for_update().first()
    now = dt.datetime.now(dt.UTC)
    if link is None:
        link = CaseLink(
            id=uuid.uuid4(),
            left_id=left,
            right_id=right,
            link_type=ps.link_type,
            probability=ps.probability,
            score=ps.score,
            reasons=ps.reasons,
            hard_keys=ps.hard_keys,
            model_version=model_version,
            status="PROPOSED",
        )
        db.add(link)
        db.flush()
        return link, scoring.needs_alert(ps.link_type, a, b)
    was_alerting = scoring.needs_alert(link.link_type, a, b)
    new_evidence = bool(set(ps.hard_keys) - set(link.hard_keys or []))
    link.probability, link.score, link.reasons = ps.probability, ps.score, ps.reasons
    link.hard_keys = sorted(set(link.hard_keys or []) | set(ps.hard_keys))
    link.model_version, link.updated_at = model_version, now
    if link.status == "CONFIRMED":
        return link, False
    if link.status == "REJECTED":
        # Rejected pairs stay quiet unless a new hard reference appears (blueprint SOL-05 acceptance criterion).
        if not new_evidence:
            return link, False
        link.status = "PROPOSED"
    link.link_type = ps.link_type
    needs = scoring.needs_alert(ps.link_type, a, b)
    return link, needs and (not was_alerting or new_evidence)


def _alert(db: Session, link: CaseLink, a: scoring.CaseView, b: scoring.CaseView, ps: scoring.PairScore) -> int:
    from app.modules.coordination.service import (
        open_coordination,  # import here: coordination imports case module
    )

    if "SEALED" in (a.sensitivity, b.sensitivity):
        sealed = a if a.sensitivity == "SEALED" else b
        other = b if sealed is a else a
        recipients = [
            sealed.extra.get("holding_officer_id"),
            *nt.unit_heads(db, sealed.holding_unit_id),
            *nt.users_with_role(db, "NODAL_OFFICER"),
        ]
        return nt.notify(
            db,
            recipients,
            family="OVERLAP",
            severity="WARNING",
            title=f"Sealed matter {sealed.case_no} overlaps {other.case_no}",
            body="The other unit has not been told. Coordinate through the nodal officer.",
            link=nt.case_link(sealed.case_no),
            case_id=sealed.id,
            key=f"link:{link.id}:sealed",
        )
    if a.holding_unit_id == b.holding_unit_id and ps.link_type == "D":
        return 0
    open_coordination(db, link, None, reason=f"auto:{ps.link_type}")
    return 1


def notify_related_digest(db: Session) -> int:
    """Daily digest for R-type links (no immediate alert by design)."""
    rows = db.execute(
        text(
            """
            SELECT l.id, a.case_no AS a_no, b.case_no AS b_no, a.holding_officer_id AS a_off,
                   b.holding_officer_id AS b_off, a.id AS a_id, b.id AS b_id
            FROM case_link l JOIN case_record a ON a.id = l.left_id JOIN case_record b ON b.id = l.right_id
            WHERE l.link_type = 'R' AND l.status = 'PROPOSED' AND l.created_at >= now() - interval '1 day'
              AND a.sensitivity <> 'SEALED' AND b.sensitivity <> 'SEALED'
            """
        )
    ).all()
    sent = 0
    for r in rows:
        sent += nt.notify(
            db,
            [r.a_off],
            family="OVERLAP",
            title=f"Related case found for {r.a_no}: {r.b_no}",
            link=nt.case_link(r.a_no),
            case_id=r.a_id,
            key=f"link:{r.id}:digest",
        )
        sent += nt.notify(
            db,
            [r.b_off],
            family="OVERLAP",
            title=f"Related case found for {r.b_no}: {r.a_no}",
            link=nt.case_link(r.b_no),
            case_id=r.b_id,
            key=f"link:{r.id}:digest",
        )
    return sent
