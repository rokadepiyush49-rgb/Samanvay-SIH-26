"""SLA policies (versioned, data) and timers (blueprint SOL-07).

Policy choice: among active policies that match the case (channel, category group, category, unit), the one giving
the earliest due date applies ("strictest applicable timeline"), so the DARPG 21-day CPGRAMS rule is never diluted
by a longer unit timeline. The catch-all DEFAULT applies only when nothing else matches. The chosen version is pinned
on the case, so later policy edits do not change existing cases.
"""

from __future__ import annotations

import datetime as dt
import json
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import CaseRecord
from app.modules.sla.calendar import WorkCalendar, at_ist, get_calendar

CASE_TIMER_KINDS = ("SLA_REMINDER", "SLA_INTERIM", "SLA_BREACH", "SLA_ESCALATION", "JOINT_DUE")


@dataclass
class PolicyRow:
    id: int
    code: str
    version: int
    name: str
    channel: str | None
    category_code: str | None
    category_group: str | None
    unit_id: uuid.UUID | None
    day_basis: str
    target_days: int
    reminder_offsets: list[int]
    interim_reply_day: int | None
    escalate_after_days: int
    approval_status: str


def active_policies(db: Session) -> list[PolicyRow]:
    rows = db.execute(
        text(
            "SELECT DISTINCT ON (code) id, code, version, name, channel, category_code, category_group, unit_id, "
            "day_basis, target_days, reminder_offsets, interim_reply_day, escalate_after_days, approval_status "
            "FROM sla_policy WHERE is_active ORDER BY code, version DESC"
        )
    ).all()
    return [PolicyRow(**r._mapping) for r in rows]


def choose_policy(
    policies: list[PolicyRow],
    cal: WorkCalendar,
    *,
    channel: str,
    category_code: str,
    category_group: str,
    unit_id: uuid.UUID | None,
    received_on: dt.date,
) -> tuple[PolicyRow, dt.date]:
    def matches(p: PolicyRow) -> bool:
        return (
            (p.channel is None or p.channel == channel)
            and (p.category_group is None or p.category_group == category_group)
            and (p.category_code is None or p.category_code == category_code)
            and (p.unit_id is None or p.unit_id == unit_id)
        )

    def is_catch_all(p: PolicyRow) -> bool:
        return p.channel is None and p.category_group is None and p.category_code is None and p.unit_id is None

    specific = [p for p in policies if matches(p) and not is_catch_all(p)]
    pool = specific or [p for p in policies if is_catch_all(p)]
    if not pool:
        raise RuntimeError("No SLA policy is configured (the DEFAULT policy is missing).")
    best = min(pool, key=lambda p: (cal.add_days(received_on, p.target_days, p.day_basis), p.code))
    return best, cal.add_days(received_on, best.target_days, best.day_basis)


def _insert_timer(
    db: Session,
    kind: str,
    due_at: dt.datetime,
    key: str,
    *,
    case_id=None,
    transfer_id=None,
    coordination_id=None,
    assistance_id=None,
    payload: dict | None = None,
) -> None:
    db.execute(
        text(
            "INSERT INTO timer (kind, due_at, case_id, transfer_id, coordination_id, assistance_id, payload, "
            "dedupe_key) VALUES (:k, :d, :c, :t, :co, :a, CAST(:p AS jsonb), :key) ON CONFLICT (dedupe_key) DO NOTHING"
        ),
        {
            "k": kind,
            "d": due_at,
            "c": case_id,
            "t": transfer_id,
            "co": coordination_id,
            "a": assistance_id,
            "p": json.dumps(payload or {}, default=str),
            "key": key,
        },
    )


def assign_sla(db: Session, case: CaseRecord, category_group: str, *, start: dt.date | None = None) -> PolicyRow:
    """Pin a policy version on the case, set the expected disposal date and schedule its timers."""
    cal = get_calendar(db)
    start = start or case.received_on
    policy, due = choose_policy(
        active_policies(db),
        cal,
        channel=case.channel,
        category_code=case.category_code,
        category_group=category_group,
        unit_id=case.holding_unit_id,
        received_on=start,
    )
    case.sla_policy_id = policy.id
    case.expected_disposal = due
    schedule_case_timers(db, case.id, policy, start, due, cal)
    return policy


def schedule_case_timers(
    db: Session, case_id: uuid.UUID, policy: PolicyRow, start: dt.date, due: dt.date, cal: WorkCalendar
) -> None:
    gen = start.isoformat()
    for offset in sorted(set(policy.reminder_offsets or []), reverse=True):
        day = cal.add_days(due, -offset, policy.day_basis)
        if day > start:
            _insert_timer(
                db,
                "SLA_REMINDER",
                at_ist(day),
                f"case:{case_id}:{gen}:rem:{offset}",
                case_id=case_id,
                payload={"offset": offset, "basis": policy.day_basis, "due": due.isoformat()},
            )
    if policy.interim_reply_day:
        day = cal.add_days(start, policy.interim_reply_day, policy.day_basis)
        if day < due:
            _insert_timer(
                db,
                "SLA_INTERIM",
                at_ist(day),
                f"case:{case_id}:{gen}:interim",
                case_id=case_id,
                payload={"day": policy.interim_reply_day, "due": due.isoformat()},
            )
    _insert_timer(
        db,
        "SLA_BREACH",
        at_ist(due + dt.timedelta(days=1), 0),
        f"case:{case_id}:{gen}:breach",
        case_id=case_id,
        payload={"due": due.isoformat()},
    )
    esc_day = cal.add_days(due, policy.escalate_after_days, policy.day_basis)
    _insert_timer(
        db,
        "SLA_ESCALATION",
        at_ist(esc_day),
        f"case:{case_id}:{gen}:escalate",
        case_id=case_id,
        payload={"due": due.isoformat(), "after_days": policy.escalate_after_days},
    )


def cancel_case_timers(db: Session, case_id: uuid.UUID, kinds: tuple[str, ...] = CASE_TIMER_KINDS) -> None:
    db.execute(
        text(
            "UPDATE timer SET cancelled_at = now() WHERE case_id = :c AND kind = ANY(:k) "
            "AND fired_at IS NULL AND cancelled_at IS NULL"
        ),
        {"c": case_id, "k": list(kinds)},
    )


def schedule_transfer_timers(db: Session, transfer_id: uuid.UUID, case_id: uuid.UUID, proposed: dt.date) -> None:
    cal = get_calendar(db)
    _insert_timer(
        db,
        "TRANSFER_REMINDER",
        at_ist(cal.add_working_days(proposed, 2)),
        f"transfer:{transfer_id}:rem",
        case_id=case_id,
        transfer_id=transfer_id,
    )
    _insert_timer(
        db,
        "TRANSFER_ESCALATION",
        at_ist(cal.add_working_days(proposed, 5)),
        f"transfer:{transfer_id}:esc",
        case_id=case_id,
        transfer_id=transfer_id,
    )


def cancel_transfer_timers(db: Session, transfer_id: uuid.UUID) -> None:
    db.execute(
        text(
            "UPDATE timer SET cancelled_at = now() WHERE transfer_id = :t AND fired_at IS NULL AND cancelled_at IS NULL"
        ),
        {"t": transfer_id},
    )


def schedule_assistance_timers(
    db: Session, assistance_id: uuid.UUID, case_id: uuid.UUID, start: dt.date, due_on: dt.date
) -> None:
    """Remind the receiving unit if it has not acknowledged within 2 working days; escalate if the due date passes."""
    cal = get_calendar(db)
    remind = cal.add_working_days(start, 2)
    if remind < due_on:
        _insert_timer(
            db,
            "ASSIST_REMINDER",
            at_ist(remind),
            f"assist:{assistance_id}:rem",
            case_id=case_id,
            assistance_id=assistance_id,
        )
    _insert_timer(
        db,
        "ASSIST_OVERDUE",
        at_ist(cal.add_working_days(due_on, 1)),
        f"assist:{assistance_id}:overdue",
        case_id=case_id,
        assistance_id=assistance_id,
        payload={"due_on": due_on.isoformat()},
    )


def cancel_assistance_timers(db: Session, assistance_id: uuid.UUID, kinds: tuple[str, ...] | None = None) -> None:
    db.execute(
        text(
            "UPDATE timer SET cancelled_at = now() WHERE assistance_id = :a AND fired_at IS NULL "
            "AND cancelled_at IS NULL AND (CAST(:k AS text[]) IS NULL OR kind = ANY(CAST(:k AS text[])))"
        ),
        {"a": assistance_id, "k": list(kinds) if kinds else None},
    )


def schedule_task_timers(db: Session, task_id: uuid.UUID, case_id: uuid.UUID, due_on: dt.date) -> None:
    """Remind the owner the working day before a task is due, and flag it the working day after."""
    cal = get_calendar(db)
    for kind, day in (
        ("TASK_DUE", cal.add_working_days(due_on, -1)),
        ("TASK_OVERDUE", cal.add_working_days(due_on, 1)),
    ):
        _insert_timer(
            db,
            kind,
            at_ist(day),
            f"task:{task_id}:{kind}:{due_on}",
            case_id=case_id,
            payload={"task_id": str(task_id), "due_on": due_on.isoformat()},
        )


def cancel_task_timers(db: Session, task_id: uuid.UUID) -> None:
    db.execute(
        text(
            "UPDATE timer SET cancelled_at = now() WHERE payload->>'task_id' = :t AND fired_at IS NULL "
            "AND cancelled_at IS NULL"
        ),
        {"t": str(task_id)},
    )


def schedule_coordination_timer(db: Session, coordination_id: uuid.UUID, decide_by: dt.date) -> None:
    _insert_timer(
        db,
        "COORD_ESCALATION",
        at_ist(decide_by, 18),
        f"coord:{coordination_id}:esc:{decide_by}",
        coordination_id=coordination_id,
    )


def cancel_coordination_timers(db: Session, coordination_id: uuid.UUID) -> None:
    db.execute(
        text(
            "UPDATE timer SET cancelled_at = now() WHERE coordination_id = :c AND fired_at IS NULL "
            "AND cancelled_at IS NULL"
        ),
        {"c": coordination_id},
    )


def schedule_joint_due(db: Session, coordination_id: uuid.UUID, case_ids: list[uuid.UUID], joint_due: dt.date) -> None:
    cal = get_calendar(db)
    day = cal.add_working_days(joint_due, -1)
    for cid in case_ids:
        _insert_timer(
            db,
            "JOINT_DUE",
            at_ist(day),
            f"coord:{coordination_id}:joint:{cid}:{joint_due}",
            case_id=cid,
            coordination_id=coordination_id,
            payload={"joint_due": joint_due.isoformat()},
        )
