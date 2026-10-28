"""Case messages API: read the thread, post to it, and turn an agreed step into a task on the case."""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import forbidden, not_found
from app.models import CaseMessage
from app.modules.auth.deps import current_user
from app.modules.case import service as case_service
from app.modules.messages import service as svc
from app.modules.policy.roles import CASE_VIEW_ROLES, CASEWORK_ROLES, CurrentUser, Role
from app.modules.tasks import service as tasks

router = APIRouter(tags=["messages"])


@router.get("/cases/{case_ref}/messages")
def thread(case_ref: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require(CASE_VIEW_ROLES, "read case messages")
    case = case_service.get_case(db, case_ref)
    if not case_service.has_full_access(db, case.id):
        raise forbidden("The thread is visible to units with full access to this case.")
    return {
        "items": svc.for_case(db, user, case.id),
        "participants": svc.participants(db, case),
        "can_post": svc.can_post(db, user, case),
        "can_make_task": case.holding_unit_id == user.unit_id and user.has(*CASEWORK_ROLES),
    }


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


@router.post("/cases/{case_ref}/messages", status_code=201)
def post(
    case_ref: str, body: MessageIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    case = case_service.get_case(db, case_ref)
    msg = svc.post(db, user, case, body.body)
    db.commit()
    r = db.execute(text(svc.LIST_SQL + " WHERE m.id = :i"), {"i": msg.id}).first()
    return svc.payload(r, user)


class ToTaskIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    due_on: dt.date | None = None


@router.post("/cases/{case_ref}/messages/{message_id}/task", status_code=201)
def to_task(
    case_ref: str,
    message_id: uuid.UUID,
    body: ToTaskIn,
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Ministry note p. 16, "convert messages into actions": the holding unit records an agreed step as a task."""
    case = case_service.get_case(db, case_ref)
    msg = db.get(CaseMessage, message_id)
    if msg is None or msg.case_id != case.id:
        raise not_found("Message")
    if case.holding_unit_id != user.unit_id and not user.has(Role.COMPETENT_AUTHORITY):
        raise forbidden("Only the unit holding this case can turn a message into a task.")
    user.require(CASEWORK_ROLES, "add tasks")
    task = tasks.create(
        db,
        user,
        case,
        title=(body.title or msg.body).strip()[:300],
        owner_id=user.id,
        due_on=body.due_on,
        source="MESSAGE",
        source_ref=case.case_no,
    )
    db.commit()
    return {"task_id": str(task.id), "case_no": case.case_no}
