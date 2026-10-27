"""Inter-bureau assistance (ministry note p. 13, routing action B): the holding unit keeps the case while another unit
provides input or performs a task. Lifecycle SENT → ACCEPTED → COMPLETED, or DECLINED (with a reason and, optionally,
a better-placed unit) or CANCELLED by the requester. The assisting unit sees the case's content only while its request
is open (row-level security, migration 0003).
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, conflict, forbidden, invalid, not_found
from app.models import AssistanceRequest, CaseRecord, Unit
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.case.service import add_event
from app.modules.policy.roles import CASEWORK_ROLES, CurrentUser, Role
from app.modules.sla import notify as nt
from app.modules.sla import service as sla
from app.modules.sla.calendar import get_calendar, today_ist

KINDS = {
    "VERIFICATION": "Verification visit",
    "INFORMATION": "Information or records",
    "OPINION": "Opinion or advice",
    "ACTION": "Action within its mandate",
}
OPEN = ("SENT", "ACCEPTED")
MIN_REASON = 10


def _next_code(db: Session) -> str:
    n = db.execute(text("SELECT nextval('assistance_no_seq')")).scalar_one()
    return f"A-{today_ist().year}-{n:05d}"


def _audit(db: Session, user: CurrentUser, action: str, req: AssistanceRequest, payload: dict) -> None:
    chain.record(
        db,
        action,
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="assistance",
        entity_id=req.code,
        payload=payload,
    )


def request(
    db: Session,
    user: CurrentUser,
    case: CaseRecord,
    *,
    to_unit_code: str,
    kind: str,
    body: str,
    due_on: dt.date | None,
    followed_recommendation: bool = False,
) -> AssistanceRequest:
    if case.holding_unit_id != user.unit_id and not user.has(Role.COMPETENT_AUTHORITY):
        raise forbidden("Only the unit holding this case can ask another unit for assistance.")
    user.require(CASEWORK_ROLES, "request assistance")
    if case.status in fsm.TERMINAL:
        raise invalid("Closed cases cannot be sent for assistance.")
    if case.sensitivity == "SEALED":
        raise forbidden("Sealed matters are coordinated through the nodal officer, not by assistance requests.")
    if kind not in KINDS:
        raise invalid("Choose what kind of assistance is needed.", field="kind")
    body = (body or "").strip()
    if len(body) < MIN_REASON:
        raise invalid("Say what you need from the other unit (at least 10 characters).", field="request")
    to_unit = db.query(Unit).filter(Unit.code == to_unit_code, Unit.is_active).first()
    if to_unit is None or to_unit.id == case.holding_unit_id:
        raise invalid("Choose another active unit.", field="to_unit")
    today = today_ist()
    due_on = due_on or get_calendar(db).add_working_days(today, 5)
    if due_on <= today:
        raise invalid("The due date must be after today.", field="due_on")
    already = (
        db.query(AssistanceRequest.code)
        .filter(
            AssistanceRequest.case_id == case.id,
            AssistanceRequest.to_unit_id == to_unit.id,
            AssistanceRequest.status.in_(OPEN),
        )
        .first()
    )
    if already:
        raise conflict(f"{to_unit.code} already has an open request on this case ({already.code}).")
    req = AssistanceRequest(
        id=uuid.uuid4(),
        code=_next_code(db),
        case_id=case.id,
        from_unit_id=case.holding_unit_id,
        to_unit_id=to_unit.id,
        kind=kind,
        request=body,
        due_on=due_on,
        requested_by=user.id,
        followed_recommendation=followed_recommendation,
    )
    try:
        # begin_nested() flushes pending objects first, so the insert must be added inside the savepoint for a
        # concurrent duplicate to roll back only the savepoint.
        with db.begin_nested():
            db.add(req)
            db.flush()
    except IntegrityError:
        raise conflict(f"{to_unit.code} already has an open request on this case.") from None
    add_event(
        db,
        case,
        "ASSISTANCE_REQUESTED",
        user,
        from_unit=case.holding_unit_id,
        to_unit=to_unit.id,
        remarks=body,
        data={
            "assistance": req.code,
            "kind": kind,
            "to_unit": to_unit.code,
            "due_on": due_on.isoformat(),
            "followed_recommendation": followed_recommendation,
        },
    )
    sla.schedule_assistance_timers(db, req.id, case.id, today, due_on)
    nt.notify(
        db,
        [*nt.unit_officers(db, to_unit.id)],
        family="ASSISTANCE",
        severity="WARNING",
        title=f"{user.unit_code} asks for {KINDS[kind].lower()}: {case.case_no}",
        body=f"Due {due_on.strftime('%d-%m-%Y')}. {user.unit_code} keeps the case.",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"assist:{req.id}:sent",
    )
    _audit(db, user, "assistance.requested", req, {"case": case.case_no, "to": to_unit.code, "kind": kind})
    return req


def _open(db: Session, request_id: uuid.UUID) -> tuple[AssistanceRequest, CaseRecord]:
    req = db.get(AssistanceRequest, request_id, with_for_update=True)
    if req is None:
        raise not_found("Assistance request")
    if req.status not in OPEN:
        raise conflict("This request is already closed.")
    case = db.get(CaseRecord, req.case_id)
    if case is None:
        raise not_found("Case")
    return req, case


def _check_version(req: AssistanceRequest, expected: int | None) -> None:
    if expected is not None and expected != req.row_version:
        raise AppError(
            409,
            "Request changed",
            "The other unit updated this request. Reload and try again.",
            "stale-version",
            current_version=req.row_version,
        )


def _as_receiver(user: CurrentUser, req: AssistanceRequest, what: str) -> None:
    if user.unit_id != req.to_unit_id:
        raise forbidden(f"Only the unit asked for assistance can {what}.")
    user.require(CASEWORK_ROLES, what)


def _requester_side(db: Session, req: AssistanceRequest, case: CaseRecord) -> list:
    return [req.requested_by, case.holding_officer_id, *nt.unit_heads(db, req.from_unit_id)]


def accept(
    db: Session, user: CurrentUser, request_id: uuid.UUID, assignee_id: uuid.UUID | None, expected: int | None
) -> AssistanceRequest:
    req, case = _open(db, request_id)
    _check_version(req, expected)
    _as_receiver(user, req, "accept it")
    if req.status != "SENT":
        raise conflict("This request has already been accepted.")
    req.status, req.assignee_id = "ACCEPTED", assignee_id or user.id
    add_event(
        db,
        case,
        "ASSISTANCE_ACCEPTED",
        user,
        data={"assistance": req.code, "to_unit": user.unit_code, "due_on": req.due_on.isoformat()},
    )
    sla.cancel_assistance_timers(db, req.id, ("ASSIST_REMINDER",))
    nt.notify(
        db,
        [req.requested_by],
        family="ASSISTANCE",
        title=f"{user.unit_code} accepted {req.code} on {case.case_no}",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"assist:{req.id}:accepted",
    )
    _audit(db, user, "assistance.accepted", req, {"assignee": str(req.assignee_id)})
    return req


def decline(
    db: Session,
    user: CurrentUser,
    request_id: uuid.UUID,
    reason: str,
    suggested_unit: str | None,
    expected: int | None,
) -> AssistanceRequest:
    req, case = _open(db, request_id)
    _check_version(req, expected)
    _as_receiver(user, req, "decline it")
    reason = (reason or "").strip()
    if len(reason) < MIN_REASON:
        raise invalid("Give the requesting unit a reason (at least 10 characters).", field="reason")
    if suggested_unit and not db.query(Unit).filter(Unit.code == suggested_unit, Unit.is_active).first():
        raise invalid("Unknown unit.", field="suggested_unit")
    now = dt.datetime.now(dt.UTC)
    req.status, req.response, req.responded_by, req.responded_at = "DECLINED", reason, user.id, now
    req.suggested_unit = suggested_unit or None
    add_event(
        db,
        case,
        "ASSISTANCE_DECLINED",
        user,
        remarks=reason,
        data={"assistance": req.code, "to_unit": user.unit_code, "suggested_unit": req.suggested_unit},
    )
    sla.cancel_assistance_timers(db, req.id)
    nt.notify(
        db,
        _requester_side(db, req, case),
        family="ASSISTANCE",
        severity="WARNING",
        title=f"{user.unit_code} declined {req.code} on {case.case_no}"
        + (f"; suggests {req.suggested_unit}" if req.suggested_unit else ""),
        body="The case stays with your unit. See the timeline for the reason.",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"assist:{req.id}:declined",
    )
    _audit(db, user, "assistance.declined", req, {"suggested_unit": req.suggested_unit})
    return req


def complete(
    db: Session, user: CurrentUser, request_id: uuid.UUID, response: str, expected: int | None
) -> AssistanceRequest:
    req, case = _open(db, request_id)
    _check_version(req, expected)
    _as_receiver(user, req, "complete it")
    response = (response or "").strip()
    if len(response) < MIN_REASON:
        raise invalid("Record what was done or found (at least 10 characters).", field="response")
    now = dt.datetime.now(dt.UTC)
    if req.status == "SENT":
        req.assignee_id = user.id
    req.status, req.response, req.responded_by, req.responded_at = "COMPLETED", response, user.id, now
    add_event(
        db,
        case,
        "ASSISTANCE_COMPLETED",
        user,
        remarks=response,
        data={"assistance": req.code, "to_unit": user.unit_code, "on_time": today_ist() <= req.due_on},
    )
    sla.cancel_assistance_timers(db, req.id)
    nt.notify(
        db,
        _requester_side(db, req, case),
        family="ASSISTANCE",
        severity="WARNING",
        title=f"{user.unit_code} completed {req.code} on {case.case_no}",
        body="Review the response on the case timeline.",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"assist:{req.id}:completed",
    )
    _audit(db, user, "assistance.completed", req, {"on_time": today_ist() <= req.due_on})
    return req


def cancel(db: Session, user: CurrentUser, request_id: uuid.UUID, reason: str) -> AssistanceRequest:
    req, case = _open(db, request_id)
    if user.unit_id != req.from_unit_id and not user.has(Role.COMPETENT_AUTHORITY):
        raise forbidden("Only the requesting unit can withdraw this request.")
    reason = (reason or "").strip()
    if len(reason) < MIN_REASON:
        raise invalid("Give a reason for withdrawing (at least 10 characters).", field="reason")
    req.status, req.response, req.responded_by = "CANCELLED", reason, user.id
    req.responded_at = dt.datetime.now(dt.UTC)
    add_event(db, case, "ASSISTANCE_CANCELLED", user, remarks=reason, data={"assistance": req.code})
    sla.cancel_assistance_timers(db, req.id)
    nt.notify(
        db,
        [req.assignee_id, *nt.unit_heads(db, req.to_unit_id)],
        family="ASSISTANCE",
        title=f"{user.unit_code} withdrew {req.code} on {case.case_no}",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"assist:{req.id}:cancelled",
    )
    _audit(db, user, "assistance.cancelled", req, {})
    return req


LIST_SQL = """
SELECT a.id, a.code, a.kind, a.request, a.due_on, a.status, a.requested_at, a.responded_at, a.response,
       a.suggested_unit, a.row_version, a.followed_recommendation,
       c.case_no, c.status AS case_status, cat.name AS category, i.name AS inst_name, i.permanent_id,
       fu.code AS from_unit, tu.code AS to_unit, ru.full_name AS requested_by, au.full_name AS assignee,
       a.to_unit_id, a.from_unit_id
FROM assistance_request a
JOIN case_record c ON c.id = a.case_id
JOIN category cat ON cat.code = c.category_code
JOIN unit fu ON fu.id = a.from_unit_id
JOIN unit tu ON tu.id = a.to_unit_id
JOIN app_user ru ON ru.id = a.requested_by
LEFT JOIN app_user au ON au.id = a.assignee_id
LEFT JOIN institution i ON i.id = c.institution_id
"""


def payload(r, user: CurrentUser) -> dict:
    is_open = r.status in OPEN
    receiver = r.to_unit_id == user.unit_id
    return {
        "id": str(r.id),
        "code": r.code,
        "kind": r.kind,
        "kind_label": KINDS.get(r.kind, r.kind),
        "request": r.request,
        "due_on": r.due_on.isoformat(),
        "overdue": is_open and r.due_on < today_ist(),
        "status": r.status,
        "requested_at": r.requested_at.isoformat(),
        "responded_at": r.responded_at.isoformat() if r.responded_at else None,
        "response": r.response,
        "suggested_unit": r.suggested_unit,
        "row_version": r.row_version,
        "followed_recommendation": r.followed_recommendation,
        "case_no": r.case_no,
        "case_status": r.case_status,
        "case_status_label": fsm.STATUS_LABELS.get(r.case_status, r.case_status),
        "category": r.category,
        "institution": {"name": r.inst_name, "permanent_id": r.permanent_id} if r.inst_name else None,
        "from_unit": r.from_unit,
        "to_unit": r.to_unit,
        "requested_by": r.requested_by,
        "assignee": r.assignee,
        "can_respond": is_open and receiver and user.has(*CASEWORK_ROLES),
        "can_cancel": is_open and (r.from_unit_id == user.unit_id or user.has(Role.COMPETENT_AUTHORITY)),
    }


def for_case(db: Session, user: CurrentUser, case_id: uuid.UUID) -> list[dict]:
    rows = db.execute(text(LIST_SQL + " WHERE a.case_id = :c ORDER BY a.requested_at DESC"), {"c": case_id}).all()
    return [payload(r, user) for r in rows]
