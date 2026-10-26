"""Case search: typed tokens + structured filters + fuzzy institution names + full-text (blueprint SOL-09).

Bodies are searched only where the caller has full access (RLS on case_content does this); metadata search works
across units. Every value is a bound parameter; only whitelisted SQL fragments are concatenated.
"""

from __future__ import annotations

import base64
import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any

from app.modules.case import fsm
from app.modules.matching.normalize import normalize_name

TOKEN = re.compile(r"\b(id|pid|unit|status|cat|region|cpgrams|channel):(\S+)", re.IGNORECASE)


@dataclass
class CaseFilters:
    q: str | None = None
    institution: str | None = None
    institution_id: str | None = None
    permanent_id: str | None = None
    case_no: str | None = None
    unit: str | None = None
    region: int | None = None
    category: str | None = None
    status: str | None = None
    channel: str | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    overdue: bool | None = None
    escalated: bool | None = None
    overlap: bool | None = None
    mine: bool | None = None
    open_only: bool | None = None
    resolution: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def parse_tokens(f: CaseFilters) -> CaseFilters:
    if not f.q:
        return f
    rest = f.q
    for key, value in TOKEN.findall(f.q):
        key = key.lower()
        if key == "id":
            f.case_no = value.upper()
        elif key == "pid":
            f.permanent_id = value
        elif key == "unit":
            f.unit = value.upper()
        elif key == "status":
            f.status = value
        elif key == "cat":
            f.category = value.upper()
        elif key == "channel":
            f.channel = value.upper()
        elif key == "region":
            f.extra["region_code"] = value.upper()
        elif key == "cpgrams":
            f.extra["cpgrams"] = value.upper()
    rest = TOKEN.sub(" ", rest).strip()
    if re.fullmatch(r"SMV-\d{4}-\d{6}", rest.upper()):
        f.case_no, rest = rest.upper(), ""
    elif re.fullmatch(r"1-\d{7,10}", rest):
        f.permanent_id, rest = rest, ""
    f.q = rest or None
    return f


def build_where(f: CaseFilters, user_id: str, today: dt.date) -> tuple[list[str], dict[str, Any]]:
    where: list[str] = []
    p: dict[str, Any] = {}
    if f.case_no:
        where.append("c.case_no = :case_no")
        p["case_no"] = f.case_no
    if f.permanent_id:
        where.append("i.permanent_id = :pid")
        p["pid"] = f.permanent_id
    if f.institution_id:
        where.append("c.institution_id = CAST(:inst_id AS uuid)")
        p["inst_id"] = f.institution_id
    if f.institution:
        where.append(
            "(i.name_norm % :inst OR :inst <% i.name_norm OR EXISTS (SELECT 1 FROM institution_alias a "
            "WHERE a.institution_id = i.id AND (a.alias_norm % :inst OR :inst <% a.alias_norm)) "
            "OR c.institution_raw ILIKE :inst_like)"
        )
        p["inst"] = normalize_name(f.institution)
        p["inst_like"] = f"%{f.institution}%"
    if f.unit:
        where.append("u.code = :unit")
        p["unit"] = f.unit
    if f.region is not None:
        where.append("c.region_id = :region")
        p["region"] = f.region
    if f.extra.get("region_code"):
        where.append("c.region_id = (SELECT id FROM region WHERE code = :region_code)")
        p["region_code"] = f.extra["region_code"]
    if f.category:
        where.append("c.category_code = :cat")
        p["cat"] = f.category
    if f.channel:
        where.append("c.channel = :channel")
        p["channel"] = f.channel
    if f.extra.get("cpgrams"):
        where.append("c.cpgrams_no = :cpgrams")
        p["cpgrams"] = f.extra["cpgrams"]
    if f.status:
        key = f.status.lower()
        if key in fsm.PS_BUCKETS:
            where.append("c.status = ANY(:statuses)")
            p["statuses"] = fsm.PS_BUCKETS[key]
        elif key == "open":
            where.append("c.status <> ALL(:terminal)")
            p["terminal"] = list(fsm.TERMINAL)
        elif key == "escalated":
            where.append("c.escalated")
        elif key == "overdue":
            f.overdue = True
        else:
            where.append("c.status = :status")
            p["status"] = f.status.upper()
    if f.open_only:
        where.append("c.status <> ALL(:terminal)")
        p["terminal"] = list(fsm.TERMINAL)
    if f.date_from:
        where.append("c.received_on >= :dfrom")
        p["dfrom"] = f.date_from
    if f.date_to:
        where.append("c.received_on <= :dto")
        p["dto"] = f.date_to
    if f.overdue:
        where.append("c.status <> ALL(:terminal) AND c.expected_disposal < :today")
        p["terminal"], p["today"] = list(fsm.TERMINAL), today
    if f.escalated:
        where.append("c.escalated")
    if f.overlap:
        where.append(
            "EXISTS (SELECT 1 FROM case_link l WHERE (l.left_id = c.id OR l.right_id = c.id) "
            "AND l.status = 'PROPOSED' AND l.link_type IN ('D', 'P', 'R'))"
        )
    if f.mine:
        where.append("c.holding_officer_id = CAST(:me AS uuid)")
        p["me"] = user_id
    if f.resolution:
        where.append("c.resolution_status = :resolution")
        p["resolution"] = f.resolution.upper()
    if f.q:
        where.append(
            "(cc.search_vector @@ plainto_tsquery('simple', :q) OR c.case_no ILIKE :q_like "
            "OR c.source_ref ILIKE :q_like OR i.name_norm % :q_norm OR :q_norm <% i.name_norm "
            "OR c.institution_raw ILIKE :q_like)"
        )
        p["q"], p["q_like"], p["q_norm"] = f.q, f"%{f.q}%", normalize_name(f.q)
    return where, p


def encode_cursor(received_on: dt.date, case_id: str) -> str:
    return base64.urlsafe_b64encode(f"{received_on.isoformat()}|{case_id}".encode()).decode()


def decode_cursor(cursor: str | None) -> tuple[dt.date, str] | None:
    if not cursor:
        return None
    try:
        day, cid = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return dt.date.fromisoformat(day), cid
    except (ValueError, UnicodeDecodeError):
        return None
