"""Coordination Required workflow (blueprint SOL-05, wow factor W4).

A coordination card shows the PS phrase on both cases. One unit proposes a decision (duplicate / related, each with a
lead unit; or not related, with a reason); the other unit confirms. Undecided cards escalate to the nodal officer /
Competent Authority after 3 working days. Nothing is merged automatically and no model output changes custody.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import AppError, conflict, forbidden, invalid, not_found
from app.models import CaseLink, CaseRecord, Coordination, CoordinationMessage, Unit
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.case.service import add_event
from app.modules.matching.scoring import PS_PHRASE
from app.modules.policy.roles import COORDINATION_ROLES, CurrentUser, Role
from app.modules.sla import notify as nt
from app.modules.sla import service as sla
from app.modules.sla.calendar import get_calendar, today_ist

DECISIONS = ("DUPLICATE", "RELATED", "NOT_RELATED")
FOLLOWABLE = {"RECEIVED", "REGISTERED", "UNDER_EXAMINATION", "AWAITING_INFORMATION", "REOPENED"}


def _cases(db: Session, link: CaseLink, lock: bool = False) -> tuple[CaseRecord, CaseRecord]:
    a = db.get(CaseRecord, link.left_id, with_for_update=lock)
    b = db.get(CaseRecord, link.right_id, with_for_update=lock)
    if a is None or b is None:
        raise not_found("Coordination")
    return a, b


def _next_code(db: Session) -> str:
    n = db.execute(text("SELECT nextval('coordination_no_seq')")).scalar_one()
    return f"C-{today_ist().year}-{n:05d}"


def open_coordination(
    db: Session, link: CaseLink, opened_by: CurrentUser | None, *, reason: str = "auto"
) -> Coordination:
    existing = db.query(Coordination).filter(Coordination.link_id == link.id).with_for_update().first()
    reopened = False
    if existing:
        # A pair rejected as "not related" re-opens only when new hard evidence revived the link.
        if not (existing.status == "DECIDED" and existing.decision == "NOT_RELATED" and link.status == "PROPOSED"):
            return existing
        reopened = True
    a, b = _cases(db, link)
    decide_by = get_calendar(db).add_working_days(today_ist(), 3)
    if existing:
        co = existing
        co.status, co.decision, co.proposal, co.lead_unit_id, co.decided_at = "OPEN", None, None, None, None
        co.decide_by, co.confirmed_by, co.proposed_by, co.proposed_unit_id = decide_by, None, None, None
    else:
        co = Coordination(
            id=uuid.uuid4(),
            code=_next_code(db),
            link_id=link.id,
            status="OPEN",
            decide_by=decide_by,
            opened_by=opened_by.id if opened_by else None,
        )
        db.add(co)
    db.flush()
    if reopened:
        reason = f"reopened: new evidence ({reason})"
    sla.schedule_coordination_timer(db, co.id, decide_by)
    for case, other in ((a, b), (b, a)):
        add_event(
            db,
            case,
            "COORDINATION_OPENED",
            opened_by,
            data={
                "coordination": co.code,
                "phrase": PS_PHRASE,
                "other_case": other.case_no,
                "link_type": link.link_type,
                "probability": round(link.probability, 3),
                "reason": reason,
            },
        )
    recipients = [
        a.holding_officer_id,
        b.holding_officer_id,
        *nt.unit_heads(db, a.holding_unit_id),
        *nt.unit_heads(db, b.holding_unit_id),
    ]
    nt.notify(
        db,
        recipients,
        family="OVERLAP",
        severity="CRITICAL" if link.link_type == "P" else "WARNING",
        title=f"{PS_PHRASE}: {a.case_no} ↔ {b.case_no}",
        body=f"Decide by {decide_by.strftime('%d-%m-%Y')}. Open the coordination card for reasons.",
        link=f"/coordination/{co.code}",
        case_id=a.id,
        key=f"coord:{co.id}:opened:{decide_by}",
    )
    chain.record(
        db,
        "coordination.opened",
        actor_id=opened_by.id if opened_by else None,
        actor_unit_id=opened_by.unit_id if opened_by else None,
        entity_type="coordination",
        entity_id=co.code,
        payload={
            "link_id": str(link.id),
            "cases": [a.case_no, b.case_no],
            "type": link.link_type,
            "probability": round(link.probability, 3),
            "reason": reason,
        },
    )
    return co


def get_coordination(db: Session, code_or_id: str, lock: bool = False) -> Coordination:
    q = db.query(Coordination)
    try:
        q = q.filter(Coordination.id == uuid.UUID(code_or_id))
    except ValueError:
        q = q.filter(Coordination.code == code_or_id)
    if lock:
        q = q.with_for_update()
    co = q.first()
    if co is None:
        raise not_found("Coordination")
    return co


def side_of(user: CurrentUser, a: CaseRecord, b: CaseRecord) -> uuid.UUID | None:
    if user.unit_id in (a.holding_unit_id, b.holding_unit_id) and user.has(*COORDINATION_ROLES):
        return user.unit_id
    return None


def is_participant(user: CurrentUser, a: CaseRecord, b: CaseRecord) -> bool:
    return side_of(user, a, b) is not None or user.has(Role.NODAL_OFFICER, Role.COMPETENT_AUTHORITY)


def _unit_by_code(db: Session, code: str) -> Unit:
    unit = db.query(Unit).filter(Unit.code == code).first()
    if unit is None:
        raise invalid(f"Unknown unit {code}.")
    return unit


def propose(
    db: Session,
    user: CurrentUser,
    co: Coordination,
    *,
    decision: str,
    lead_unit_code: str | None,
    joint_next_action: str | None,
    joint_due: dt.date | None,
    remarks: str | None,
    expected_version: int | None,
) -> Coordination:
    if expected_version is not None and expected_version != co.row_version:
        raise AppError(
            409,
            "Coordination changed",
            "The other unit updated this card. Reload and try again.",
            "stale-version",
            current_version=co.row_version,
        )
    if co.status == "DECIDED":
        raise conflict("This coordination has already been decided.")
    link = db.get(CaseLink, co.link_id)
    a, b = _cases(db, link, lock=True)
    escalated_authority = co.status == "ESCALATED" and user.has(Role.NODAL_OFFICER, Role.COMPETENT_AUTHORITY)
    my_side = side_of(user, a, b)
    if my_side is None and not escalated_authority:
        raise forbidden(
            "Only officers of the two units (or, after escalation, the nodal officer or Competent "
            "Authority) can decide this coordination."
        )
    if decision not in DECISIONS:
        raise invalid("Decision must be DUPLICATE, RELATED or NOT_RELATED.")
    remarks = (remarks or "").strip() or None
    lead_unit_id = None
    if decision == "NOT_RELATED":
        if not remarks:
            raise invalid("Give a reason when the cases are not related.", field="remarks")
    else:
        if not lead_unit_code:
            raise invalid("Choose the lead unit.", field="lead_unit")
        lead = _unit_by_code(db, lead_unit_code)
        if lead.id not in (a.holding_unit_id, b.holding_unit_id):
            raise invalid("The lead unit must be one of the two units holding these cases.", field="lead_unit")
        lead_unit_id = lead.id
    if joint_due and joint_due < today_ist():
        raise invalid("The joint deadline cannot be in the past.", field="joint_due")
    proposal = {
        "decision": decision,
        "lead_unit_id": str(lead_unit_id) if lead_unit_id else None,
        "lead_unit": lead_unit_code if lead_unit_id else None,
        "joint_next_action": joint_next_action,
        "joint_due": joint_due.isoformat() if joint_due else None,
        "remarks": remarks,
        "by": user.full_name,
        "by_unit": user.unit_code,
    }
    co.proposal, co.proposed_by, co.proposed_unit_id = proposal, user.id, user.unit_id
    co.proposed_at = dt.datetime.now(dt.UTC)
    chain.record(
        db,
        "coordination.proposed",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="coordination",
        entity_id=co.code,
        payload=proposal,
    )
    if escalated_authority:
        return _apply(db, user, co, link, a, b)
    co.status = "AWAITING_CONFIRMATION"
    other_unit = b.holding_unit_id if my_side == a.holding_unit_id else a.holding_unit_id
    if a.holding_unit_id == b.holding_unit_id:
        other_unit = my_side
    other_case = b if other_unit == b.holding_unit_id else a
    nt.notify(
        db,
        [other_case.holding_officer_id, *nt.unit_heads(db, other_unit)],
        family="COORDINATION",
        severity="WARNING",
        title=f"{user.unit_code} proposed '{decision.replace('_', ' ').lower()}' on {co.code}",
        body="Confirm or propose a different decision.",
        link=f"/coordination/{co.code}",
        case_id=other_case.id,
        key=f"coord:{co.id}:proposal:{co.proposed_at.isoformat()}",
    )
    return co


def confirm(db: Session, user: CurrentUser, co: Coordination, expected_version: int | None) -> Coordination:
    if expected_version is not None and expected_version != co.row_version:
        raise AppError(
            409,
            "Coordination changed",
            "The other unit updated this card. Reload and try again.",
            "stale-version",
            current_version=co.row_version,
        )
    if co.status != "AWAITING_CONFIRMATION" or not co.proposal:
        raise conflict("There is no proposal waiting for confirmation.")
    link = db.get(CaseLink, co.link_id)
    a, b = _cases(db, link, lock=True)
    my_side = side_of(user, a, b)
    same_unit = a.holding_unit_id == b.holding_unit_id
    if my_side is None and not user.has(Role.NODAL_OFFICER, Role.COMPETENT_AUTHORITY):
        raise forbidden("Only the other unit can confirm this proposal.")
    if my_side == co.proposed_unit_id and not same_unit:
        raise forbidden("The proposal must be confirmed by the other unit.")
    if same_unit and user.id == co.proposed_by:
        raise forbidden("Another officer must confirm a proposal within the same unit.")
    return _apply(db, user, co, link, a, b)


def _apply(
    db: Session, user: CurrentUser, co: Coordination, link: CaseLink, a: CaseRecord, b: CaseRecord
) -> Coordination:
    p: dict[str, Any] = co.proposal or {}
    decision = p["decision"]
    now = dt.datetime.now(dt.UTC)
    co.decision, co.remarks, co.confirmed_by, co.decided_at, co.status = (
        decision,
        p.get("remarks"),
        user.id,
        now,
        "DECIDED",
    )
    co.lead_unit_id = uuid.UUID(p["lead_unit_id"]) if p.get("lead_unit_id") else None
    co.joint_next_action = p.get("joint_next_action")
    co.joint_due = dt.date.fromisoformat(p["joint_due"]) if p.get("joint_due") else None
    sla.cancel_coordination_timers(db, co.id)

    if decision == "NOT_RELATED":
        link.status = "REJECTED"
    else:
        link.status = "CONFIRMED"
        if decision == "DUPLICATE":
            link.link_type = "D"
        elif link.link_type not in ("P", "R"):
            link.link_type = "R"
    link.updated_at = now

    follower_no = None
    if decision == "DUPLICATE" and co.lead_unit_id:
        lead, follower = (a, b) if a.holding_unit_id == co.lead_unit_id else (b, a)
        if follower.holding_unit_id == co.lead_unit_id:  # both in the lead unit: the later case follows
            lead, follower = sorted((a, b), key=lambda c: c.received_on)
        if follower.status in FOLLOWABLE:
            prev = follower.status
            follower.status = "LINKED_FOLLOWS_LEAD"
            follower.updated_at = now
            add_event(
                db,
                follower,
                "ACTION",
                user,
                action="FOLLOW_LEAD",
                from_status=prev,
                to_status="LINKED_FOLLOWS_LEAD",
                remarks=f"Duplicate of {lead.case_no}; follows the lead case.",
                data={"coordination": co.code, "lead_case": lead.case_no},
            )
            follower_no = follower.case_no

    if co.joint_due and decision != "NOT_RELATED":
        from app.modules.tasks import service as tasks  # tasks import the case module, as this module does

        sla.schedule_joint_due(db, co.id, [a.id, b.id], co.joint_due)
        for c in (a, b):
            if c.status not in fsm.TERMINAL:
                c.next_action, c.next_action_due = (
                    co.joint_next_action or "Joint action agreed in coordination",
                    co.joint_due,
                )
                # An agreed joint step with a deadline becomes a task on each case, owned by its holding unit.
                tasks.create(
                    db,
                    user,
                    c,
                    title=co.joint_next_action or "Joint action agreed in coordination",
                    owner_id=c.holding_officer_id,
                    due_on=co.joint_due,
                    source="COORDINATION",
                    source_ref=co.code,
                )

    lead_code = p.get("lead_unit")
    for case, other in ((a, b), (b, a)):
        add_event(
            db,
            case,
            "COORDINATION_DECIDED",
            user,
            remarks=co.remarks,
            data={
                "coordination": co.code,
                "decision": decision,
                "lead_unit": lead_code,
                "joint_next_action": co.joint_next_action,
                "joint_due": co.joint_due.isoformat() if co.joint_due else None,
                "other_case": other.case_no,
                "follower": follower_no,
            },
        )
    recipients = [a.holding_officer_id, b.holding_officer_id, co.proposed_by]
    nt.notify(
        db,
        recipients,
        family="COORDINATION",
        title=f"{co.code} decided: {decision.replace('_', ' ').lower()}"
        + (f", {lead_code} leads" if lead_code else ""),
        link=f"/coordination/{co.code}",
        case_id=a.id,
        key=f"coord:{co.id}:decided",
    )
    chain.record(
        db,
        "coordination.decided",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="coordination",
        entity_id=co.code,
        payload={
            "decision": decision,
            "lead_unit": lead_code,
            "cases": [a.case_no, b.case_no],
            "follower": follower_no,
        },
    )
    return co


def request_verification(
    db: Session,
    user: CurrentUser,
    co: Coordination,
    *,
    remarks: str,
    verify_by: dt.date | None,
    expected_version: int | None,
) -> Coordination:
    """Ministry note p. 4, step 2: the reviewing officer can mark the link as needing verification instead of
    deciding. The card stays undecided (the guard still warns), any pending proposal is cleared, and the escalation
    clock moves to the verification date, so an unanswered verification still escalates."""
    if expected_version is not None and expected_version != co.row_version:
        raise AppError(
            409,
            "Coordination changed",
            "The other unit updated this card. Reload and try again.",
            "stale-version",
            current_version=co.row_version,
        )
    if co.status == "DECIDED":
        raise conflict("This coordination has already been decided.")
    link = db.get(CaseLink, co.link_id)
    a, b = _cases(db, link, lock=True)
    if side_of(user, a, b) is None and not user.has(Role.NODAL_OFFICER, Role.COMPETENT_AUTHORITY):
        raise forbidden("Only officers of the two units, the nodal officer or the Competent Authority can do this.")
    remarks = (remarks or "").strip()
    if len(remarks) < 10:
        raise invalid("Say what must be verified (at least 10 characters).", field="remarks")
    cal, today = get_calendar(db), today_ist()
    verify_by = verify_by or cal.add_working_days(today, 5)
    if verify_by <= today or verify_by > cal.add_working_days(today, 10):
        raise invalid("Set a verification date within the next 10 working days.", field="verify_by")
    sla.cancel_coordination_timers(db, co.id)
    co.status, co.decide_by = "VERIFYING", verify_by
    co.proposal = co.proposed_by = co.proposed_unit_id = co.proposed_at = None
    co.verification = {
        "what": remarks,
        "by": user.full_name,
        "by_unit": user.unit_code,
        "verify_by": verify_by.isoformat(),
        "at": dt.datetime.now(dt.UTC).isoformat(),
    }
    sla.schedule_coordination_timer(db, co.id, verify_by)
    for case, other in ((a, b), (b, a)):
        add_event(
            db,
            case,
            "COORDINATION_VERIFYING",
            user,
            remarks=remarks,
            data={"coordination": co.code, "other_case": other.case_no, "verify_by": verify_by.isoformat()},
        )
    other_unit = b.holding_unit_id if user.unit_id == a.holding_unit_id else a.holding_unit_id
    other_case = b if other_unit == b.holding_unit_id else a
    nt.notify(
        db,
        [other_case.holding_officer_id, *nt.unit_heads(db, other_unit)],
        family="COORDINATION",
        severity="WARNING",
        title=f"{user.unit_code} needs verification on {co.code} before deciding",
        body=f"Verify by {verify_by.strftime('%d-%m-%Y')}.",
        link=f"/coordination/{co.code}",
        case_id=other_case.id,
        key=f"coord:{co.id}:verify:{verify_by}",
    )
    chain.record(
        db,
        "coordination.verification_requested",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="coordination",
        entity_id=co.code,
        payload={"verify_by": verify_by.isoformat()},
    )
    return co


def escalate(db: Session, co: Coordination, by: CurrentUser | None, reason: str) -> Coordination:
    if co.status in ("DECIDED", "ESCALATED"):
        return co
    link = db.get(CaseLink, co.link_id)
    a, b = _cases(db, link, lock=True)
    if by is not None and not is_participant(by, a, b):
        raise forbidden("Only participants can escalate this coordination.")
    co.status, co.escalated_at = "ESCALATED", dt.datetime.now(dt.UTC)
    for case in (a, b):
        case.escalated = True
        add_event(db, case, "ESCALATED", by, remarks=reason, data={"coordination": co.code})
    recipients = [
        *nt.users_with_role(db, "NODAL_OFFICER"),
        *nt.users_with_role(db, "COMPETENT_AUTHORITY"),
        *nt.unit_heads(db, a.holding_unit_id),
        *nt.unit_heads(db, b.holding_unit_id),
    ]
    nt.notify(
        db,
        recipients,
        family="ESCALATION",
        severity="CRITICAL",
        title=f"Coordination {co.code} escalated",
        body=reason,
        link=f"/coordination/{co.code}",
        case_id=a.id,
        key=f"coord:{co.id}:escalated",
    )
    chain.record(
        db,
        "coordination.escalated",
        actor_id=by.id if by else None,
        actor_unit_id=by.unit_id if by else None,
        entity_type="coordination",
        entity_id=co.code,
        payload={"reason": reason},
    )
    return co


def post_message(db: Session, user: CurrentUser, co: Coordination, body: str) -> CoordinationMessage:
    link = db.get(CaseLink, co.link_id)
    a, b = _cases(db, link)
    if not is_participant(user, a, b):
        raise forbidden("Only participating units can write in this coordination room.")
    body = body.strip()
    if not body:
        raise invalid("Message cannot be empty.")
    msg = CoordinationMessage(coordination_id=co.id, author_id=user.id, unit_id=user.unit_id, body=body[:4000])
    db.add(msg)
    db.flush()
    other = b if user.unit_id == a.holding_unit_id else a
    nt.notify(
        db,
        [other.holding_officer_id],
        family="COORDINATION",
        title=f"New message in {co.code}",
        link=f"/coordination/{co.code}",
        case_id=other.id,
        key=f"coord-msg:{msg.id}",
    )
    chain.record(
        db,
        "coordination.message",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="coordination",
        entity_id=co.code,
        payload={"message_id": str(msg.id)},
    )
    return msg


def open_manual(db: Session, user: CurrentUser, case: CaseRecord, other: CaseRecord, reason: str) -> Coordination:
    """Open coordination from an officer's own initiative (guard choice or 'link case')."""
    if not is_participant(user, case, other):
        raise forbidden("You can open coordination only on cases your unit holds.")
    left, right = sorted((case.id, other.id), key=str)
    link = db.query(CaseLink).filter(CaseLink.left_id == left, CaseLink.right_id == right).first()
    if link is None:
        link = CaseLink(
            id=uuid.uuid4(),
            left_id=left,
            right_id=right,
            link_type="R",
            probability=0.0,
            score=0.0,
            reasons=[{"code": "officer_linked", "label": f"Linked by {user.unit_code} officer", "weight": 0}],
            model_version="manual",
            status="PROPOSED",
        )
        db.add(link)
        db.flush()
    elif link.status == "REJECTED":
        link.status = "PROPOSED"
    return open_coordination(db, link, user, reason=reason)
