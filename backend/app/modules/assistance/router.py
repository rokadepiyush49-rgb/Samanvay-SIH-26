"""Assistance and routing API: requests between units, their inbox/outbox, and the unit directory."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.modules.assistance import service as svc
from app.modules.auth.deps import current_user
from app.modules.case import service as case_service
from app.modules.policy.roles import CASE_VIEW_ROLES, CurrentUser
from app.modules.routing import service as routing
from app.modules.sla.calendar import today_ist

router = APIRouter(tags=["assistance"])


def _version(if_match: str | None) -> int | None:
    try:
        return int(if_match.strip('"W/ ')) if if_match else None
    except ValueError:
        return None


def _one(db: Session, user: CurrentUser, request_id: uuid.UUID) -> dict:
    r = db.execute(text(svc.LIST_SQL + " WHERE a.id = :i"), {"i": request_id}).first()
    return svc.payload(r, user)


class RequestIn(BaseModel):
    to_unit: str = Field(max_length=20)
    kind: Literal["VERIFICATION", "INFORMATION", "OPINION", "ACTION"]
    request: str = Field(min_length=1, max_length=4000)
    due_on: dt.date | None = None
    followed_recommendation: bool = False


@router.post("/cases/{case_ref}/assistance", status_code=201)
def create(case_ref: str, body: RequestIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    case = case_service.get_case(db, case_ref)
    req = svc.request(
        db,
        user,
        case,
        to_unit_code=body.to_unit,
        kind=body.kind,
        body=body.request,
        due_on=body.due_on,
        followed_recommendation=body.followed_recommendation,
    )
    db.commit()
    return _one(db, user, req.id)


@router.get("/assistance")
def inbox(
    direction: Literal["incoming", "outgoing", "all"] = "incoming",
    state: Literal["open", "closed", "all"] = "open",
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    user.require(CASE_VIEW_ROLES, "view assistance requests")
    where, p = [], {"u": user.unit_id, "n": limit}
    if direction == "incoming":
        where.append("a.to_unit_id = :u")
    elif direction == "outgoing":
        where.append("a.from_unit_id = :u")
    elif not user.sees_all_units:
        where.append("(a.to_unit_id = :u OR a.from_unit_id = :u)")
    if state == "open":
        where.append("a.status IN ('SENT', 'ACCEPTED')")
    elif state == "closed":
        where.append("a.status NOT IN ('SENT', 'ACCEPTED')")
    sql = (
        svc.LIST_SQL
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY (a.status IN ('SENT', 'ACCEPTED')) DESC, a.due_on, a.requested_at DESC LIMIT :n"
    )
    items = [svc.payload(r, user) for r in db.execute(text(sql), p).all()]
    counts = db.execute(
        text(
            "SELECT count(*) FILTER (WHERE to_unit_id = :u AND status = 'SENT') AS awaiting_ack, "
            "count(*) FILTER (WHERE to_unit_id = :u AND status IN ('SENT', 'ACCEPTED')) AS incoming_open, "
            "count(*) FILTER (WHERE from_unit_id = :u AND status IN ('SENT', 'ACCEPTED')) AS outgoing_open, "
            "count(*) FILTER (WHERE (to_unit_id = :u OR from_unit_id = :u) AND status IN ('SENT', 'ACCEPTED') "
            "AND due_on < :today) AS overdue FROM assistance_request"
        ),
        {"u": user.unit_id, "today": today_ist()},
    ).first()
    return {"items": items, "counts": dict(counts._mapping)}


class AcceptIn(BaseModel):
    assignee_id: uuid.UUID | None = None


@router.post("/assistance/{request_id}/accept")
def accept(
    request_id: uuid.UUID,
    body: AcceptIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    svc.accept(db, user, request_id, body.assignee_id, _version(if_match))
    db.commit()
    return _one(db, user, request_id)


class DeclineIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    suggested_unit: str | None = Field(default=None, max_length=20)


@router.post("/assistance/{request_id}/decline")
def decline(
    request_id: uuid.UUID,
    body: DeclineIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    svc.decline(db, user, request_id, body.reason, body.suggested_unit, _version(if_match))
    db.commit()
    return _one(db, user, request_id)


class CompleteIn(BaseModel):
    response: str = Field(min_length=1, max_length=4000)


@router.post("/assistance/{request_id}/complete")
def complete(
    request_id: uuid.UUID,
    body: CompleteIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    svc.complete(db, user, request_id, body.response, _version(if_match))
    db.commit()
    return _one(db, user, request_id)


class CancelIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/assistance/{request_id}/cancel")
def cancel(
    request_id: uuid.UUID, body: CancelIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    svc.cancel(db, user, request_id, body.reason)
    db.commit()
    return _one(db, user, request_id)


@router.get("/routing/directory")
def directory(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Which unit holds the primary mandate for each category, and which units support it (proposed v0)."""
    rows = routing.directory(db)
    return {
        "items": [{**r, "id": str(r["id"])} for r in rows],
        "note": "Proposed unit directory for the prototype; AICTE to confirm mandates.",
    }
