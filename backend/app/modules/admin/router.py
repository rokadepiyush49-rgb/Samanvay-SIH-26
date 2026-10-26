"""Reference data for forms, officer lists, user administration, invariants and access review."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import conflict, forbidden, invalid, not_found
from app.core.security import hash_password
from app.models import AppUser, Unit
from app.modules.audit import chain
from app.modules.auth.deps import current_user
from app.modules.case import fsm
from app.modules.case.service import CHANNELS, COMPLAINANT_TYPES
from app.modules.matching.scoring import PS_PHRASE
from app.modules.policy.roles import ROLE_LABELS, CurrentUser, Role

router = APIRouter(tags=["admin"])


@router.get("/meta")
def meta(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    cats = db.execute(
        text(
            "SELECT code, name, name_hi, group_code, default_unit_code, sensitivity FROM category "
            "WHERE is_active ORDER BY group_code, name"
        )
    ).all()
    units = db.execute(
        text(
            "SELECT u.code, u.name, u.name_hi, u.unit_type, u.region_id FROM unit u WHERE u.is_active "
            "ORDER BY u.unit_type, u.code"
        )
    ).all()
    regions = db.execute(text("SELECT id, code, name FROM region ORDER BY id")).all()
    rules = fsm.rules(db)
    return {
        "statuses": [{"code": s, "label": fsm.STATUS_LABELS[s], "bucket": fsm.ps_bucket(s)} for s in fsm.STATUSES],
        "buckets": fsm.PS_BUCKETS,
        "channels": CHANNELS,
        "complainant_types": COMPLAINANT_TYPES,
        "categories": [dict(c._mapping) for c in cats],
        "units": [dict(u._mapping) for u in units],
        "regions": [dict(r._mapping) for r in regions],
        "roles": [{"code": r.value, "label": ROLE_LABELS[r]} for r in Role],
        "consequential_actions": sorted({r.action for r in rules.values() if r.consequential}),
        "phrase": PS_PHRASE,
    }


@router.get("/units/{code}/officers")
def officers(code: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    unit = db.query(Unit).filter(Unit.code == code).first()
    if unit is None:
        raise not_found("Unit")
    if unit.id != user.unit_id and not user.has(Role.SYS_ADMIN, Role.COMPETENT_AUTHORITY):
        raise forbidden("You can list officers of your own unit only.")
    rows = db.execute(
        text(
            "SELECT u.id, u.full_name, u.designation, u.roles, "
            "(SELECT count(*) FROM case_record c WHERE c.holding_officer_id = u.id "
            "AND c.status <> ALL(:t)) AS open_cases "
            "FROM app_user u WHERE u.unit_id = :u AND u.is_active AND ('CASE_OFFICER' = ANY(u.roles) OR "
            "'UNIT_HEAD' = ANY(u.roles) OR 'REGIONAL_OFFICER' = ANY(u.roles)) ORDER BY u.full_name"
        ),
        {"u": unit.id, "t": list(fsm.TERMINAL)},
    ).all()
    return {
        "items": [
            {
                "id": str(r.id),
                "full_name": r.full_name,
                "designation": r.designation,
                "roles": r.roles,
                "open_cases": r.open_cases,
            }
            for r in rows
        ]
    }


@router.get("/admin/users")
def list_users(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require({Role.SYS_ADMIN, Role.AUDITOR}, "view user accounts")
    rows = db.execute(
        text(
            "SELECT u.id, u.email, u.full_name, u.designation, u.roles, u.sealed_clearance, "
            "u.is_active, u.last_login_at, un.code AS unit FROM app_user u JOIN unit un ON "
            "un.id = u.unit_id ORDER BY un.code, u.full_name"
        )
    ).all()
    return {
        "items": [
            {
                **dict(r._mapping),
                "id": str(r.id),
                "last_login_at": r.last_login_at.isoformat() if r.last_login_at else None,
            }
            for r in rows
        ]
    }


class UserIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    full_name: str = Field(min_length=2, max_length=200)
    designation: str | None = Field(default=None, max_length=120)
    unit: str
    roles: list[Role]
    password: str = Field(min_length=12, max_length=256)
    sealed_clearance: bool = False


@router.post("/admin/users", status_code=201)
def create_user(body: UserIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require({Role.SYS_ADMIN}, "create user accounts")
    unit = db.query(Unit).filter(Unit.code == body.unit).first()
    if unit is None:
        raise invalid("Unknown unit.")
    if db.query(AppUser).filter(AppUser.email == body.email.lower()).first():
        raise conflict("An account with this e-mail already exists.")
    u = AppUser(
        id=uuid.uuid4(),
        email=body.email.lower(),
        full_name=body.full_name,
        designation=body.designation,
        unit_id=unit.id,
        roles=[r.value for r in body.roles],
        password_hash=hash_password(body.password),
        sealed_clearance=body.sealed_clearance,
    )
    db.add(u)
    chain.record(
        db,
        "admin.user_created",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="user",
        entity_id=u.id,
        payload={"email": u.email, "unit": unit.code, "roles": u.roles, "sealed_clearance": u.sealed_clearance},
    )
    db.commit()
    return {"id": str(u.id)}


class UserPatch(BaseModel):
    roles: list[Role] | None = None
    is_active: bool | None = None
    sealed_clearance: bool | None = None


@router.patch("/admin/users/{uid}")
def update_user(
    uid: uuid.UUID, body: UserPatch, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    user.require({Role.SYS_ADMIN}, "change user accounts")
    if uid == user.id:
        raise forbidden("Administrators cannot change their own roles or status.")
    u = db.get(AppUser, uid, with_for_update=True)
    if u is None:
        raise not_found("User")
    before = {"roles": u.roles, "is_active": u.is_active, "sealed_clearance": u.sealed_clearance}
    if body.roles is not None:
        u.roles = [r.value for r in body.roles]
    if body.is_active is not None:
        u.is_active = body.is_active
        if not body.is_active:
            db.execute(
                text("UPDATE user_session SET revoked_at = now() WHERE user_id = :u AND revoked_at IS NULL"), {"u": uid}
            )
    if body.sealed_clearance is not None:
        u.sealed_clearance = body.sealed_clearance
    chain.record(
        db,
        "admin.user_changed",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="user",
        entity_id=uid,
        payload={"before": before, "after": body.model_dump(exclude_none=True, mode="json")},
    )
    db.commit()
    return {"ok": True}


@router.get("/admin/health")
def invariants(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Operational invariants: zero orphan cases is a hard target (REQ-002)."""
    user.require({Role.SYS_ADMIN, Role.AUDITOR, Role.SENIOR_MGMT}, "view system health")
    t = list(fsm.TERMINAL)
    orphan = (
        db.execute(
            text(
                "SELECT case_no FROM case_record WHERE status <> ALL(:t) AND holding_officer_id IS NULL "
                "ORDER BY received_on LIMIT 50"
            ),
            {"t": t},
        )
        .scalars()
        .all()
    )
    orphan_n = db.execute(
        text("SELECT count(*) FROM case_record WHERE status <> ALL(:t) AND holding_officer_id IS NULL"), {"t": t}
    ).scalar_one()
    jobs = db.execute(text("SELECT status, count(*) AS n FROM job GROUP BY status")).all()
    stuck = db.execute(
        text("SELECT count(*) FROM transfer WHERE status = 'PROPOSED' AND proposed_at < now() - interval '7 days'")
    ).scalar_one()
    unmatched = db.execute(
        text("SELECT count(*) FROM case_record WHERE matched_at IS NULL AND status <> ALL(:t)"), {"t": t}
    ).scalar_one()
    dead = db.execute(
        text("SELECT id, kind, last_error, finished_at FROM job WHERE status = 'DEAD' ORDER BY id DESC LIMIT 10")
    ).all()
    return {
        "orphan_open_cases": orphan_n,
        "orphan_examples": orphan,
        "stuck_transfers": stuck,
        "unmatched_open_cases": unmatched,
        "jobs": {r.status: r.n for r in jobs},
        "dead_jobs": [{"id": r.id, "kind": r.kind, "error": (r.last_error or "")[:300]} for r in dead],
    }


@router.get("/admin/access-review")
def access_review(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require({Role.SYS_ADMIN, Role.AUDITOR}, "run access reviews")
    rows = db.execute(
        text(
            "SELECT u.email, u.full_name, un.code AS unit, u.roles, u.sealed_clearance, u.is_active, "
            "u.last_login_at, (SELECT count(*) FROM access_grant g WHERE g.user_id = u.id AND "
            "g.revoked_at IS NULL AND g.valid_to > now()) AS active_grants FROM app_user u "
            "JOIN unit un ON un.id = u.unit_id ORDER BY un.code, u.email"
        )
    ).all()
    return {
        "items": [
            {**dict(r._mapping), "last_login_at": r.last_login_at.isoformat() if r.last_login_at else None}
            for r in rows
        ]
    }
