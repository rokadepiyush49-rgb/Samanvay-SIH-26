"""Management Cockpit, Bureau Desk and the SLA what-if simulator (blueprint SOL-08, W6).

Every number is computed from the live ledger and each tile carries the exact /cases query that reproduces it,
so a tile total always equals its drill-down count.
"""

from __future__ import annotations

import datetime as dt
import statistics
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import forbidden
from app.modules.auth.deps import current_user
from app.modules.case import fsm
from app.modules.case.views import list_cases
from app.modules.institution import issues
from app.modules.policy.roles import CASE_VIEW_ROLES, MANAGEMENT_ROLES, CurrentUser, Role
from app.modules.search.query import CaseFilters
from app.modules.sla.calendar import get_calendar, today_ist

router = APIRouter(tags=["dashboard"])

AGEING = [("0–10", 0, 10), ("11–21", 11, 21), ("22–60", 22, 60), (">60", 61, 100000)]


def _scope(db: Session, user: CurrentUser, unit: str | None, region: int | None) -> tuple[str, dict, dict]:
    """Restrict unit heads to their unit and regional officers to their region unless they see all units."""
    where, p, label = ["true"], {}, {"unit": None, "region": None}
    if not user.sees_all_units:
        if user.has(Role.REGIONAL_OFFICER) and user.region_id:
            region = user.region_id
            unit = None
        elif user.has(Role.UNIT_HEAD):
            unit = user.unit_code
        else:
            raise forbidden("The cockpit is for unit heads, regional officers and senior management.")
    if unit:
        where.append("u.code = :scope_unit")
        p["scope_unit"] = unit
        label["unit"] = unit
    if region:
        where.append("c.region_id = :scope_region")
        p["scope_region"] = region
        label["region"] = region
    return " AND ".join(where), p, label


def _qs(label: dict, **extra) -> str:
    parts = []
    if label["unit"]:
        parts.append(f"unit={label['unit']}")
    if label["region"]:
        parts.append(f"region={label['region']}")
    parts += [f"{k}={v}" for k, v in extra.items()]
    return "&".join(parts)


@router.get("/dashboard/summary")
def summary(
    unit: str | None = None,
    region: int | None = None,
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    user.require(MANAGEMENT_ROLES, "open the cockpit")
    where, p, label = _scope(db, user, unit, region)
    today = today_ist()
    p.update(
        {
            "pending": fsm.PS_BUCKETS["pending"],
            "under": fsm.PS_BUCKETS["under_process"],
            "terminal": list(fsm.TERMINAL),
            "today": today,
            "today_ix": today,
        }
    )
    base = f"FROM case_record c JOIN unit u ON u.id = c.holding_unit_id WHERE {where}"
    t = db.execute(
        text(f"""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE c.status = ANY(:pending)) AS pending,
               count(*) FILTER (WHERE c.status = ANY(:under)) AS under_process,
               count(*) FILTER (WHERE c.status = 'DISPOSED') AS disposed,
               count(*) FILTER (WHERE c.status = 'REJECTED_AT_INTAKE') AS rejected,
               count(*) FILTER (WHERE c.status = 'TRANSFER_PROPOSED') AS transferred,
               count(*) FILTER (WHERE c.escalated AND c.status <> ALL(:terminal)) AS escalated,
               count(*) FILTER (WHERE c.status <> ALL(:terminal) AND c.expected_disposal < :today) AS overdue
        {base}"""),
        p,
    ).first()
    tiles = [
        {"key": "total", "label": "Total", "value": t.total, "query": _qs(label)},
        {"key": "pending", "label": "Pending", "value": t.pending, "query": _qs(label, status="pending")},
        {
            "key": "under_process",
            "label": "Under process",
            "value": t.under_process,
            "query": _qs(label, status="under_process"),
        },
        {"key": "disposed", "label": "Disposed", "value": t.disposed, "query": _qs(label, status="disposed")},
        {
            "key": "transferred",
            "label": "Transfer in flight",
            "value": t.transferred,
            "query": _qs(label, status="transferred"),
        },
        {
            "key": "escalated",
            "label": "Escalated",
            "value": t.escalated,
            "query": _qs(label, escalated="true", open_only="true"),
        },
        {"key": "overdue", "label": "Overdue", "value": t.overdue, "query": _qs(label, overdue="true")},
    ]

    ageing_rows = db.execute(
        text(f"""
        SELECT u.code AS unit, (SELECT wd_index FROM calendar_day WHERE day = :today_ix) - cd.wd_index AS age
        FROM case_record c JOIN unit u ON u.id = c.holding_unit_id
        JOIN calendar_day cd ON cd.day = c.received_on
        WHERE {where} AND c.status <> ALL(:terminal)"""),
        p,
    ).all()
    ageing = {name: 0 for name, _, _ in AGEING}
    per_unit: dict[str, dict] = {}
    for r in ageing_rows:
        age = max(0, r.age or 0)
        bucket = next(name for name, lo, hi in AGEING if lo <= age <= hi)
        ageing[bucket] += 1
        u = per_unit.setdefault(r.unit, {"unit": r.unit, "open": 0, **{name: 0 for name, _, _ in AGEING}})
        u["open"] += 1
        u[bucket] += 1
    overdue_by_unit = {
        r.unit: r.n
        for r in db.execute(
            text(
                f"SELECT u.code AS unit, count(*) AS n {base} AND c.status <> ALL(:terminal) "
                "AND c.expected_disposal < :today "
                "GROUP BY u.code"
            ),
            p,
        ).all()
    }
    for code, u in per_unit.items():
        u["overdue"] = overdue_by_unit.get(code, 0)

    window = today - dt.timedelta(days=90)
    timely = db.execute(
        text(f"""
        SELECT count(*) FILTER (WHERE c.disposed_on <= c.expected_disposal) AS on_time, count(*) AS n
        {base} AND c.status = 'DISPOSED' AND c.disposed_on >= :window"""),
        {**p, "window": window},
    ).first()

    # A card counts for the scope when either of its two cases is in scope.
    other_side = where.replace("u.code", "u2.code").replace("c.region_id", "c2.region_id")
    coord = db.execute(
        text(f"""
        SELECT count(*) AS undecided, min(co.created_at) AS oldest
        FROM coordination co JOIN case_link l ON l.id = co.link_id
        JOIN case_record c ON c.id = l.left_id JOIN case_record c2 ON c2.id = l.right_id
        JOIN unit u ON u.id = c.holding_unit_id JOIN unit u2 ON u2.id = c2.holding_unit_id
        WHERE co.status <> 'DECIDED' AND ({where} OR {other_side})
        """),
        p,
    ).first()
    cal = get_calendar(db)
    oldest_wd = cal.working_days_between(coord.oldest.date(), today) if coord.oldest else None

    multi = db.execute(
        text(f"""
        SELECT count(*) FROM (SELECT c.institution_id {base} AND c.status <> ALL(:terminal)
          AND c.institution_id IS NOT NULL GROUP BY c.institution_id HAVING count(DISTINCT c.holding_unit_id) >= 2) x
        """),
        p,
    ).scalar_one()

    guard = db.execute(
        text("""
        SELECT count(*) FILTER (WHERE g.result = 'COORDINATION_SUGGESTED' AND g.choice = 'PROCEED_AND_NOTIFY') AS past,
               count(*) FILTER (WHERE g.consumed_at IS NOT NULL
                                AND g.choice IN ('PROCEED', 'PROCEED_AND_NOTIFY')) AS acted,
               count(*) FILTER (WHERE g.choice = 'OPEN_COORDINATION') AS coordinated_first
        FROM guard_check g WHERE g.at >= :window"""),
        {"window": window},
    ).first()

    decided = (
        db.execute(
            text(
                "SELECT extract(epoch FROM decided_at - created_at) / 3600 AS h FROM coordination "
                "WHERE status = 'DECIDED' AND decided_at >= :w"
            ),
            {"w": window},
        )
        .scalars()
        .all()
    )

    health = db.execute(
        text(f"""
        SELECT u.code AS unit, count(*) AS open,
               count(*) FILTER (WHERE c.resolution_status = 'RESOLVED') AS resolved,
               count(*) FILTER (WHERE c.holding_officer_id IS NOT NULL) AS assigned,
               count(*) FILTER (WHERE coalesce(c.last_action_at, c.created_at) < now() - interval '30 days') AS stale
        {base} AND c.status <> ALL(:terminal) GROUP BY u.code ORDER BY u.code"""),
        p,
    ).all()

    return {
        "scope": label,
        "as_of": dt.datetime.now(dt.UTC).isoformat(),
        "tiles": tiles,
        "rejected_at_intake": t.rejected,
        "ageing": [{"bucket": k, "count": v} for k, v in ageing.items()],
        "workload": sorted(per_unit.values(), key=lambda x: -x["open"]),
        "within_timeline": {
            "on_time": timely.on_time,
            "disposed": timely.n,
            "pct": round(100 * timely.on_time / timely.n, 1) if timely.n else None,
            "window_days": 90,
        },
        "undecided_overlaps": {"count": coord.undecided, "oldest_working_days": oldest_wd},
        "multi_unit_institutions": multi,
        "kpis": {
            "consequential_actions_past_undecided_overlap": guard.past,
            "consequential_actions_total": guard.acted,
            "coordination_opened_from_guard": guard.coordinated_first,
            "median_alert_to_decision_hours": round(statistics.median(decided), 1) if decided else None,
        },
        "register_health": [
            {
                "unit": h.unit,
                "open": h.open,
                "resolved_pct": round(100 * h.resolved / h.open, 1) if h.open else None,
                "assigned_pct": round(100 * h.assigned / h.open, 1) if h.open else None,
                "stale_pct": round(100 * h.stale / h.open, 1) if h.open else None,
                "score": round(100 * (h.resolved + h.assigned + (h.open - h.stale)) / (3 * h.open), 1)
                if h.open
                else None,
            }
            for h in health
        ],
    }


@router.get("/dashboard/analytics")
def analytics(
    unit: str | None = None,
    region: int | None = None,
    months: int = Query(default=12, ge=3, le=24),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Breakdowns behind the cockpit charts: monthly received / disposed, and status by unit, region and category.
    Same scoping as the summary, so every bar can drill down to /cases with the returned filters."""
    user.require(MANAGEMENT_ROLES, "open the cockpit")
    where, p, label = _scope(db, user, unit, region)
    today = today_ist()
    start = (today.replace(day=1) - dt.timedelta(days=31 * (months - 1))).replace(day=1)
    p.update(
        {
            "pending": fsm.PS_BUCKETS["pending"],
            "under": fsm.PS_BUCKETS["under_process"],
            "terminal": list(fsm.TERMINAL),
            "today": today,
            "start": start,
            "window": today - dt.timedelta(days=90),
        }
    )
    base = f"FROM case_record c JOIN unit u ON u.id = c.holding_unit_id WHERE {where}"
    buckets = """
        count(*) AS total,
        count(*) FILTER (WHERE c.status = ANY(:pending)) AS pending,
        count(*) FILTER (WHERE c.status = ANY(:under)) AS under_process,
        count(*) FILTER (WHERE c.status = 'TRANSFER_PROPOSED') AS transferred,
        count(*) FILTER (WHERE c.status = 'DISPOSED') AS disposed,
        count(*) FILTER (WHERE c.status <> ALL(:terminal) AND c.expected_disposal < :today) AS overdue,
        count(*) FILTER (WHERE c.status = 'DISPOSED' AND c.disposed_on >= :window) AS disposed_90,
        count(*) FILTER (WHERE c.status = 'DISPOSED' AND c.disposed_on >= :window
                         AND c.disposed_on <= c.expected_disposal) AS on_time_90"""

    def bucket_row(r) -> dict:
        return {
            "total": r.total,
            "pending": r.pending,
            "under_process": r.under_process,
            "transferred": r.transferred,
            "disposed": r.disposed,
            "overdue": r.overdue,
            "sla_pct": round(100 * r.on_time_90 / r.disposed_90, 1) if r.disposed_90 else None,
            "disposed_90": r.disposed_90,
        }

    received = dict(
        db.execute(
            text(
                f"SELECT date_trunc('month', c.received_on)::date AS m, count(*) {base} "
                "AND c.received_on >= :start GROUP BY 1"
            ),
            p,
        ).all()
    )
    disposed = {
        r.m: (r.n, r.on_time)
        for r in db.execute(
            text(
                f"SELECT date_trunc('month', c.disposed_on)::date AS m, count(*) AS n, "
                f"count(*) FILTER (WHERE c.disposed_on <= c.expected_disposal) AS on_time {base} "
                "AND c.status = 'DISPOSED' AND c.disposed_on >= :start GROUP BY 1"
            ),
            p,
        ).all()
    }
    trend, m = [], start
    while m <= today:
        n, on_time = disposed.get(m, (0, 0))
        trend.append({"month": m.isoformat(), "received": received.get(m, 0), "disposed": n, "on_time": on_time})
        m = dt.date(m.year + (m.month == 12), m.month % 12 + 1, 1)

    by_unit = db.execute(text(f"SELECT u.code AS key, u.name AS name, {buckets} {base} GROUP BY u.code, u.name"), p)
    region_base = base.replace("WHERE", "JOIN region r ON r.id = c.region_id WHERE", 1)
    by_region = db.execute(
        text(f"SELECT r.id AS key, r.name AS name, {buckets} {region_base} GROUP BY r.id, r.name"), p
    )
    by_category = db.execute(
        text(
            f"SELECT cat.code AS key, cat.name AS name, {buckets} "
            f"{base.replace('WHERE', 'JOIN category cat ON cat.code = c.category_code WHERE', 1)} "
            "GROUP BY cat.code, cat.name ORDER BY count(*) FILTER (WHERE c.status <> ALL(:terminal)) DESC LIMIT 12"
        ),
        p,
    )
    return {
        "scope": label,
        "as_of": dt.datetime.now(dt.UTC).isoformat(),
        "trend": trend,
        "by_unit": sorted(
            ({"key": r.key, "name": r.name, **bucket_row(r)} for r in by_unit), key=lambda x: -x["total"]
        ),
        "by_region": sorted(
            ({"key": r.key, "name": r.name, **bucket_row(r)} for r in by_region), key=lambda x: -x["total"]
        ),
        "by_category": [{"key": r.key, "name": r.name, **bucket_row(r)} for r in by_category],
    }


@router.get("/dashboard/desk")
def desk(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require(CASE_VIEW_ROLES, "open the desk")
    head = user.has(Role.UNIT_HEAD)
    worklist = list_cases(
        db, user, CaseFilters(unit=user.unit_code, open_only=True, mine=None if head else True), limit=50, order="due"
    )
    if not head and worklist["total"] == 0 and user.has(Role.INTAKE_OFFICER):
        worklist = list_cases(db, user, CaseFilters(unit=user.unit_code, open_only=True), limit=50, order="due")
    today = today_ist()
    week_end = today + dt.timedelta(days=7)
    items = worklist["items"]
    transfers = db.execute(
        text("""
        SELECT t.id, c.case_no, fu.code AS from_unit, t.proposed_at, cat.name AS category
        FROM transfer t JOIN case_record c ON c.id = t.case_id JOIN unit fu ON fu.id = t.from_unit_id
        JOIN category cat ON cat.code = c.category_code
        WHERE t.to_unit_id = :u AND t.status = 'PROPOSED' ORDER BY t.proposed_at"""),
        {"u": user.unit_id},
    ).all()
    cards = db.execute(
        text("""
        SELECT co.code, co.status, l.link_type, co.decide_by, a.case_no AS a_no, b.case_no AS b_no
        FROM coordination co JOIN case_link l ON l.id = co.link_id
        JOIN case_record a ON a.id = l.left_id JOIN case_record b ON b.id = l.right_id
        WHERE co.status <> 'DECIDED' AND (a.holding_unit_id = :u OR b.holding_unit_id = :u)
        ORDER BY co.decide_by"""),
        {"u": user.unit_id},
    ).all()
    unresolved = db.execute(
        text(
            "SELECT count(*) FROM case_record WHERE holding_unit_id = :u AND "
            "resolution_status <> 'RESOLVED' AND status <> ALL(:t)"
        ),
        {"u": user.unit_id, "t": list(fsm.TERMINAL)},
    ).scalar_one()
    return {
        "as_of": dt.datetime.now(dt.UTC).isoformat(),
        "scope": "unit" if head else "mine",
        "worklist": items,
        "worklist_total": worklist["total"],
        "due_this_week": sum(
            1
            for i in items
            if i["expected_disposal"] and today <= dt.date.fromisoformat(i["expected_disposal"]) <= week_end
        ),
        "overdue": sum(1 for i in items if i["overdue"]),
        "transfers_awaiting": [
            {
                "id": str(t.id),
                "case_no": t.case_no,
                "from_unit": t.from_unit,
                "proposed_at": t.proposed_at.isoformat(),
                "category": t.category,
            }
            for t in transfers
        ],
        "coordination_open": [
            {
                "code": c.code,
                "status": c.status,
                "type": c.link_type,
                "decide_by": c.decide_by.isoformat(),
                "cases": [c.a_no, c.b_no],
            }
            for c in cards
        ],
        "unresolved_institutions": unresolved,
    }


class SimulationIn(BaseModel):
    target_days: int = Field(ge=1, le=365)
    day_basis: Literal["CALENDAR", "WORKING"] = "CALENDAR"
    channel: str | None = None
    category_group: str | None = None
    unit: str | None = None
    period_from: dt.date | None = None
    period_to: dt.date | None = None


@router.get("/dashboard/recurring")
def recurring(
    unit: str | None = None,
    region: int | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Recurring institutional issues (3+ separate incidents in one issue family within 365 days), scoped like the
    cockpit. Incidents are counted across every unit, so a unit head sees patterns its own cases are part of."""
    user.require(MANAGEMENT_ROLES, "view recurring issues")
    where, p, label = _scope(db, user, unit, region)
    since = today_ist() - dt.timedelta(days=issues.WINDOW_DAYS)
    ids = [
        r.institution_id
        for r in db.execute(
            text(
                f"SELECT c.institution_id FROM case_record c JOIN unit u ON u.id = c.holding_unit_id WHERE {where} "
                "AND c.institution_id IS NOT NULL AND c.received_on >= :since AND c.sensitivity <> 'SEALED' "
                "GROUP BY c.institution_id HAVING count(*) >= :n"
            ),
            {**p, "since": since, "n": issues.RECURRING_MIN_INCIDENTS},
        ).all()
    ]
    groups = issues.summarise(db, ids)
    insts = {
        r.id: {"permanent_id": r.permanent_id, "name": r.name, "city": r.city}
        for r in db.execute(
            text("SELECT id, permanent_id, name, city FROM institution WHERE id = ANY(:ids)"), {"ids": ids}
        ).all()
    }
    items = [
        {**{k: v for k, v in g.items() if k != "cases"}, "institution": insts.get(inst_id)}
        for inst_id, gs in groups.items()
        for g in gs
        if g["kind"] == "RECURRING"
    ]
    items.sort(key=lambda g: g["last"], reverse=True)  # most recent first within the same incident count
    items.sort(key=lambda g: -g["incidents"])
    by_family: dict[str, dict] = {}
    for g in items:
        f = by_family.setdefault(g["family"], {"family": g["family"], "label": g["label"], "institutions": 0})
        f["institutions"] += 1
    return {
        "scope": label,
        "window_days": issues.WINDOW_DAYS,
        "min_incidents": issues.RECURRING_MIN_INCIDENTS,
        "total": len(items),
        "by_family": sorted(by_family.values(), key=lambda f: -f["institutions"]),
        "items": items[:limit],
    }


@router.post("/simulations/sla")
def simulate(body: SimulationIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Replay past cases under a proposed timeline. This is a replay of history, not a forecast."""
    user.require(MANAGEMENT_ROLES, "run the SLA simulator")
    today = today_ist()
    start = body.period_from or today - dt.timedelta(days=90)
    end = body.period_to or today
    where = ["c.received_on BETWEEN :s AND :e", "c.status <> 'REJECTED_AT_INTAKE'"]
    p: dict = {"s": start, "e": end}
    if body.channel:
        where.append("c.channel = :ch")
        p["ch"] = body.channel
    if body.category_group:
        where.append("cat.group_code = :g")
        p["g"] = body.category_group
    if body.unit:
        where.append("u.code = :unit")
        p["unit"] = body.unit
    rows = db.execute(
        text(f"""
        SELECT u.code AS unit, c.received_on, c.expected_disposal, c.disposed_on, c.status
        FROM case_record c JOIN unit u ON u.id = c.holding_unit_id JOIN category cat ON cat.code = c.category_code
        WHERE {" AND ".join(where)}"""),
        p,
    ).all()
    cal = get_calendar(db)
    by_unit: dict[str, dict] = {}
    for r in rows:
        done = r.disposed_on or today
        proposed_due = cal.add_days(r.received_on, body.target_days, body.day_basis)
        u = by_unit.setdefault(r.unit, {"unit": r.unit, "cases": 0, "breaches_current": 0, "breaches_proposed": 0})
        u["cases"] += 1
        if r.expected_disposal and done > r.expected_disposal:
            u["breaches_current"] += 1
        if done > proposed_due:
            u["breaches_proposed"] += 1
    units = sorted(by_unit.values(), key=lambda x: -x["cases"])
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "proposal": body.model_dump(mode="json"),
        "units": units,
        "totals": {k: sum(u[k] for u in units) for k in ("cases", "breaches_current", "breaches_proposed")},
        "note": "Replay of past cases under the proposed timeline; open cases are measured to today.",
    }
