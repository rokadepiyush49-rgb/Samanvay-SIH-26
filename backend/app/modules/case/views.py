"""Read models for cases: list rows (metadata tier) and the case workspace (shaped by visibility tier)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import crypto
from app.models import CaseRecord
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.case.service import allowed_actions, has_full_access
from app.modules.matching.scoring import PS_PHRASE, TYPE_LABELS
from app.modules.policy.roles import CurrentUser
from app.modules.search.query import CaseFilters, build_where, decode_cursor, encode_cursor, parse_tokens
from app.modules.sla.calendar import get_calendar, today_ist

_LIST_SELECT = """
SELECT c.id, c.case_no, c.channel, c.source_ref, c.status, c.sensitivity, c.received_on, c.expected_disposal,
       c.escalated, c.last_action, c.last_action_at, c.next_action, c.next_action_due, c.resolution_status,
       c.institution_raw, c.category_code, cat.name AS category_name, cat.group_code,
       u.code AS unit_code, u.name AS unit_name, off.full_name AS officer_name, c.holding_officer_id,
       i.id AS inst_id, i.permanent_id, i.name AS inst_name, i.city AS inst_city, c.region_id,
       cc.subject AS subject,
       (SELECT count(*) FROM case_link l WHERE (l.left_id = c.id OR l.right_id = c.id) AND l.status = 'PROPOSED'
          AND l.link_type = 'P') AS p_open,
       (SELECT count(*) FROM case_link l WHERE (l.left_id = c.id OR l.right_id = c.id) AND l.status = 'PROPOSED'
          AND l.link_type IN ('D', 'R')) AS dr_open,
       (SELECT tu.code FROM transfer t JOIN unit tu ON tu.id = t.to_unit_id WHERE t.case_id = c.id
          AND t.status = 'PROPOSED') AS transfer_to
FROM case_record c
JOIN unit u ON u.id = c.holding_unit_id
JOIN category cat ON cat.code = c.category_code
LEFT JOIN institution i ON i.id = c.institution_id
LEFT JOIN app_user off ON off.id = c.holding_officer_id
LEFT JOIN case_content cc ON cc.case_id = c.id
"""

_COUNT_SELECT = """
SELECT count(*) FROM case_record c
JOIN unit u ON u.id = c.holding_unit_id
LEFT JOIN institution i ON i.id = c.institution_id
"""
# Joined only for free-text queries: evaluating content RLS for every row is the expensive part of a count.
_COUNT_CONTENT_JOIN = " LEFT JOIN case_content cc ON cc.case_id = c.id"


def _row(r, today: dt.date, cal) -> dict[str, Any]:
    open_ = r.status not in fsm.TERMINAL
    wd_left = cal.working_days_between(today, r.expected_disposal) if (r.expected_disposal and open_) else None
    return {
        "id": str(r.id),
        "case_no": r.case_no,
        "channel": r.channel,
        "source_ref": r.source_ref,
        "status": r.status,
        "status_label": fsm.STATUS_LABELS.get(r.status, r.status),
        "bucket": fsm.ps_bucket(r.status),
        "sensitivity": r.sensitivity,
        "received_on": r.received_on.isoformat(),
        "expected_disposal": r.expected_disposal.isoformat() if r.expected_disposal else None,
        "working_days_left": wd_left,
        "overdue": bool(open_ and r.expected_disposal and r.expected_disposal < today),
        "escalated": r.escalated,
        "last_action": r.last_action,
        "last_action_at": r.last_action_at.isoformat() if r.last_action_at else None,
        "next_action": r.next_action,
        "next_action_due": r.next_action_due.isoformat() if r.next_action_due else None,
        "resolution_status": r.resolution_status,
        "institution": {"id": str(r.inst_id), "permanent_id": r.permanent_id, "name": r.inst_name, "city": r.inst_city}
        if r.inst_id
        else None,
        "institution_raw": r.institution_raw,
        "category": {"code": r.category_code, "name": r.category_name, "group": r.group_code},
        "holding_unit": {"code": r.unit_code, "name": r.unit_name},
        "holding_officer": {"id": str(r.holding_officer_id), "name": r.officer_name} if r.holding_officer_id else None,
        "region_id": r.region_id,
        "subject": r.subject,  # NULL unless the caller has full access (RLS on case_content)
        "full_access": r.subject is not None,
        "overlaps": {"parallel_open": r.p_open, "other_open": r.dr_open},
        "transfer_to": r.transfer_to,
    }


def list_cases(
    db: Session,
    user: CurrentUser,
    f: CaseFilters,
    *,
    limit: int = 50,
    cursor: str | None = None,
    order: str = "received",
) -> dict[str, Any]:
    f = parse_tokens(f)
    today = today_ist()
    where, params = build_where(f, str(user.id), today)
    count_sql = (
        _COUNT_SELECT + (_COUNT_CONTENT_JOIN if f.q else "") + (" WHERE " + " AND ".join(where) if where else "")
    )
    total = db.execute(text(count_sql), params).scalar_one()
    page_where = list(where)
    cur = decode_cursor(cursor)
    if order == "due":
        order_sql = " ORDER BY c.expected_disposal ASC NULLS LAST, c.id ASC"
        offset = int(cursor) if cursor and cursor.isdigit() else 0
        sql = (
            _LIST_SELECT
            + (" WHERE " + " AND ".join(page_where) if page_where else "")
            + order_sql
            + " LIMIT :limit OFFSET :offset"
        )
        rows = db.execute(text(sql), {**params, "limit": limit + 1, "offset": offset}).all()
        next_cursor = str(offset + limit) if len(rows) > limit else None
    else:
        if cur:
            page_where.append("(c.received_on, c.id) < (:cur_day, CAST(:cur_id AS uuid))")
            params.update({"cur_day": cur[0], "cur_id": cur[1]})
        sql = (
            _LIST_SELECT
            + (" WHERE " + " AND ".join(page_where) if page_where else "")
            + " ORDER BY c.received_on DESC, c.id DESC LIMIT :limit"
        )
        rows = db.execute(text(sql), {**params, "limit": limit + 1}).all()
        next_cursor = encode_cursor(rows[limit - 1].received_on, str(rows[limit - 1].id)) if len(rows) > limit else None
    cal = get_calendar(db)
    return {
        "items": [_row(r, today, cal) for r in rows[:limit]],
        "total": total,
        "next_cursor": next_cursor,
        "as_of": dt.datetime.now(dt.UTC).isoformat(),
    }


def _user_names(db: Session, ids: set) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = db.execute(text("SELECT id, full_name FROM app_user WHERE id = ANY(:ids)"), {"ids": list(ids)}).all()
    return {str(r.id): r.full_name for r in rows}


def _unit_codes(db: Session) -> dict[str, str]:
    return {str(r.id): r.code for r in db.execute(text("SELECT id, code FROM unit")).all()}


METADATA_EVENT_TYPES = {
    "RECEIVED",
    "STATUS_CHANGED",
    "ACTION",
    "TRANSFER_PROPOSED",
    "TRANSFER_ACCEPTED",
    "TRANSFER_RETURNED",
    "ASSIGNED",
    "COORDINATION_OPENED",
    "COORDINATION_DECIDED",
    "ESCALATED",
    "SLA_ASSIGNED",
    "INSTITUTION_RESOLVED",
}


def case_detail(db: Session, user: CurrentUser, case: CaseRecord) -> dict[str, Any]:
    full = has_full_access(db, case.id)
    today = today_ist()
    cal = get_calendar(db)
    units = _unit_codes(db)
    head = db.execute(text(_LIST_SELECT + " WHERE c.id = :id"), {"id": case.id}).first()
    base = _row(head, today, cal)

    events = db.execute(
        text(
            "SELECT id, event_type, action, actor_id, actor_unit_id, at, from_status, to_status, "
            "from_unit_id, to_unit_id, remarks, data FROM case_event WHERE case_id = :c "
            "ORDER BY at DESC, id DESC"
        ),
        {"c": case.id},
    ).all()
    names = _user_names(db, {e.actor_id for e in events} | {case.holding_officer_id})
    action_labels = fsm.action_labels(db)
    timeline = []
    for e in events:
        if not full and e.event_type not in METADATA_EVENT_TYPES:
            continue
        item = {
            "id": e.id,
            "type": e.event_type,
            "action": e.action,
            "action_label": action_labels.get(e.action or "", e.action),
            "at": e.at.isoformat(),
            "actor": names.get(str(e.actor_id)) if e.actor_id else "System",
            "actor_unit": units.get(str(e.actor_unit_id)) if e.actor_unit_id else None,
            "from_status": e.from_status,
            "to_status": e.to_status,
            "from_unit": units.get(str(e.from_unit_id)) if e.from_unit_id else None,
            "to_unit": units.get(str(e.to_unit_id)) if e.to_unit_id else None,
        }
        if full:
            item["remarks"], item["data"] = e.remarks, e.data
        else:
            item["data"] = {
                k: v
                for k, v in (e.data or {}).items()
                if k in ("coordination", "decision", "lead_unit", "policy", "due", "phrase")
            }
        timeline.append(item)

    links = db.execute(
        text(
            """
            SELECT l.id, l.link_type, l.probability, l.reasons, l.status, l.model_version,
                   o.id AS other_id, o.case_no, o.status AS other_status, ou.code AS other_unit,
                   co.code AS coordination_code, co.status AS coordination_status, co.decision, lu.code AS lead_unit
            FROM case_link l
            JOIN case_record o ON o.id = CASE WHEN l.left_id = :c THEN l.right_id ELSE l.left_id END
            JOIN unit ou ON ou.id = o.holding_unit_id
            LEFT JOIN coordination co ON co.link_id = l.id
            LEFT JOIN unit lu ON lu.id = co.lead_unit_id
            WHERE (l.left_id = :c OR l.right_id = :c) AND l.link_type <> 'L'
            ORDER BY (l.status = 'PROPOSED') DESC, l.probability DESC
            """
        ),
        {"c": case.id},
    ).all()

    coord_cards = [
        {
            "code": lk.coordination_code,
            "status": lk.coordination_status,
            "decision": lk.decision,
            "lead_unit": lk.lead_unit,
            "other_case": lk.case_no,
            "other_unit": lk.other_unit,
            "type": lk.link_type,
            "probability": round(lk.probability, 3),
            "phrase": PS_PHRASE,
        }
        for lk in links
        if lk.coordination_code
    ]

    out: dict[str, Any] = {
        **base,
        "row_version": case.row_version,
        "tier": "full" if full else "metadata",
        "cpgrams_no": case.cpgrams_no,
        "court_case_no": case.court_case_no,
        "unit_file_no": case.unit_file_no,
        "language": case.language,
        "complainant_type": case.complainant_type,
        "institution_weight": case.institution_weight,
        "holder_since": case.holder_since.isoformat(),
        "timeline": timeline,
        "links": [
            {
                "id": str(lk.id),
                "type": lk.link_type,
                "type_label": TYPE_LABELS.get(lk.link_type, lk.link_type),
                "probability": round(lk.probability, 3),
                "reasons": lk.reasons,
                "status": lk.status,
                "model_version": lk.model_version,
                "other_case": lk.case_no,
                "other_case_id": str(lk.other_id),
                "other_status": lk.other_status,
                "other_status_label": fsm.STATUS_LABELS.get(lk.other_status),
                "other_unit": lk.other_unit,
                "coordination_code": lk.coordination_code,
                "coordination_status": lk.coordination_status,
                "decision": lk.decision,
                "lead_unit": lk.lead_unit,
            }
            for lk in links
        ],
        "coordination": coord_cards,
        "coordination_required": any(
            c["status"] in ("OPEN", "AWAITING_CONFIRMATION", "ESCALATED") for c in coord_cards
        ),
        "phrase": PS_PHRASE,
        "allowed_actions": allowed_actions(db, user, case),
        "can_transfer": case.holding_unit_id == user.unit_id and case.status in ("REGISTERED", "UNDER_EXAMINATION"),
    }

    pending = db.execute(
        text(
            "SELECT t.id, t.reason, t.proposed_at, fu.code AS from_unit, tu.code AS to_unit, "
            "t.to_unit_id FROM transfer t JOIN unit fu ON fu.id = t.from_unit_id "
            "JOIN unit tu ON tu.id = t.to_unit_id WHERE t.case_id = :c AND t.status = 'PROPOSED'"
        ),
        {"c": case.id},
    ).first()
    out["pending_transfer"] = (
        {
            "id": str(pending.id),
            "reason": pending.reason if full else None,
            "proposed_at": pending.proposed_at.isoformat(),
            "from_unit": pending.from_unit,
            "to_unit": pending.to_unit,
            "can_decide": pending.to_unit_id == user.unit_id,
        }
        if pending
        else None
    )

    if full:
        content = db.execute(
            text(
                "SELECT subject, body, complainant_name_enc, complainant_contact_enc FROM case_content "
                "WHERE case_id = :c"
            ),
            {"c": case.id},
        ).first()
        out["content"] = {
            "subject": content.subject,
            "body": content.body,
            "complainant_on_file": bool(content.complainant_name_enc or content.complainant_contact_enc),
        }
        docs = db.execute(
            text(
                "SELECT id, filename, mime, size_bytes, sha256, scan_status, scan_detail, uploaded_at, "
                "uploaded_by FROM document WHERE case_id = :c ORDER BY uploaded_at DESC"
            ),
            {"c": case.id},
        ).all()
        doc_names = _user_names(db, {d.uploaded_by for d in docs})
        out["documents"] = [
            {
                "id": str(d.id),
                "filename": d.filename,
                "mime": d.mime,
                "size_bytes": d.size_bytes,
                "sha256": d.sha256,
                "scan_status": d.scan_status,
                "scan_detail": d.scan_detail,
                "uploaded_at": d.uploaded_at.isoformat(),
                "uploaded_by": doc_names.get(str(d.uploaded_by)),
            }
            for d in docs
        ]
        timers = db.execute(
            text(
                "SELECT kind, due_at, payload FROM timer WHERE case_id = :c AND fired_at IS NULL "
                "AND cancelled_at IS NULL ORDER BY due_at LIMIT 10"
            ),
            {"c": case.id},
        ).all()
        out["upcoming"] = [{"kind": t.kind, "due_at": t.due_at.isoformat(), "payload": t.payload} for t in timers]
        comms = db.execute(
            text(
                "SELECT id, recipient_type, subject, dispatched_at, created_at FROM communication "
                "WHERE case_id = :c ORDER BY created_at DESC"
            ),
            {"c": case.id},
        ).all()
        out["communications"] = [
            {
                "id": str(c.id),
                "recipient_type": c.recipient_type,
                "subject": c.subject,
                "dispatched_at": c.dispatched_at.isoformat() if c.dispatched_at else None,
                "created_at": c.created_at.isoformat(),
            }
            for c in comms
        ]
        out["institution_candidates"] = (case.refs or {}).get("institution_candidates", [])
        policy = (
            db.execute(
                text(
                    "SELECT code, version, name, day_basis, target_days, approval_status FROM sla_policy WHERE id = :p"
                ),
                {"p": case.sla_policy_id},
            ).first()
            if case.sla_policy_id
            else None
        )
        out["sla_policy"] = dict(policy._mapping) if policy else None
        chain.record(
            db,
            "case.viewed_full",
            actor_id=user.id,
            actor_unit_id=user.unit_id,
            entity_type="case",
            entity_id=case.case_no,
            payload={},
        )
    else:
        out["content"] = None
        out["documents"] = None
        out["access_note"] = (
            "You can see that this case exists, who holds it and its status. The complaint text is "
            f"visible to {base['holding_unit']['code']} and to units coordinating on it. "
            f"Request access from the {base['holding_unit']['code']} unit head."
        )
    return out


def reveal_complainant(db: Session, user: CurrentUser, case: CaseRecord, reason: str) -> dict[str, Any]:
    from app.core.errors import forbidden, invalid

    if not has_full_access(db, case.id):
        raise forbidden("You do not have access to this case's content.")
    if len((reason or "").strip()) < 10:
        raise invalid("Give a reason (at least 10 characters) for viewing the complainant's identity.", field="reason")
    row = db.execute(
        text("SELECT complainant_name_enc, complainant_contact_enc FROM case_content WHERE case_id = :c"),
        {"c": case.id},
    ).first()
    chain.record(
        db,
        "case.complainant_revealed",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="case",
        entity_id=case.case_no,
        payload={"reason": reason.strip()},
    )
    return {
        "name": crypto.decrypt(row.complainant_name_enc) if row else None,
        "contact": crypto.decrypt(row.complainant_contact_enc) if row else None,
        "notice": "Do not disclose the complainant's identity to the institution without approval.",
    }


def parse_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None
