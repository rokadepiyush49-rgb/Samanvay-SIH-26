"""Case statuses and the table-driven state machine (transition_rule rows)."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

STATUSES = [
    "RECEIVED",
    "REGISTERED",
    "REJECTED_AT_INTAKE",
    "UNDER_EXAMINATION",
    "AWAITING_INFORMATION",
    "ACTION_INITIATED",
    "HEARING",
    "DECISION_RECORDED",
    "DISPOSED",
    "REOPENED",
    "TRANSFER_PROPOSED",
    "LINKED_FOLLOWS_LEAD",
]
TERMINAL = {"DISPOSED", "REJECTED_AT_INTAKE"}
OPEN = [s for s in STATUSES if s not in TERMINAL]
ACTION_STAGE = {"ACTION_INITIATED", "HEARING", "DECISION_RECORDED"}

STATUS_LABELS = {
    "RECEIVED": "Received",
    "REGISTERED": "Registered",
    "REJECTED_AT_INTAKE": "Rejected at intake",
    "UNDER_EXAMINATION": "Under examination",
    "AWAITING_INFORMATION": "Awaiting information",
    "ACTION_INITIATED": "Action initiated",
    "HEARING": "Hearing",
    "DECISION_RECORDED": "Decision recorded",
    "DISPOSED": "Disposed",
    "REOPENED": "Reopened",
    "TRANSFER_PROPOSED": "Transfer awaiting acceptance",
    "LINKED_FOLLOWS_LEAD": "Linked — follows lead case",
}

# The PS's reporting categories (blueprint §19.1), computed from internal statuses.
PS_BUCKETS = {
    "pending": ["RECEIVED", "REGISTERED", "AWAITING_INFORMATION", "REOPENED"],
    "under_process": ["UNDER_EXAMINATION", "ACTION_INITIATED", "HEARING", "DECISION_RECORDED", "LINKED_FOLLOWS_LEAD"],
    "disposed": ["DISPOSED"],
    "rejected": ["REJECTED_AT_INTAKE"],
    "transferred": ["TRANSFER_PROPOSED"],
}


def ps_bucket(status: str) -> str:
    for bucket, statuses in PS_BUCKETS.items():
        if status in statuses:
            return bucket
    return "pending"


@dataclass(frozen=True)
class Rule:
    from_status: str
    action: str
    to_status: str
    allowed_roles: frozenset[str]
    requires_remarks: bool
    consequential: bool
    label: str
    label_hi: str | None


_cache: tuple[float, dict[tuple[str, str], Rule]] | None = None
_lock = threading.Lock()


def rules(db: Session, max_age_s: float = 60.0) -> dict[tuple[str, str], Rule]:
    global _cache
    with _lock:
        if _cache and time.monotonic() - _cache[0] < max_age_s:
            return _cache[1]
    rows = db.execute(
        text(
            "SELECT from_status, action, to_status, allowed_roles, requires_remarks, consequential, "
            "label, label_hi FROM transition_rule"
        )
    ).all()
    table = {
        (r.from_status, r.action): Rule(
            r.from_status,
            r.action,
            r.to_status,
            frozenset(r.allowed_roles),
            r.requires_remarks,
            r.consequential,
            r.label,
            r.label_hi,
        )
        for r in rows
    }
    with _lock:
        _cache = (time.monotonic(), table)
    return table


def consequential_actions(db: Session) -> set[str]:
    return {r.action for r in rules(db).values() if r.consequential}


def action_labels(db: Session) -> dict[str, str]:
    return {r.action: r.label for r in rules(db).values()}
