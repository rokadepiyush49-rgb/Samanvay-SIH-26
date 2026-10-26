"""Coordination Centre API: cards, card detail with room, decisions, confirmation, escalation, messages."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import forbidden
from app.models import CaseLink, CaseRecord
from app.modules.auth.deps import current_user
from app.modules.case import fsm
from app.modules.case.service import has_full_access
from app.modules.coordination import service as svc
from app.modules.matching.scoring import PS_PHRASE, TYPE_LABELS
from app.modules.policy.roles import CurrentUser, Role
from app.modules.sla.calendar import get_calendar, today_ist

router = APIRouter(prefix="/coordination", tags=["coordination"])
OVERSIGHT = (Role.NODAL_OFFICER, Role.COMPETENT_AUTHORITY, Role.SENIOR_MGMT, Role.AUDITOR)

_CARDS = """
SELECT co.id, co.code, co.status, co.decision, co.decide_by, co.created_at, co.proposal, co.proposed_unit_id,
       co.row_version, lu.code AS lead_unit, l.link_type, l.probability, l.reasons, l.status AS link_status,
       a.id AS a_id, a.case_no AS a_no, a.status AS a_status, au.code AS a_unit, a.holding_unit_id AS a_unit_id,
       a.holding_officer_id AS a_officer_id, aoff.full_name AS a_officer, acat.name AS a_category,
       a.received_on AS a_received, a.holder_since AS a_since,
       b.id AS b_id, b.case_no AS b_no, b.status AS b_status, bu.code AS b_unit, b.holding_unit_id AS b_unit_id,
       b.holding_officer_id AS b_officer_id, boff.full_name AS b_officer, bcat.name AS b_category,
       b.received_on AS b_received, b.holder_since AS b_since,
       i.name AS inst_name, i.permanent_id, i.city AS inst_city
FROM coordination co
JOIN case_link l ON l.id = co.link_id
JOIN case_record a ON a.id = l.left_id
JOIN case_record b ON b.id = l.right_id
JOIN unit au ON au.id = a.holding_unit_id
JOIN unit bu ON bu.id = b.holding_unit_id
JOIN category acat ON acat.code = a.category_code
JOIN category bcat ON bcat.code = b.category_code
LEFT JOIN app_user aoff ON aoff.id = a.holding_officer_id
LEFT JOIN app_user boff ON boff.id = b.holding_officer_id
LEFT JOIN unit lu ON lu.id = co.lead_unit_id
LEFT JOIN institution i ON i.id = coalesce(a.institution_id, b.institution_id)
"""


def _card(r, user: CurrentUser, cal, today: dt.date) -> dict:
    mine = user.unit_id in (r.a_unit_id, r.b_unit_id)
    awaiting_me = (
        r.status == "AWAITING_CONFIRMATION"
        and mine
        and (r.proposed_unit_id != user.unit_id or r.a_unit_id == r.b_unit_id)
    )
    side = lambda p: {  # noqa: E731 - small local projection
        "case_id": str(getattr(r, f"{p}_id")),
        "case_no": getattr(r, f"{p}_no"),
        "status": getattr(r, f"{p}_status"),
        "status_label": fsm.STATUS_LABELS.get(getattr(r, f"{p}_status")),
        "unit": getattr(r, f"{p}_unit"),
        "officer": getattr(r, f"{p}_officer"),
        "category": getattr(r, f"{p}_category"),
        "received_on": getattr(r, f"{p}_received").isoformat(),
        "holder_since": getattr(r, f"{p}_since").isoformat(),
    }
    return {
        "id": str(r.id),
        "code": r.code,
        "status": r.status,
        "decision": r.decision,
        "lead_unit": r.lead_unit,
        "phrase": PS_PHRASE,
        "type": r.link_type,
        "type_label": TYPE_LABELS.get(r.link_type, r.link_type),
        "probability": round(r.probability, 3),
        "reasons": r.reasons,
        "link_status": r.link_status,
        "decide_by": r.decide_by.isoformat(),
        "working_days_left": cal.working_days_between(today, r.decide_by),
        "created_at": r.created_at.isoformat(),
        "proposal": r.proposal,
        "row_version": r.row_version,
        "institution": {"name": r.inst_name, "permanent_id": r.permanent_id, "city": r.inst_city},
        "a": side("a"),
        "b": side("b"),
        "participant": mine,
        "awaiting_me": awaiting_me,
        "can_decide": (
            mine and user.has(Role.CASE_OFFICER, Role.UNIT_HEAD, Role.REGIONAL_OFFICER, Role.COMPETENT_AUTHORITY)
        )
        or (r.status == "ESCALATED" and user.has(Role.NODAL_OFFICER, Role.COMPETENT_AUTHORITY)),
    }


@router.get("")
def list_cards(
    status: Literal["open", "decided", "escalated", "all"] = "open",
    mine: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    where, p = [], {"u": user.unit_id}
    if status == "open":
        where.append("co.status IN ('OPEN', 'AWAITING_CONFIRMATION', 'ESCALATED')")
    elif status == "decided":
        where.append("co.status = 'DECIDED'")
    elif status == "escalated":
        where.append("co.status = 'ESCALATED'")
    if mine or not user.has(*OVERSIGHT):
        where.append("(a.holding_unit_id = :u OR b.holding_unit_id = :u)")
    sql = (
        _CARDS
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY (l.link_type = 'P') DESC, co.decide_by ASC, co.created_at DESC LIMIT :n"
    )
    rows = db.execute(text(sql), {**p, "n": limit}).all()
    cal, today = get_calendar(db), today_ist()
    cards = [_card(r, user, cal, today) for r in rows]
    return {
        "items": cards,
        "counts": {
            "awaiting_me": sum(1 for c in cards if c["awaiting_me"]),
            "parallel": sum(1 for c in cards if c["type"] == "P" and c["status"] != "DECIDED"),
            "escalated": sum(1 for c in cards if c["status"] == "ESCALATED"),
        },
    }


@router.get("/{code}")
def card_detail(code: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    co = svc.get_coordination(db, code)
    rows = db.execute(text(_CARDS + " WHERE co.id = :id"), {"id": co.id}).all()
    if not rows:
        raise forbidden("This coordination involves a case you cannot see.")
    r = rows[0]
    a, b = db.get(CaseRecord, r.a_id), db.get(CaseRecord, r.b_id)
    if not (svc.is_participant(user, a, b) or user.has(*OVERSIGHT)):
        raise forbidden("Only participating units and oversight roles can open this coordination.")
    card = _card(r, user, get_calendar(db), today_ist())
    for key, case in (("a", a), ("b", b)):
        if has_full_access(db, case.id):
            content = db.execute(
                text("SELECT subject, body FROM case_content WHERE case_id = :c"), {"c": case.id}
            ).first()
            card[key]["subject"], card[key]["body"] = (content.subject, content.body) if content else (None, None)
    msgs = db.execute(
        text(
            "SELECT m.id, m.body, m.created_at, u.full_name, un.code AS unit FROM coordination_message m "
            "JOIN app_user u ON u.id = m.author_id JOIN unit un ON un.id = m.unit_id "
            "WHERE m.coordination_id = :c ORDER BY m.created_at"
        ),
        {"c": co.id},
    ).all()
    card["messages"] = [
        {"id": str(m.id), "body": m.body, "at": m.created_at.isoformat(), "author": m.full_name, "unit": m.unit}
        for m in msgs
    ]
    card["units"] = sorted({r.a_unit, r.b_unit})
    return card


class DecisionIn(BaseModel):
    decision: Literal["DUPLICATE", "RELATED", "NOT_RELATED"]
    lead_unit: str | None = Field(default=None, max_length=20)
    joint_next_action: str | None = Field(default=None, max_length=300)
    joint_due: dt.date | None = None
    remarks: str | None = Field(default=None, max_length=2000)


def _version(if_match: str | None) -> int | None:
    try:
        return int(if_match.strip('"W/ ')) if if_match else None
    except ValueError:
        return None


@router.post("/{code}/decision")
def propose(
    code: str,
    body: DecisionIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    co = svc.get_coordination(db, code, lock=True)
    co = svc.propose(
        db,
        user,
        co,
        decision=body.decision,
        lead_unit_code=body.lead_unit,
        joint_next_action=body.joint_next_action,
        joint_due=body.joint_due,
        remarks=body.remarks,
        expected_version=_version(if_match),
    )
    db.commit()
    link = db.get(CaseLink, co.link_id)
    a, b = db.get(CaseRecord, link.left_id), db.get(CaseRecord, link.right_id)
    awaiting = (
        sorted({x.case_no for x in (a, b) if x.holding_unit_id != user.unit_id}) if co.status != "DECIDED" else []
    )
    return {
        "coordination": co.code,
        "status": co.status,
        "awaiting": awaiting,
        "decide_by": co.decide_by.isoformat(),
        "row_version": co.row_version,
    }


@router.post("/{code}/confirm")
def confirm(
    code: str,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    co = svc.get_coordination(db, code, lock=True)
    co = svc.confirm(db, user, co, _version(if_match))
    db.commit()
    return {"coordination": co.code, "status": co.status, "decision": co.decision}


class EscalateIn(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)


@router.post("/{code}/escalate")
def escalate(
    code: str, body: EscalateIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    co = svc.get_coordination(db, code, lock=True)
    co = svc.escalate(db, co, user, body.reason)
    db.commit()
    return {"coordination": co.code, "status": co.status}


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


@router.post("/{code}/messages", status_code=201)
def message(
    code: str, body: MessageIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    co = svc.get_coordination(db, code)
    msg = svc.post_message(db, user, co, body.body)
    db.commit()
    return {"id": str(msg.id)}
