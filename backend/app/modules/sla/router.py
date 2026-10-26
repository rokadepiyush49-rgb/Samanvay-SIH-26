"""Notifications for the signed-in user, and SLA policy administration (versioned)."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import invalid
from app.modules.audit import chain
from app.modules.auth.deps import current_user
from app.modules.policy.roles import CurrentUser, Role

router = APIRouter(tags=["notifications", "sla"])


@router.get("/me/notifications")
def my_notifications(
    unread: bool = False,
    family: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    where = ["user_id = :u"]
    p: dict = {"u": user.id, "n": limit}
    if unread:
        where.append("read_at IS NULL")
    if family:
        where.append("family = :f")
        p["f"] = family
    rows = db.execute(
        text(
            f"SELECT id, family, severity, title, body, link, created_at, read_at FROM notification "
            f"WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT :n"
        ),
        p,
    ).all()
    counts = db.execute(
        text("SELECT family, count(*) AS n FROM notification WHERE user_id = :u AND read_at IS NULL GROUP BY family"),
        {"u": user.id},
    ).all()
    return {
        "items": [
            {
                "id": str(r.id),
                "family": r.family,
                "severity": r.severity,
                "title": r.title,
                "body": r.body,
                "link": r.link,
                "created_at": r.created_at.isoformat(),
                "read": r.read_at is not None,
            }
            for r in rows
        ],
        "unread": {r.family: r.n for r in counts},
        "unread_total": sum(r.n for r in counts),
    }


@router.post("/notifications/{nid}/read")
def mark_read(nid: uuid.UUID, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    db.execute(
        text("UPDATE notification SET read_at = now() WHERE id = :i AND user_id = :u AND read_at IS NULL"),
        {"i": nid, "u": user.id},
    )
    db.commit()
    return {"ok": True}


@router.post("/me/notifications/read-all")
def mark_all_read(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    db.execute(text("UPDATE notification SET read_at = now() WHERE user_id = :u AND read_at IS NULL"), {"u": user.id})
    db.commit()
    return {"ok": True}


@router.get("/sla-policies")
def list_policies(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        text(
            "SELECT id, code, version, name, channel, category_group, category_code, day_basis, "
            "target_days, reminder_offsets, interim_reply_day, escalate_after_days, approval_status, "
            "is_active, created_at FROM sla_policy ORDER BY code, version DESC"
        )
    ).all()
    return {"items": [{**dict(r._mapping), "created_at": r.created_at.isoformat()} for r in rows]}


class PolicyIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z_]{3,30}$")
    name: str = Field(min_length=3, max_length=200)
    channel: str | None = None
    category_group: str | None = None
    category_code: str | None = None
    day_basis: Literal["CALENDAR", "WORKING"]
    target_days: int = Field(ge=1, le=365)
    reminder_offsets: list[int] = Field(default_factory=lambda: [3, 1])
    interim_reply_day: int | None = Field(default=None, ge=1, le=365)
    escalate_after_days: int = Field(default=5, ge=1, le=60)


@router.post("/sla-policies", status_code=201)
def new_policy_version(
    body: PolicyIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    """New versions apply to new cases only; existing cases keep the version pinned at registration."""
    user.require({Role.SYS_ADMIN}, "configure SLA policies")
    if body.interim_reply_day and body.interim_reply_day >= body.target_days:
        raise invalid("The interim-reply day must be before the target.")
    version = db.execute(
        text("SELECT coalesce(max(version), 0) + 1 FROM sla_policy WHERE code = :c"), {"c": body.code}
    ).scalar_one()
    db.execute(text("UPDATE sla_policy SET is_active = false WHERE code = :c"), {"c": body.code})
    new_id = db.execute(
        text(
            "INSERT INTO sla_policy (code, version, name, channel, category_group, category_code, day_basis, "
            "target_days, reminder_offsets, interim_reply_day, escalate_after_days, created_by) VALUES "
            "(:code, :v, :name, :ch, :g, :cat, :b, :t, :r, :i, :e, :u) RETURNING id"
        ),
        {
            "code": body.code,
            "v": version,
            "name": body.name,
            "ch": body.channel,
            "g": body.category_group,
            "cat": body.category_code,
            "b": body.day_basis,
            "t": body.target_days,
            "r": body.reminder_offsets,
            "i": body.interim_reply_day,
            "e": body.escalate_after_days,
            "u": user.id,
        },
    ).scalar_one()
    chain.record(
        db,
        "sla.policy_versioned",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="sla_policy",
        entity_id=body.code,
        payload={**body.model_dump(), "version": version},
    )
    db.commit()
    return {"id": new_id, "code": body.code, "version": version, "approval_status": "PROPOSED"}
