"""Case tasks API: add, list (mine / my unit), complete, cancel, and turn a coordination message into a task."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import forbidden, invalid, not_found
from app.models import CaseLink, CaseRecord, CoordinationMessage, Unit
from app.modules.auth.deps import current_user
from app.modules.case import service as case_service
from app.modules.coordination import service as coord
from app.modules.policy.roles import CASE_VIEW_ROLES, CurrentUser
from app.modules.sla.calendar import today_ist
from app.modules.tasks import service as svc

router = APIRouter(tags=["tasks"])


def _version(if_match: str | None) -> int | None:
    try:
        return int(if_match.strip('"W/ ')) if if_match else None
    except ValueError:
        return None


def _one(db: Session, user: CurrentUser, task_id: uuid.UUID) -> dict:
    r = db.execute(text(svc.LIST_SQL + " WHERE t.id = :i"), {"i": task_id}).first()
    return svc.payload(r, user, today_ist())


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    owner_unit: str | None = Field(default=None, max_length=20)
    owner_id: uuid.UUID | None = None
    due_on: dt.date | None = None
    depends_on: uuid.UUID | None = None


@router.post("/cases/{case_ref}/tasks", status_code=201)
def add(case_ref: str, body: TaskIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    case = case_service.get_case(db, case_ref)
    owner_unit_id = None
    if body.owner_unit:
        unit = db.query(Unit).filter(Unit.code == body.owner_unit, Unit.is_active).first()
        if unit is None:
            raise invalid("Unknown unit.", field="owner_unit")
        owner_unit_id = unit.id
    task = svc.create(
        db,
        user,
        case,
        title=body.title,
        owner_unit_id=owner_unit_id,
        owner_id=body.owner_id,
        due_on=body.due_on,
        depends_on=body.depends_on,
    )
    db.commit()
    return _one(db, user, task.id)


@router.get("/tasks")
def my_tasks(
    scope: Literal["mine", "unit"] = "mine",
    state: Literal["open", "closed", "all"] = "open",
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Tasks owned by me (or unassigned in my unit), or by my whole unit, across cases."""
    user.require(CASE_VIEW_ROLES, "view tasks")
    where = ["t.owner_unit_id = :u"]
    if scope == "mine":
        where.append("(t.owner_id = :me OR t.owner_id IS NULL)")
    if state == "open":
        where.append("t.status = 'OPEN'")
    elif state == "closed":
        where.append("t.status <> 'OPEN'")
    rows = db.execute(
        text(
            svc.LIST_SQL
            + " WHERE "
            + " AND ".join(where)
            + " ORDER BY (t.status = 'OPEN') DESC, t.due_on NULLS LAST, t.created_at DESC LIMIT :n"
        ),
        {"u": user.unit_id, "me": user.id, "n": limit},
    ).all()
    today = today_ist()
    items = [svc.payload(r, user, today) for r in rows]
    return {
        "items": items,
        "counts": {
            "open": sum(1 for t in items if t["status"] == "OPEN"),
            "overdue": sum(1 for t in items if t["overdue"]),
            "due_soon": sum(
                1
                for t in items
                if t["status"] == "OPEN" and t["due_on"] and t["due_on"] <= str(today + dt.timedelta(days=7))
            ),
        },
    }


class CompleteIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


@router.post("/tasks/{task_id}/complete")
def complete(
    task_id: uuid.UUID,
    body: CompleteIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    svc.complete(db, user, task_id, body.note, _version(if_match))
    db.commit()
    return _one(db, user, task_id)


class CancelIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/tasks/{task_id}/cancel")
def cancel(
    task_id: uuid.UUID, body: CancelIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    svc.cancel(db, user, task_id, body.reason)
    db.commit()
    return _one(db, user, task_id)


class FromMessageIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    due_on: dt.date | None = None


@router.post("/coordination/{code}/messages/{message_id}/task", status_code=201)
def from_message(
    code: str,
    message_id: uuid.UUID,
    body: FromMessageIn,
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Ministry note p. 16: turn an agreed step in the coordination room into a task on your own unit's case."""
    co = coord.get_coordination(db, code)
    msg = db.get(CoordinationMessage, message_id)
    if msg is None or msg.coordination_id != co.id:
        raise not_found("Message")
    link = db.get(CaseLink, co.link_id)
    a, b = db.get(CaseRecord, link.left_id), db.get(CaseRecord, link.right_id)
    if coord.side_of(user, a, b) is None:
        raise forbidden("Only officers of the two units can turn a message into a task on their case.")
    case = a if a.holding_unit_id == user.unit_id else b
    task = svc.create(
        db,
        user,
        case,
        title=(body.title or msg.body).strip()[:300],
        owner_id=user.id,
        due_on=body.due_on,
        source="MESSAGE",
        source_ref=co.code,
    )
    db.commit()
    return _one(db, user, task.id)
