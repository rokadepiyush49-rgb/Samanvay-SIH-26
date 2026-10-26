"""Action Conflict Guard (blueprint SOL-06, wow factor W1).

Before a consequential action (show-cause, committee visit, hearing notice, letter, closure) the officer sees every
open matter on the same institution held by other units, plus undecided overlap proposals, and must record a choice.
Other units' cases are shown as metadata only; sealed matters are reduced to "a restricted matter exists".
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import forbidden, invalid
from app.models import CaseRecord, GuardCheck
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.policy.roles import CurrentUser, Role

CHOICES_WHEN_CONFLICT = ("OPEN_COORDINATION", "PROCEED_AND_NOTIFY", "CANCEL")
CHOICES_WHEN_CLEAR = ("PROCEED", "CANCEL")
MIN_REASON = 10

_FOUND_SQL = text(
    """
    WITH linked AS (
      SELECT CASE WHEN l.left_id = :c THEN l.right_id ELSE l.left_id END AS other_id, l.id AS link_id, l.link_type,
             l.probability, l.status AS link_status, co.id AS coordination_id, co.code AS coordination_code,
             co.status AS coordination_status, co.decision, co.lead_unit_id
      FROM case_link l LEFT JOIN coordination co ON co.link_id = l.id
      WHERE (l.left_id = :c OR l.right_id = :c) AND l.status <> 'REJECTED' AND l.link_type IN ('D', 'P', 'R', 'C')
    )
    SELECT o.id AS case_id, o.case_no, o.status, o.holding_unit_id AS unit_id, u.code AS unit_code,
           o.holding_officer_id, cat.name AS category, li.link_id, li.link_type, li.probability, li.link_status,
           li.coordination_id, li.coordination_code, li.coordination_status, li.decision, lu.code AS lead_unit
    FROM case_record o
    JOIN unit u ON u.id = o.holding_unit_id
    JOIN category cat ON cat.code = o.category_code
    LEFT JOIN linked li ON li.other_id = o.id
    LEFT JOIN unit lu ON lu.id = li.lead_unit_id
    WHERE o.id <> :c AND o.status <> ALL(:terminal)
      AND (li.other_id IS NOT NULL OR (o.institution_id = :inst AND o.holding_unit_id <> :unit))
    ORDER BY li.probability DESC NULLS LAST, o.received_on DESC
    """
)


def run_guard(db: Session, user: CurrentUser, case: CaseRecord, action: str) -> GuardCheck:
    if case.holding_unit_id != user.unit_id and not user.has(Role.COMPETENT_AUTHORITY):
        raise forbidden("Only the unit holding this case can act on it.")
    if action not in fsm.consequential_actions(db):
        raise invalid(f"{action} is not a consequential action.")
    rows = db.execute(
        _FOUND_SQL,
        {"c": case.id, "inst": case.institution_id, "unit": case.holding_unit_id, "terminal": list(fsm.TERMINAL)},
    ).all()
    found = []
    undecided = False
    for r in rows:
        decided = r.coordination_status == "DECIDED" and r.decision != "NOT_RELATED"
        if r.link_id is None and r.unit_id == case.holding_unit_id:
            continue
        if not decided:
            undecided = True
        found.append(
            {
                "case_id": str(r.case_id),
                "case_no": r.case_no,
                "unit_id": str(r.unit_id),
                "unit_code": r.unit_code,
                "status": r.status,
                "status_label": fsm.STATUS_LABELS.get(r.status, r.status),
                "category": r.category,
                "holding_officer_id": str(r.holding_officer_id) if r.holding_officer_id else None,
                "link_id": str(r.link_id) if r.link_id else None,
                "link_type": r.link_type or "C",
                "probability": round(r.probability, 3) if r.probability is not None else None,
                "coordination_id": str(r.coordination_id) if r.coordination_id else None,
                "coordination_code": r.coordination_code,
                "coordination_status": r.coordination_status,
                "decision": r.decision,
                "lead_unit": r.lead_unit,
                "decided": decided,
            }
        )
    restricted = bool(
        case.institution_id
        and db.execute(
            text("SELECT smv_restricted_matter_exists(:i, :c)"), {"i": case.institution_id, "c": case.id}
        ).scalar()
    )
    if not found and not restricted:
        result = "NO_CONFLICT"
    elif undecided or restricted:
        result = "COORDINATION_SUGGESTED"
    else:
        result = "COORDINATED"
    gc = GuardCheck(
        id=uuid.uuid4(),
        case_id=case.id,
        action=action,
        result=result,
        found=found,
        restricted_exists=restricted,
        fallback=case.matched_at is None,
        actor_id=user.id,
    )
    db.add(gc)
    db.flush()
    chain.record(
        db,
        "guard.checked",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="case",
        entity_id=case.case_no,
        payload={
            "guard_check_id": str(gc.id),
            "action": action,
            "result": result,
            "other_cases": [f["case_no"] for f in found],
            "restricted": restricted,
        },
    )
    return gc


def choices_for(gc: GuardCheck) -> tuple[str, ...]:
    return CHOICES_WHEN_CONFLICT if gc.result == "COORDINATION_SUGGESTED" else CHOICES_WHEN_CLEAR


def apply_choice(db: Session, user: CurrentUser, gc: GuardCheck, choice: str, reason: str | None) -> None:
    if gc.choice is not None:
        if gc.choice != choice:
            raise invalid("A different choice was already recorded for this check. Run the guard again.")
        return
    allowed = choices_for(gc)
    if choice == "PROCEED" and gc.result == "COORDINATED":
        allowed = (*allowed, "PROCEED_AND_NOTIFY")
    if choice not in allowed:
        raise invalid(f"Choose one of: {', '.join(allowed)}.")
    reason = (reason or "").strip() or None
    if choice == "PROCEED_AND_NOTIFY" and gc.result == "COORDINATION_SUGGESTED":
        if not user.has(Role.UNIT_HEAD, Role.CASE_OFFICER, Role.REGIONAL_OFFICER, Role.COMPETENT_AUTHORITY):
            raise forbidden("Your role cannot proceed past an undecided overlap.")
        if not reason or len(reason) < MIN_REASON:
            raise invalid(
                "Give a reason (at least 10 characters) for proceeding before coordination.", field="guard_reason"
            )
    gc.choice, gc.reason = choice, reason
    chain.record(
        db,
        "guard.choice",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="guard_check",
        entity_id=gc.id,
        payload={"choice": choice, "reason": reason, "result": gc.result},
    )


def guard_payload(gc: GuardCheck) -> dict:
    return {
        "guard_check_id": str(gc.id),
        "action": gc.action,
        "result": gc.result,
        "other_matters": gc.found,
        "restricted_matter_exists": gc.restricted_exists,
        "restricted_note": "A restricted matter exists on this institution — contact the nodal officer."
        if gc.restricted_exists
        else None,
        "fallback": gc.fallback,
        "fallback_note": "Overlap matching has not finished for this case; showing same-institution matters only."
        if gc.fallback
        else None,
        "choices": list(choices_for(gc)),
        "choice": gc.choice,
    }
