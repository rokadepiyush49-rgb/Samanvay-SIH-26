"""Standard reports (blueprint SOL-10, REQ-007/022). Each builder returns a table computed from the live ledger as
the requesting user sees it (RLS excludes sealed categories for users without clearance)."""

from __future__ import annotations

import datetime as dt
import statistics
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.case import fsm


@dataclass
class ReportSpec:
    code: str
    title: str
    description: str
    builder: Callable[[Session, str, dict, dict], dict]
    period: bool = False


def _buckets_sql() -> str:
    return (
        "count(*) AS total, "
        "count(*) FILTER (WHERE c.status = ANY(:pending)) AS pending, "
        "count(*) FILTER (WHERE c.status = ANY(:under)) AS under_process, "
        "count(*) FILTER (WHERE c.status = 'TRANSFER_PROPOSED') AS transferred, "
        "count(*) FILTER (WHERE c.status = 'DISPOSED') AS disposed, "
        "count(*) FILTER (WHERE c.escalated AND c.status <> ALL(:terminal)) AS escalated, "
        "count(*) FILTER (WHERE c.status <> ALL(:terminal) AND c.expected_disposal < :today) AS overdue"
    )


def _p(params: dict, today: dt.date) -> dict:
    return {
        **params,
        "pending": fsm.PS_BUCKETS["pending"],
        "under": fsm.PS_BUCKETS["under_process"],
        "terminal": list(fsm.TERMINAL),
        "today": today,
    }


STATUS_COLS = ["Total", "Pending", "Under process", "Transfer in flight", "Disposed", "Escalated", "Overdue"]


def _status_rows(rows, key: str) -> list[list[Any]]:
    return [
        [getattr(r, key), r.total, r.pending, r.under_process, r.transferred, r.disposed, r.escalated, r.overdue]
        for r in rows
    ]


def _totals(rows: list[list[Any]], start: int = 1) -> list[Any]:
    if not rows:
        return []
    return ["Total", *[sum(r[i] or 0 for r in rows) for i in range(start, len(rows[0]))]]


def unit_status(db: Session, where: str, p: dict, opts: dict) -> dict:
    rows = db.execute(
        text(
            f"SELECT u.code AS unit, {_buckets_sql()} FROM case_record c JOIN unit u ON "
            f"u.id = c.holding_unit_id WHERE {where} GROUP BY u.code ORDER BY u.code"
        ),
        _p(p, opts["today"]),
    ).all()
    body = _status_rows(rows, "unit")
    return {"columns": ["Bureau / Cell", *STATUS_COLS], "rows": body, "totals": _totals(body)}


def region_status(db: Session, where: str, p: dict, opts: dict) -> dict:
    rows = db.execute(
        text(
            f"SELECT coalesce(r.name, 'Unassigned') AS region, {_buckets_sql()} FROM case_record c "
            f"JOIN unit u ON u.id = c.holding_unit_id LEFT JOIN region r ON r.id = c.region_id "
            f"WHERE {where} GROUP BY r.name ORDER BY r.name"
        ),
        _p(p, opts["today"]),
    ).all()
    body = _status_rows(rows, "region")
    return {"columns": ["Region", *STATUS_COLS], "rows": body, "totals": _totals(body)}


def institution_status(db: Session, where: str, p: dict, opts: dict) -> dict:
    rows = db.execute(
        text(f"""
        SELECT i.permanent_id, i.name, count(*) FILTER (WHERE c.status <> ALL(:terminal)) AS open,
               count(*) AS total, count(DISTINCT c.holding_unit_id) FILTER (WHERE c.status <> ALL(:terminal)) AS units,
               string_agg(DISTINCT u.code, ', ') FILTER (WHERE c.status <> ALL(:terminal)) AS unit_codes,
               count(*) FILTER (WHERE c.status <> ALL(:terminal) AND c.expected_disposal < :today) AS overdue
        FROM case_record c JOIN unit u ON u.id = c.holding_unit_id JOIN institution i ON i.id = c.institution_id
        WHERE {where} GROUP BY i.id ORDER BY open DESC, units DESC, i.name LIMIT 200"""),
        _p(p, opts["today"]),
    ).all()
    body = [[r.permanent_id, r.name, r.total, r.open, r.overdue, r.units, r.unit_codes or ""] for r in rows]
    return {
        "columns": ["Permanent ID", "Institution", "Total", "Open", "Overdue", "Units involved", "Units"],
        "rows": body,
        "totals": [],
        "notes": ["Top 200 institutions by open cases."],
    }


def status_summary(db: Session, where: str, p: dict, opts: dict) -> dict:
    rows = db.execute(
        text(
            f"SELECT c.status, count(*) AS n FROM case_record c JOIN unit u ON u.id = c.holding_unit_id "
            f"WHERE {where} GROUP BY c.status"
        ),
        _p(p, opts["today"]),
    ).all()
    counts = {r.status: r.n for r in rows}
    body = [[fsm.STATUS_LABELS[s], fsm.ps_bucket(s).replace("_", " ").title(), counts.get(s, 0)] for s in fsm.STATUSES]
    return {
        "columns": ["Status", "PS reporting category", "Cases"],
        "rows": body,
        "totals": ["Total", "", sum(counts.values())],
    }


def ageing(db: Session, where: str, p: dict, opts: dict) -> dict:
    rows = db.execute(
        text(f"""
        SELECT u.code AS unit,
               count(*) FILTER (WHERE age <= 10) AS a, count(*) FILTER (WHERE age BETWEEN 11 AND 21) AS b,
               count(*) FILTER (WHERE age BETWEEN 22 AND 60) AS c2, count(*) FILTER (WHERE age > 60) AS d, count(*) AS n
        FROM (SELECT c.holding_unit_id, (SELECT wd_index FROM calendar_day WHERE day = :today) - cd.wd_index AS age
              FROM case_record c JOIN unit u ON u.id = c.holding_unit_id JOIN calendar_day cd ON cd.day = c.received_on
              WHERE {where} AND c.status <> ALL(:terminal)) x
        JOIN unit u ON u.id = x.holding_unit_id GROUP BY u.code ORDER BY u.code"""),
        _p(p, opts["today"]),
    ).all()
    body = [[r.unit, r.a, r.b, r.c2, r.d, r.n] for r in rows]
    return {
        "columns": ["Bureau / Cell", "0–10 wd", "11–21 wd", "22–60 wd", ">60 wd", "Open"],
        "rows": body,
        "totals": _totals(body),
        "notes": ["Age in working days since receipt (national calendar)."],
    }


def disposal_rate(db: Session, where: str, p: dict, opts: dict) -> dict:
    q = _p({**p, "s": opts["start"], "e": opts["end"]}, opts["today"])
    rows = db.execute(
        text(f"""
        SELECT u.code AS unit,
               count(*) FILTER (WHERE c.received_on BETWEEN :s AND :e) AS received,
               count(*) FILTER (WHERE c.disposed_on BETWEEN :s AND :e) AS disposed,
               count(*) FILTER (WHERE c.disposed_on BETWEEN :s AND :e
                                AND c.disposed_on <= c.expected_disposal) AS on_time,
               count(*) FILTER (WHERE c.received_on < :s AND (c.disposed_on IS NULL OR c.disposed_on >= :s)
                                AND c.status <> 'REJECTED_AT_INTAKE') AS opening
        FROM case_record c JOIN unit u ON u.id = c.holding_unit_id WHERE {where} GROUP BY u.code ORDER BY u.code"""),
        q,
    ).all()
    body = []
    for r in rows:
        base = r.opening + r.received
        body.append(
            [
                r.unit,
                r.opening,
                r.received,
                r.disposed,
                round(100 * r.disposed / base, 1) if base else None,
                round(100 * r.on_time / r.disposed, 1) if r.disposed else None,
            ]
        )
    return {
        "columns": ["Bureau / Cell", "Open at start", "Received", "Disposed", "Disposal rate %", "Within timeline %"],
        "rows": body,
        "totals": [],
        "notes": ["Disposal rate = disposed in period ÷ (open at start + received in period)."],
    }


def overlaps(db: Session, where: str, p: dict, opts: dict) -> dict:
    rows = db.execute(
        text(f"""
        SELECT l.link_type, l.status, count(*) AS n
        FROM case_link l JOIN case_record c ON c.id = l.left_id JOIN unit u ON u.id = c.holding_unit_id
        WHERE {where} AND l.link_type <> 'L' GROUP BY l.link_type, l.status"""),
        _p(p, opts["today"]),
    ).all()
    types = {"D": "Duplicate", "P": "Parallel action", "R": "Related", "C": "Co-occurrence"}
    grid: dict[str, dict[str, int]] = {t: {"PROPOSED": 0, "CONFIRMED": 0, "REJECTED": 0} for t in types}
    for r in rows:
        if r.link_type in grid:
            grid[r.link_type][r.status] = r.n
    body = [[types[t], v["PROPOSED"], v["CONFIRMED"], v["REJECTED"], sum(v.values())] for t, v in grid.items()]
    new_cases = db.execute(
        text(f"SELECT count(*) FROM case_record c JOIN unit u ON u.id = c.holding_unit_id WHERE {where}"),
        _p(p, opts["today"]),
    ).scalar_one()
    confirmed_d = grid["D"]["CONFIRMED"]
    return {
        "columns": ["Overlap type", "Undecided", "Confirmed", "Rejected", "Total"],
        "rows": body,
        "totals": _totals(body),
        "notes": [f"Confirmed duplicates per 100 cases: {round(100 * confirmed_d / new_cases, 2) if new_cases else 0}"],
    }


def performance(db: Session, where: str, p: dict, opts: dict) -> dict:
    q = _p({**p, "s": opts["start"], "e": opts["end"]}, opts["today"])
    rows = db.execute(
        text(f"""
        SELECT u.code AS unit, c.received_on, c.disposed_on, c.expected_disposal, c.escalated, c.status
        FROM case_record c JOIN unit u ON u.id = c.holding_unit_id
        WHERE {where} AND (c.received_on BETWEEN :s AND :e OR c.disposed_on BETWEEN :s AND :e)"""),
        q,
    ).all()
    transfers = {
        r.unit: r.n
        for r in db.execute(
            text(f"""
        SELECT u.code AS unit, count(*) AS n FROM case_event e JOIN case_record c ON c.id = e.case_id
        JOIN unit u ON u.id = e.to_unit_id WHERE e.event_type = 'TRANSFER_ACCEPTED' AND e.at::date BETWEEN :s AND :e
        AND {where} GROUP BY u.code"""),
            q,
        ).all()
    }
    per: dict[str, dict] = {}
    for r in rows:
        x = per.setdefault(r.unit, {"received": 0, "disposed": 0, "on_time": 0, "days": [], "escalated": 0})
        if opts["start"] <= r.received_on <= opts["end"]:
            x["received"] += 1
        if r.disposed_on and opts["start"] <= r.disposed_on <= opts["end"]:
            x["disposed"] += 1
            x["days"].append((r.disposed_on - r.received_on).days)
            if r.expected_disposal and r.disposed_on <= r.expected_disposal:
                x["on_time"] += 1
        if r.escalated:
            x["escalated"] += 1
    body = [
        [
            u,
            x["received"],
            x["disposed"],
            round(100 * x["on_time"] / x["disposed"], 1) if x["disposed"] else None,
            statistics.median(x["days"]) if x["days"] else None,
            transfers.get(u, 0),
            x["escalated"],
        ]
        for u, x in sorted(per.items())
    ]
    return {
        "columns": [
            "Bureau / Cell",
            "Received",
            "Disposed",
            "Within timeline %",
            "Median days to dispose",
            "Transfers accepted",
            "Escalated",
        ],
        "rows": body,
        "totals": [],
    }


CATALOGUE: dict[str, ReportSpec] = {
    s.code: s
    for s in [
        ReportSpec(
            "UNIT_STATUS", "Bureau / Cell-wise status", "Cases by holding unit and PS reporting category.", unit_status
        ),
        ReportSpec("REGION_STATUS", "Region-wise status", "Cases by region and PS reporting category.", region_status),
        ReportSpec(
            "INSTITUTION_STATUS",
            "Institution-wise status",
            "Institutions by open cases and units involved.",
            institution_status,
        ),
        ReportSpec(
            "STATUS_SUMMARY",
            "Status-wise summary",
            "Every canonical status with its PS reporting category.",
            status_summary,
        ),
        ReportSpec("AGEING", "Pending-case ageing", "Open cases by working days since receipt.", ageing),
        ReportSpec(
            "DISPOSAL_RATE",
            "Disposal rate",
            "Disposal and within-timeline rates for a period.",
            disposal_rate,
            period=True,
        ),
        ReportSpec("OVERLAPS", "Duplicate and overlapping cases", "Overlap proposals and decisions by type.", overlaps),
        ReportSpec(
            "PERFORMANCE",
            "Monthly / quarterly performance",
            "Received, disposed, timeliness, transfers and escalations per unit for a month or quarter.",
            performance,
            period=True,
        ),
    ]
}


def period_bounds(kind: str | None, anchor: dt.date | None, today: dt.date) -> tuple[dt.date, dt.date, str]:
    anchor = anchor or today
    if kind == "quarter":
        q0 = (anchor.month - 1) // 3 * 3 + 1
        start = dt.date(anchor.year, q0, 1)
        end = dt.date(anchor.year + (q0 + 3 > 12), (q0 + 3 - 1) % 12 + 1, 1) - dt.timedelta(days=1)
        return start, end, f"Q{(q0 - 1) // 3 + 1} {anchor.year}"
    start = anchor.replace(day=1)
    nxt = dt.date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    return start, nxt - dt.timedelta(days=1), start.strftime("%B %Y")
