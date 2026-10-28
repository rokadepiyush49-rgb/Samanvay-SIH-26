"""Recurring institutional issues (ministry note p. 5, feature 4; orchestrator trigger "a new complaint resembles an
existing cluster", p. 11).

An institution's complaints of the last 365 days are grouped by issue family (reference_data.ISSUE_FAMILIES), across
every unit. Inside a family, complaints that are the same incident — linked as duplicates, decided as duplicates in
coordination, or from the same complainant or CPGRAMS number — count once. Three or more separate incidents make a
recurring pattern; several submissions of one incident do not. Rules only, every count explained.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.case import fsm
from app.modules.matching.union_find import UnionFind
from app.modules.sla.calendar import today_ist
from app.reference_data import ISSUE_FAMILIES

WINDOW_DAYS = 365
RECURRING_MIN_INCIDENTS = 3
FAMILY_OF = {code: family for family, (_, codes) in ISSUE_FAMILIES.items() for code in codes}
KIND_LABEL = {
    "RECURRING": "Recurring pattern",
    "SEPARATE": "Separate incidents",
    "REPEATED": "Repeated submissions of one incident",
}

_CASES = """
SELECT c.id, c.case_no, c.institution_id, c.category_code, cat.name AS category, u.code AS unit, c.status,
       c.received_on, c.complainant_hmac, c.cpgrams_no
FROM case_record c JOIN unit u ON u.id = c.holding_unit_id JOIN category cat ON cat.code = c.category_code
WHERE c.institution_id = ANY(:ids) AND c.received_on >= :since AND c.sensitivity <> 'SEALED'
  AND c.status <> 'REJECTED_AT_INTAKE'
ORDER BY c.received_on
"""

_SAME_INCIDENT = """
SELECT l.left_id, l.right_id FROM case_link l LEFT JOIN coordination co ON co.link_id = l.id
WHERE l.left_id = ANY(:cids) AND l.right_id = ANY(:cids) AND l.status <> 'REJECTED'
  AND (l.link_type = 'D' OR co.decision = 'DUPLICATE')
"""


def _months(a: dt.date, b: dt.date) -> int:
    return max(1, (b.year - a.year) * 12 + b.month - a.month + 1)


def summarise(db: Session, institution_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    """Issue groups (two or more complaints in one family) per institution, most significant first."""
    if not institution_ids:
        return {}
    since = today_ist() - dt.timedelta(days=WINDOW_DAYS)
    rows = db.execute(text(_CASES), {"ids": institution_ids, "since": since}).all()
    cids = [r.id for r in rows]
    uf = UnionFind()
    for left, right in db.execute(text(_SAME_INCIDENT), {"cids": cids}).all() if cids else []:
        uf.union(str(left), str(right))
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        family = FAMILY_OF.get(r.category_code)
        if family:
            groups[(r.institution_id, family)].append(r)
    out: dict[uuid.UUID, list[dict]] = defaultdict(list)
    for (inst_id, family), members in groups.items():
        if len(members) < 2:
            continue
        # Same complainant (hashed contact) or the same CPGRAMS number is the same incident too.
        first_by_key: dict[str, str] = {}
        for r in members:
            for key in (
                f"h:{r.complainant_hmac}" if r.complainant_hmac else None,
                f"g:{r.cpgrams_no}" if r.cpgrams_no else None,
            ):
                if key:
                    if key in first_by_key:
                        uf.union(first_by_key[key], str(r.id))
                    else:
                        first_by_key[key] = str(r.id)
        incident_of: dict[str, int] = {}
        cases = []
        for r in members:
            root = uf.find(str(r.id))
            incident_of.setdefault(root, len(incident_of) + 1)
            cases.append(
                {
                    "case_no": r.case_no,
                    "unit": r.unit,
                    "category": r.category,
                    "status": r.status,
                    "status_label": fsm.STATUS_LABELS.get(r.status, r.status),
                    "open": r.status not in fsm.TERMINAL,
                    "received_on": r.received_on.isoformat(),
                    "incident": incident_of[root],
                }
            )
        incidents = len(incident_of)
        kind = "RECURRING" if incidents >= RECURRING_MIN_INCIDENTS else "SEPARATE" if incidents > 1 else "REPEATED"
        first, last = members[0].received_on, members[-1].received_on
        units = sorted({r.unit for r in members})
        repeats = len(members) - incidents
        reasons = [f"{incidents} separate incident{'s' if incidents != 1 else ''} over {_months(first, last)} month(s)"]
        if repeats:
            reasons.append(
                f"{repeats} further submission{'s' if repeats != 1 else ''} repeated an incident already on file "
                "(same complainant, CPGRAMS number or confirmed duplicate) and count once"
            )
        if len(units) > 1:
            reasons.append(f"Received by {', '.join(units)}")
        out[inst_id].append(
            {
                "family": family,
                "label": ISSUE_FAMILIES[family][0],
                "kind": kind,
                "kind_label": KIND_LABEL[kind],
                "incidents": incidents,
                "complaints": len(members),
                "open": sum(1 for c in cases if c["open"]),
                "units": units,
                "first": first.isoformat(),
                "last": last.isoformat(),
                "reasons": reasons,
                "cases": cases,
            }
        )
    rank = {"RECURRING": 0, "SEPARATE": 1, "REPEATED": 2}
    for items in out.values():
        items.sort(key=lambda g: (rank[g["kind"]], -g["incidents"], g["family"]))
    return out


def for_institution(db: Session, institution_id: uuid.UUID) -> list[dict]:
    return summarise(db, [institution_id]).get(institution_id, [])


def for_case(db: Session, institution_id: uuid.UUID | None, case_no: str) -> dict | None:
    """The recurring pattern this case belongs to, if any (shown as a banner on the case)."""
    if institution_id is None:
        return None
    for g in for_institution(db, institution_id):
        if g["kind"] == "RECURRING" and any(c["case_no"] == case_no for c in g["cases"]):
            return {k: v for k, v in g.items() if k != "cases"} | {"case_nos": [c["case_no"] for c in g["cases"]]}
    return None
