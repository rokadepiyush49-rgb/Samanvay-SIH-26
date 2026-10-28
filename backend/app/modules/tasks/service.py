"""Case tasks: what must happen next, by whom and by when (ministry note p. 4: "pending tasks, responsible team,
deadline and dependencies"; p. 16: "convert messages into actions").

A task belongs to a case and is owned by a unit (optionally an officer). It can depend on another task of the same
case and cannot be completed while that one is open. Tasks come from officers (MANUAL), from a coordination decision
with a joint deadline (COORDINATION), or from a coordination-room message (MESSAGE).
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import AppError, conflict, forbidden, invalid, not_found
from app.models import CaseRecord, CaseTask, Unit
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.case.service import add_event
from app.modules.policy.roles import CASEWORK_ROLES, CurrentUser, Role
from app.modules.sla import notify as nt
from app.modules.sla import service as sla
from app.modules.sla.calendar import today_ist

SOURCE_LABEL = {
    "MANUAL": "Added by an officer",
    "COORDINATION": "Joint action from coordination",
    "MESSAGE": "From a coordination message",
}


def _check_owner(db: Session, owner_id: uuid.UUID, unit_id: uuid.UUID) -> None:
    ok = db.execute(
        text(
            "SELECT 1 FROM app_user WHERE id = :o AND unit_id = :u AND is_active AND "
            "('CASE_OFFICER' = ANY(roles) OR 'UNIT_HEAD' = ANY(roles) OR 'REGIONAL_OFFICER' = ANY(roles))"
        ),
        {"o": owner_id, "u": unit_id},
    ).first()
    if not ok:
        raise invalid("The owner must be an active officer of the owning unit.", field="owner_id")


def create(
    db: Session,
    user: CurrentUser | None,
    case: CaseRecord,
    *,
    title: str,
    owner_unit_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    due_on: dt.date | None = None,
    depends_on: uuid.UUID | None = None,
    source: str = "MANUAL",
    source_ref: str | None = None,
) -> CaseTask:
    """Officer-created tasks need the holding unit; COORDINATION / MESSAGE tasks are created by those workflows."""
    if source == "MANUAL":
        if user is None or (case.holding_unit_id != user.unit_id and not user.has(Role.COMPETENT_AUTHORITY)):
            raise forbidden("Only the unit holding this case can add tasks to it.")
        user.require(CASEWORK_ROLES, "add tasks")
    if case.status in fsm.TERMINAL:
        raise invalid("Closed cases take no new tasks.")
    title = (title or "").strip()
    if not 3 <= len(title) <= 300:
        raise invalid("Describe the task in 3 to 300 characters.", field="title")
    owner_unit_id = owner_unit_id or case.holding_unit_id
    if db.get(Unit, owner_unit_id) is None:
        raise invalid("Unknown unit.", field="owner_unit")
    if owner_id:
        _check_owner(db, owner_id, owner_unit_id)
    if due_on and due_on < today_ist():
        raise invalid("The due date cannot be in the past.", field="due_on")
    if depends_on:
        dep = db.get(CaseTask, depends_on)
        if dep is None or dep.case_id != case.id or dep.status == "CANCELLED":
            raise invalid("A task can only depend on an open or completed task of the same case.", field="depends_on")
    task = CaseTask(
        id=uuid.uuid4(),
        case_id=case.id,
        title=title,
        owner_unit_id=owner_unit_id,
        owner_id=owner_id,
        due_on=due_on,
        depends_on=depends_on,
        source=source,
        source_ref=source_ref,
        created_by=user.id if user else None,
    )
    db.add(task)
    db.flush()
    owner_unit = db.get(Unit, owner_unit_id)
    add_event(
        db,
        case,
        "TASK_ADDED",
        user,
        remarks=title,
        data={
            "task_id": str(task.id),
            "owner_unit": owner_unit.code,
            "due_on": due_on.isoformat() if due_on else None,
            "source": source,
            "source_ref": source_ref,
        },
    )
    if due_on:
        sla.schedule_task_timers(db, task.id, case.id, due_on)
    recipients = [owner_id] if owner_id else nt.unit_officers(db, owner_unit_id)
    nt.notify(
        db,
        [r for r in recipients if not user or r != user.id],
        family="TASK",
        title=f"New task on {case.case_no}: {title[:80]}",
        body=f"Due {due_on.strftime('%d-%m-%Y')}." if due_on else "",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"task:{task.id}:created",
    )
    chain.record(
        db,
        "task.created",
        actor_id=user.id if user else None,
        actor_unit_id=user.unit_id if user else None,
        entity_type="case",
        entity_id=case.case_no,
        payload={"task_id": str(task.id), "owner_unit": owner_unit.code, "source": source},
    )
    return task


def _open(db: Session, task_id: uuid.UUID, expected: int | None) -> tuple[CaseTask, CaseRecord]:
    task = db.get(CaseTask, task_id, with_for_update=True)
    if task is None:
        raise not_found("Task")
    if task.status != "OPEN":
        raise conflict("This task is already closed.")
    if expected is not None and expected != task.row_version:
        raise AppError(409, "Task changed", "Someone updated this task. Reload and try again.", "stale-version")
    case = db.get(CaseRecord, task.case_id)
    if case is None:
        raise not_found("Case")
    return task, case


def complete(db: Session, user: CurrentUser, task_id: uuid.UUID, note: str | None, expected: int | None) -> CaseTask:
    task, case = _open(db, task_id, expected)
    if user.unit_id not in (task.owner_unit_id, case.holding_unit_id) and not user.has(Role.COMPETENT_AUTHORITY):
        raise forbidden("Only the owning unit or the unit holding the case can complete this task.")
    user.require(CASEWORK_ROLES, "complete tasks")
    if task.depends_on:
        dep = db.get(CaseTask, task.depends_on)
        if dep is not None and dep.status == "OPEN":
            raise AppError(409, "Task is blocked", f"Finish “{dep.title}” first; this task depends on it.", "blocked")
    task.status, task.done_by, task.done_at = "DONE", user.id, dt.datetime.now(dt.UTC)
    task.done_note = (note or "").strip() or None
    add_event(db, case, "TASK_DONE", user, remarks=task.done_note, data={"task_id": str(task.id), "title": task.title})
    sla.cancel_task_timers(db, task.id)
    nt.notify(
        db,
        [x for x in (task.created_by, case.holding_officer_id) if x and x != user.id],
        family="TASK",
        title=f"{user.unit_code} completed a task on {case.case_no}: {task.title[:80]}",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"task:{task.id}:done",
    )
    chain.record(
        db,
        "task.completed",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="case",
        entity_id=case.case_no,
        payload={"task_id": str(task.id)},
    )
    return task


def cancel(db: Session, user: CurrentUser, task_id: uuid.UUID, reason: str) -> CaseTask:
    task, case = _open(db, task_id, None)
    if case.holding_unit_id != user.unit_id and task.created_by != user.id and not user.has(Role.COMPETENT_AUTHORITY):
        raise forbidden("Only the unit holding the case or the task's author can cancel it.")
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise invalid("Give a reason for cancelling (at least 5 characters).", field="reason")
    task.status, task.done_by, task.done_at, task.done_note = "CANCELLED", user.id, dt.datetime.now(dt.UTC), reason
    add_event(db, case, "TASK_CANCELLED", user, remarks=reason, data={"task_id": str(task.id), "title": task.title})
    sla.cancel_task_timers(db, task.id)
    chain.record(
        db,
        "task.cancelled",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="case",
        entity_id=case.case_no,
        payload={"task_id": str(task.id)},
    )
    return task


LIST_SQL = """
SELECT t.id, t.title, t.due_on, t.status, t.source, t.source_ref, t.created_at, t.done_at, t.done_note, t.row_version,
       t.depends_on, dep.title AS depends_title, dep.status AS depends_status,
       ou.code AS owner_unit, t.owner_unit_id, ow.full_name AS owner, t.owner_id, cu.full_name AS created_by_name,
       t.created_by, c.case_no, c.holding_unit_id, hu.code AS holding_unit, i.name AS inst_name
FROM case_task t
JOIN case_record c ON c.id = t.case_id
JOIN unit ou ON ou.id = t.owner_unit_id
JOIN unit hu ON hu.id = c.holding_unit_id
LEFT JOIN app_user ow ON ow.id = t.owner_id
LEFT JOIN app_user cu ON cu.id = t.created_by
LEFT JOIN case_task dep ON dep.id = t.depends_on
LEFT JOIN institution i ON i.id = c.institution_id
"""


def payload(r, user: CurrentUser, today: dt.date) -> dict:
    is_open = r.status == "OPEN"
    blocked = is_open and r.depends_on is not None and r.depends_status == "OPEN"
    casework = user.has(*CASEWORK_ROLES)
    may_act = user.unit_id in (r.owner_unit_id, r.holding_unit_id) or user.has(Role.COMPETENT_AUTHORITY)
    return {
        "id": str(r.id),
        "title": r.title,
        "due_on": r.due_on.isoformat() if r.due_on else None,
        "overdue": is_open and r.due_on is not None and r.due_on < today,
        "status": r.status,
        "blocked": blocked,
        "depends_on": {"id": str(r.depends_on), "title": r.depends_title, "status": r.depends_status}
        if r.depends_on
        else None,
        "source": r.source,
        "source_label": SOURCE_LABEL.get(r.source, r.source),
        "source_ref": r.source_ref,
        "owner_unit": r.owner_unit,
        "owner": r.owner,
        "created_by": r.created_by_name,
        "created_at": r.created_at.isoformat(),
        "done_at": r.done_at.isoformat() if r.done_at else None,
        "done_note": r.done_note,
        "row_version": r.row_version,
        "case_no": r.case_no,
        "holding_unit": r.holding_unit,
        "institution": r.inst_name,
        "can_complete": is_open and not blocked and casework and may_act,
        "can_cancel": is_open
        and (r.holding_unit_id == user.unit_id or r.created_by == user.id or user.has(Role.COMPETENT_AUTHORITY)),
    }


def for_case(db: Session, user: CurrentUser, case_id: uuid.UUID) -> list[dict]:
    rows = db.execute(
        text(LIST_SQL + " WHERE t.case_id = :c ORDER BY (t.status = 'OPEN') DESC, t.due_on NULLS LAST, t.created_at"),
        {"c": case_id},
    ).all()
    today = today_ist()
    return [payload(r, user, today) for r in rows]


def next_open(tasks: list[dict]) -> dict | None:
    """The task that answers "what must happen next, and by when": the earliest-due open, unblocked task."""
    open_ = [t for t in tasks if t["status"] == "OPEN" and not t["blocked"]]
    return min(open_, key=lambda t: (t["due_on"] is None, t["due_on"] or "", t["created_at"]), default=None)
