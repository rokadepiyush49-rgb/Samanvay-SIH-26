"""In-app notifications (outbox) and recipient lookup. Messages carry case numbers and links, never complaint text."""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

EMAIL_SEVERITIES = {"WARNING", "CRITICAL"}


def notify(
    db: Session,
    user_ids: Iterable[uuid.UUID | str | None],
    *,
    family: str,
    title: str,
    body: str = "",
    link: str | None = None,
    case_id: uuid.UUID | None = None,
    severity: str = "INFO",
    key: str,
) -> int:
    """Create one notification per recipient; `key` makes repeated calls idempotent per recipient."""
    created = 0
    for uid in {str(u) for u in user_ids if u}:
        res = db.execute(
            text(
                "INSERT INTO notification (user_id, family, severity, title, body, link, case_id, dedupe_key, "
                "email_status, email_next_at) VALUES (:u, :f, :s, :t, :b, :l, :c, :k, :es, now()) "
                "ON CONFLICT (dedupe_key) DO NOTHING"
            ),
            {
                "u": uid,
                "f": family,
                "s": severity,
                "t": title[:200],
                "b": body[:500],
                "l": link,
                "c": case_id,
                "k": f"{key}:{uid}",
                "es": "PENDING" if severity in EMAIL_SEVERITIES else "NONE",
            },
        )
        created += res.rowcount or 0
    return created


def users_with_role(db: Session, role: str, unit_id: uuid.UUID | None = None) -> list[uuid.UUID]:
    sql = "SELECT id FROM app_user WHERE is_active AND :r = ANY(roles)"
    params: dict = {"r": role}
    if unit_id:
        sql += " AND unit_id = :u"
        params["u"] = unit_id
    return [r.id for r in db.execute(text(sql), params).all()]


def unit_heads(db: Session, unit_id: uuid.UUID) -> list[uuid.UUID]:
    return users_with_role(db, "UNIT_HEAD", unit_id)


def unit_officers(db: Session, unit_id: uuid.UUID) -> list[uuid.UUID]:
    return [
        r.id
        for r in db.execute(
            text(
                "SELECT id FROM app_user WHERE is_active AND unit_id = :u AND "
                "('CASE_OFFICER' = ANY(roles) OR 'UNIT_HEAD' = ANY(roles) OR 'REGIONAL_OFFICER' = ANY(roles))"
            ),
            {"u": unit_id},
        ).all()
    ]


def case_link(case_no: str) -> str:
    return f"/cases/{case_no}"
