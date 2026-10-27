"""Bureau routing recommendation (ministry note pp. 13–15): rules first, every point explained.

For an open case the holding unit sees whether it should keep the case, transfer it, or ask another unit for
assistance. Each unit is scored from the unit directory (mandates), the related cases it already holds, and how past
transfers of the same category went. The officer decides; nothing here moves a case or decides jurisdiction.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import CaseRecord
from app.modules.case import fsm

MODEL = "routing-rules-v1"
W_PRIMARY, W_SUPPORT, W_HOLDER = 3.0, 1.0, 0.5
W_RELATED = 1.5  # × link probability, for a unit holding an open duplicate / parallel / related case
W_SAME_INSTITUTION = 0.5  # a unit holding another open matter on the same institution
W_ACCEPTED, W_RETURNED = 0.25, -0.5  # per past transfer of this category accepted / returned (last 365 days)
TRANSFER_MARGIN = 1.0
ASSIST_THRESHOLD = 1.5


@dataclass(eq=False)
class Candidate:
    unit_id: uuid.UUID
    code: str
    name: str
    unit_type: str
    region_id: int | None
    score: float = 0.0
    mandate: str | None = None
    coordinating: str | None = None
    reasons: list[dict] = field(default_factory=list)

    def add(self, code: str, label: str, weight: float) -> None:
        self.score += weight
        self.reasons.append({"code": code, "label": label, "weight": round(weight, 2)})

    def summary(self) -> dict:
        return {
            "unit": self.code,
            "unit_name": self.name,
            "score": round(self.score, 2),
            "mandate": self.mandate,
            "reasons": self.reasons,
        }


def directory(db: Session) -> list[dict]:
    """Mandates expanded to concrete units (a Regional Office row applies to every Regional Office)."""
    rows = db.execute(
        text(
            "SELECT u.id, u.code, u.name, u.region_id, m.category_code, cat.name AS category, m.role, "
            "m.own_region_only, m.basis, m.approval_status FROM unit_mandate m "
            "JOIN unit u ON u.is_active AND (u.code = m.unit_code OR u.unit_type = m.unit_type) "
            "JOIN category cat ON cat.code = m.category_code ORDER BY m.category_code, m.role, u.code"
        )
    ).all()
    return [dict(r._mapping) for r in rows]


def mandate_of(db: Session, unit_id: uuid.UUID, case: CaseRecord) -> tuple[str | None, str | None]:
    """The strongest mandate a unit holds for this case's category (and region), with its basis."""
    found: tuple[str | None, str | None] = (None, None)
    for m in directory(db):
        if m["id"] != unit_id or m["category_code"] != case.category_code:
            continue
        if m["own_region_only"] and m["region_id"] != case.region_id:
            continue
        if m["role"] == "PRIMARY":
            return "PRIMARY", m["basis"]
        found = ("SUPPORT", m["basis"])
    return found


def jurisdiction(db: Session, unit_id: uuid.UUID, case: CaseRecord) -> dict:
    """Rule-based jurisdiction check for a proposed transfer or request. Advisory: the directory is proposed data."""
    role, basis = mandate_of(db, unit_id, case)
    return {
        "mandate": role or "NONE",
        "basis": basis,
        "warning": None
        if role
        else "The unit directory records no mandate for this category; the receiving unit may return it.",
    }


def recommend(db: Session, case: CaseRecord) -> dict | None:
    if case.status in fsm.TERMINAL or case.status == "TRANSFER_PROPOSED" or case.sensitivity == "SEALED":
        return None
    units = {
        r.id: Candidate(r.id, r.code, r.name, r.unit_type, r.region_id)
        for r in db.execute(text("SELECT id, code, name, unit_type, region_id FROM unit WHERE is_active")).all()
    }
    holder = units.get(case.holding_unit_id)
    if holder is None:
        return None

    for m in directory(db):
        c = units.get(m["id"])
        if c is None or m["category_code"] != case.category_code:
            continue
        if m["own_region_only"] and m["region_id"] != case.region_id:
            continue
        if m["role"] == "PRIMARY":
            c.mandate = "PRIMARY"
            c.add("mandate_primary", f"Mandate: {m['basis']}", W_PRIMARY)
        elif c.mandate is None:
            c.mandate = "SUPPORT"
            c.add("mandate_support", f"Supports: {m['basis']}", W_SUPPORT)

    holder.add("holder", "Already holds the case (a transfer has a cost)", W_HOLDER)

    related = db.execute(
        text(
            """
            SELECT o.holding_unit_id AS unit_id, o.case_no, l.link_type, l.probability, co.code AS coordination,
                   co.status AS co_status, co.decision
            FROM case_link l
            JOIN case_record o ON o.id = CASE WHEN l.left_id = :c THEN l.right_id ELSE l.left_id END
            LEFT JOIN coordination co ON co.link_id = l.id
            WHERE (l.left_id = :c OR l.right_id = :c) AND l.status <> 'REJECTED' AND l.link_type IN ('D', 'P', 'R', 'C')
              AND o.status <> ALL(:terminal) AND o.holding_unit_id <> :holder
            ORDER BY l.probability DESC
            """
        ),
        {"c": case.id, "terminal": list(fsm.TERMINAL), "holder": case.holding_unit_id},
    ).all()
    seen: set[uuid.UUID] = set()
    for r in related:
        c = units.get(r.unit_id)
        if c is None or r.unit_id in seen:
            continue
        seen.add(r.unit_id)
        if r.coordination and r.decision != "NOT_RELATED":
            c.coordinating = r.coordination
        if r.link_type == "C":
            c.add(
                "same_institution", f"Holds another open matter on this institution ({r.case_no})", W_SAME_INSTITUTION
            )
        elif r.link_type == "P":
            # Parallel-action links are rule-triggered and may carry a low text probability; the rule is the signal.
            c.add(
                "parallel_matter",
                f"Is already acting on a parallel matter, {r.case_no}",
                W_RELATED * max(float(r.probability), 0.5),
            )
        else:
            c.add(
                "related_case",
                f"Holds related case {r.case_no} (match {r.probability:.2f})",
                W_RELATED * float(r.probability),
            )

    history = db.execute(
        text(
            "SELECT t.to_unit_id, count(*) FILTER (WHERE t.status = 'ACCEPTED') AS accepted, "
            "count(*) FILTER (WHERE t.status = 'RETURNED') AS returned FROM transfer t "
            "JOIN case_record c ON c.id = t.case_id WHERE c.category_code = :cat "
            "AND t.decided_at >= now() - interval '365 days' GROUP BY t.to_unit_id"
        ),
        {"cat": case.category_code},
    ).all()
    for r in history:
        c = units.get(r.to_unit_id)
        if c is None:
            continue
        if r.accepted:
            c.add("history_accepted", f"Accepted {r.accepted} transfer(s) of this category", W_ACCEPTED * r.accepted)
        if r.returned:
            c.add(
                "history_returned",
                f"Returned {r.returned} transfer(s) of this category",
                max(-1.5, W_RETURNED * r.returned),
            )

    ranked = sorted((c for c in units.values() if c.reasons), key=lambda c: (-c.score, c.code))
    others = [c for c in ranked if c is not holder]
    top_other = others[0] if others else None
    action, target = "KEEP", holder
    if (
        top_other
        and holder.mandate != "PRIMARY"
        and top_other.mandate == "PRIMARY"
        and top_other.score >= holder.score + TRANSFER_MARGIN
    ):
        action, target = "TRANSFER", top_other
    else:
        # Assistance goes to a supporting unit, never to one already coordinating on a linked case (that is the
        # coordination card's job) and never to a unit that would rather hold the case itself.
        helper = next(
            (c for c in others if c.score >= ASSIST_THRESHOLD and c.mandate != "PRIMARY" and not c.coordinating),
            None,
        )
        if helper:
            action, target = "ASSIST", helper

    primaries = [c for c in ranked if c.mandate == "PRIMARY"]
    contenders = {*ranked[:4], target} if ranked else {target}
    # Softmax over the leading candidates: a relative measure ("how clearly this unit stands out"), not a probability
    # that the routing is legally right.
    confidence = math.exp(target.score) / sum(math.exp(c.score) for c in contenders)
    ambiguous = (
        not primaries
        or len(primaries) > 1
        or case.category_code == "OTHER"
        or (len(ranked) > 1 and ranked[0].score - ranked[1].score < 0.5)
    )
    alternatives = [c.summary() for c in ranked if c is not target][:3]
    return {
        "model": MODEL,
        "action": action,
        "unit": target.code,
        "unit_name": target.name,
        "unit_type": target.unit_type,
        "holder": holder.code,
        "confidence": round(confidence, 2),
        "ambiguous": ambiguous,
        "reasons": target.reasons,
        "holder_reasons": holder.reasons if target is not holder else [],
        "alternatives": alternatives,
        "coordinating": [{"unit": c.code, "coordination": c.coordinating} for c in ranked if c.coordinating],
        "note": "A recommendation from the unit directory and case history, not a decision on jurisdiction. "
        "An authorised officer approves any transfer or request.",
    }
