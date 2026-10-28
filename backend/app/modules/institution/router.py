"""Institution master, live resolver for intake, aliases, and Institution 360 (blueprint SOL-02, W5)."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import not_found
from app.models import Institution, InstitutionAlias
from app.modules.audit import chain
from app.modules.auth.deps import current_user
from app.modules.case import fsm
from app.modules.case.views import list_cases
from app.modules.institution import issues
from app.modules.institution.resolver import InstQuery, resolve
from app.modules.matching.normalize import normalize_name
from app.modules.matching.union_find import UnionFind
from app.modules.policy.roles import CASE_VIEW_ROLES, CurrentUser, Role
from app.modules.search.query import CaseFilters

router = APIRouter(prefix="/institutions", tags=["institutions"])


@router.get("")
def search(
    q: str | None = None,
    region: int | None = None,
    sort: Literal["open", "units", "oldest", "name"] = "open",
    multi_unit: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    where, p = [], {"n": limit, "terminal": list(fsm.TERMINAL)}
    if q:
        qn = normalize_name(q)
        if q.strip().startswith("1-"):
            where.append("i.permanent_id = :pid")
            p["pid"] = q.strip()
        else:
            where.append(
                "(i.name_norm % :q OR :q <% i.name_norm OR EXISTS (SELECT 1 FROM institution_alias a "
                "WHERE a.institution_id = i.id AND (a.alias_norm % :q OR :q <% a.alias_norm)))"
            )
            p["q"] = qn
    if region:
        where.append("i.region_id = :region")
        p["region"] = region
    having = (
        " HAVING count(DISTINCT c.holding_unit_id) FILTER (WHERE c.status <> ALL(:terminal)) >= 2" if multi_unit else ""
    )
    order = {
        "open": "open_cases DESC, i.name",
        "units": "units_involved DESC, open_cases DESC",
        "oldest": "oldest_open ASC NULLS LAST",
        "name": "i.name",
    }[sort]
    if q and not q.strip().startswith("1-"):
        order = "similarity(i.name_norm, :q) DESC, " + order
    sql = f"""
        SELECT i.id, i.permanent_id, i.name, i.city, i.state, i.region_id, r.code AS region_code, i.approval_status,
               count(c.id) FILTER (WHERE c.status <> ALL(:terminal)) AS open_cases,
               count(c.id) AS total_cases,
               count(DISTINCT c.holding_unit_id) FILTER (WHERE c.status <> ALL(:terminal)) AS units_involved,
               min(c.received_on) FILTER (WHERE c.status <> ALL(:terminal)) AS oldest_open,
               array_remove(array_agg(DISTINCT u.code) FILTER (WHERE c.status <> ALL(:terminal)), NULL) AS units
        FROM institution i
        LEFT JOIN region r ON r.id = i.region_id
        LEFT JOIN case_record c ON c.institution_id = i.id
        LEFT JOIN unit u ON u.id = c.holding_unit_id
        {"WHERE " + " AND ".join(where) if where else ""}
        GROUP BY i.id, r.code {having}
        ORDER BY {order} LIMIT :n
    """
    rows = db.execute(text(sql), p).all()
    return {
        "items": [
            {
                "id": str(r.id),
                "permanent_id": r.permanent_id,
                "name": r.name,
                "city": r.city,
                "state": r.state,
                "region_id": r.region_id,
                "region_code": r.region_code,
                "approval_status": r.approval_status,
                "open_cases": r.open_cases,
                "total_cases": r.total_cases,
                "units_involved": r.units_involved,
                "units": r.units or [],
                "oldest_open": r.oldest_open.isoformat() if r.oldest_open else None,
            }
            for r in rows
        ]
    }


class ResolveIn(BaseModel):
    name: str = Field(default="", max_length=300)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    pin: str | None = Field(default=None, max_length=10)
    permanent_id: str | None = Field(default=None, max_length=20)


@router.post("/resolve")
def resolve_institution(
    body: ResolveIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    res = resolve(
        db, InstQuery(name=body.name, city=body.city, state=body.state, pin=body.pin, permanent_id=body.permanent_id)
    )
    return {
        "status": res.status,
        "method": res.method,
        "probability": round(res.probability, 3),
        "institution_id": str(res.institution.id) if res.institution else None,
        "candidates": res.candidates_payload(),
        "note": {
            "RESOLVED": "Resolved automatically.",
            "PENDING": "Please confirm the institution.",
            "UNRESOLVED": "No confident match. Pick a candidate or ask the data steward to add it.",
        }[res.status],
    }


@router.get("/{pid}")
def institution_360(pid: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require(CASE_VIEW_ROLES | {Role.DATA_STEWARD}, "view institutions")
    inst = db.query(Institution).filter(Institution.permanent_id == pid).first()
    if inst is None:
        raise not_found("Institution")
    aliases = db.execute(
        text("SELECT alias, source, created_at FROM institution_alias WHERE institution_id = :i ORDER BY created_at"),
        {"i": inst.id},
    ).all()
    siblings = (
        db.execute(
            text("SELECT permanent_id, name, city FROM institution WHERE trust_name = :t AND id <> :i ORDER BY name"),
            {"t": inst.trust_name, "i": inst.id},
        ).all()
        if inst.trust_name
        else []
    )
    region = db.execute(text("SELECT code, name FROM region WHERE id = :r"), {"r": inst.region_id}).first()
    out = {
        "institution": {
            "id": str(inst.id),
            "permanent_id": inst.permanent_id,
            "name": inst.name,
            "address": inst.address,
            "city": inst.city,
            "district": inst.district,
            "state": inst.state,
            "pin": inst.pin,
            "region": dict(region._mapping) if region else None,
            "inst_type": inst.inst_type,
            "approval_status": inst.approval_status,
            "trust_name": inst.trust_name,
        },
        "aliases": [{"alias": a.alias, "source": a.source} for a in aliases],
        "siblings": [dict(s._mapping) for s in siblings],
    }
    if not user.has(*CASE_VIEW_ROLES):
        return {
            **out,
            "cases": [],
            "by_unit": [],
            "clusters": [],
            "issues": [],
            "timeline": [],
            "restricted_matter_exists": False,
        }

    cases = list_cases(db, user, CaseFilters(institution_id=str(inst.id)), limit=100)["items"]
    by_unit: dict[str, dict] = {}
    for c in cases:
        u = by_unit.setdefault(
            c["holding_unit"]["code"],
            {
                "unit": c["holding_unit"]["code"],
                "unit_name": c["holding_unit"]["name"],
                "open": 0,
                "total": 0,
                "custodians": set(),
            },
        )
        u["total"] += 1
        if c["status"] not in fsm.TERMINAL:
            u["open"] += 1
            if c["holding_officer"]:
                u["custodians"].add(c["holding_officer"]["name"])
    ids = [c["id"] for c in cases]
    links = (
        db.execute(
            text(
                "SELECT l.left_id, l.right_id, l.link_type, l.status, l.probability, co.code AS coordination, "
                "co.status AS coordination_status FROM case_link l LEFT JOIN coordination co ON co.link_id = l.id "
                "WHERE l.left_id = ANY(CAST(:ids AS uuid[])) AND l.right_id = ANY(CAST(:ids AS uuid[])) "
                "AND l.status <> 'REJECTED' AND l.link_type <> 'L'"
            ),
            {"ids": ids},
        ).all()
        if ids
        else []
    )
    uf = UnionFind()
    for lk in links:
        if lk.status == "CONFIRMED":
            uf.union(str(lk.left_id), str(lk.right_id))
    groups: dict[str, list[str]] = {}
    no_by_id = {c["id"]: c["case_no"] for c in cases}
    for cid in ids:
        groups.setdefault(uf.find(cid), []).append(no_by_id[cid])
    clusters = [sorted(v) for v in groups.values() if len(v) > 1]
    events = db.execute(
        text(
            "SELECT e.at, e.event_type, e.action, e.to_status, c.case_no, u.code AS unit FROM case_event e "
            "JOIN case_record c ON c.id = e.case_id JOIN unit u ON u.id = c.holding_unit_id "
            "WHERE c.institution_id = :i AND e.event_type IN ('RECEIVED', 'ACTION', 'TRANSFER_ACCEPTED', "
            "'COORDINATION_OPENED', 'COORDINATION_DECIDED', 'ESCALATED') ORDER BY e.at DESC LIMIT 200"
        ),
        {"i": inst.id},
    ).all()
    labels = fsm.action_labels(db)
    restricted = bool(
        db.execute(
            text("SELECT smv_restricted_matter_exists(:i, '00000000-0000-0000-0000-000000000000')"), {"i": inst.id}
        ).scalar()
    )
    return {
        **out,
        "cases": cases,
        "by_unit": [
            {**v, "custodians": sorted(v["custodians"])} for v in sorted(by_unit.values(), key=lambda x: -x["open"])
        ],
        "links": [
            {
                "a": no_by_id.get(str(lk.left_id)),
                "b": no_by_id.get(str(lk.right_id)),
                "type": lk.link_type,
                "status": lk.status,
                "probability": round(lk.probability, 3),
                "coordination": lk.coordination,
                "coordination_status": lk.coordination_status,
            }
            for lk in links
        ],
        "clusters": clusters,
        "issues": issues.for_institution(db, inst.id),
        "timeline": [
            {
                "at": e.at.isoformat(),
                "type": e.event_type,
                "action": labels.get(e.action or "", e.action),
                "to_status": e.to_status,
                "case_no": e.case_no,
                "unit": e.unit,
            }
            for e in events
        ],
        "restricted_matter_exists": restricted,
        "multi_unit": sum(1 for v in by_unit.values() if v["open"]) >= 2,
        "as_of": dt.datetime.now(dt.UTC).isoformat(),
    }


class AliasIn(BaseModel):
    alias: str = Field(min_length=3, max_length=300)


@router.post("/{pid}/aliases", status_code=201)
def add_alias(
    pid: str, body: AliasIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    user.require({Role.DATA_STEWARD}, "edit the institution master")
    inst = db.query(Institution).filter(Institution.permanent_id == pid).first()
    if inst is None:
        raise not_found("Institution")
    norm = normalize_name(body.alias)
    exists = (
        db.query(InstitutionAlias)
        .filter(InstitutionAlias.institution_id == inst.id, InstitutionAlias.alias_norm == norm)
        .first()
    )
    if not exists:
        db.add(
            InstitutionAlias(
                institution_id=inst.id,
                alias=body.alias.strip(),
                alias_norm=norm,
                source="STEWARD",
                confirmed_by=user.id,
            )
        )
        chain.record(
            db,
            "institution.alias_added",
            actor_id=user.id,
            actor_unit_id=user.unit_id,
            entity_type="institution",
            entity_id=pid,
            payload={"alias": body.alias.strip()},
        )
    db.commit()
    return {"ok": True, "alias_norm": norm, "existed": bool(exists)}
