"""Authentication dependency: cookie → session row → fresh user record → RLS context."""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import RlsContext, bind_identity, get_db
from app.core.errors import AppError
from app.core.security import SESSION_COOKIE, decode_token
from app.modules.policy.roles import CurrentUser

_LOAD = text(
    """
    SELECT u.id, u.email, u.full_name, u.designation, u.unit_id, u.roles, u.sealed_clearance, u.is_active, u.is_demo,
           un.code AS unit_code, un.name AS unit_name, un.region_id, s.expires_at, s.revoked_at
    FROM user_session s
    JOIN app_user u ON u.id = s.user_id
    JOIN unit un ON un.id = u.unit_id
    WHERE s.id = :sid AND u.id = :uid
    """
)


def _unauthenticated(detail: str = "Please sign in to continue.") -> AppError:
    return AppError(401, "Sign-in required", detail, "unauthenticated")


def load_user(db: Session, user_id: str, session_id: str) -> CurrentUser:
    try:
        row = db.execute(_LOAD, {"sid": uuid.UUID(session_id), "uid": uuid.UUID(user_id)}).first()
    except ValueError:
        raise _unauthenticated() from None
    now = dt.datetime.now(dt.UTC)
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise _unauthenticated("Your session has ended. Please sign in again.")
    if not row.is_active:
        raise _unauthenticated("This account is disabled.")
    return CurrentUser(
        id=row.id,
        email=row.email,
        full_name=row.full_name,
        designation=row.designation,
        unit_id=row.unit_id,
        unit_code=row.unit_code,
        unit_name=row.unit_name,
        region_id=row.region_id,
        roles=frozenset(row.roles),
        sealed_clearance=row.sealed_clearance,
        session_id=uuid.UUID(session_id),
        is_demo=row.is_demo,
    )


def current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    token = request.cookies.get(SESSION_COOKIE)
    claims = decode_token(token) if token else None
    if not claims:
        raise _unauthenticated()
    user = load_user(db, claims["sub"], claims["sid"])
    bind_identity(
        db,
        RlsContext(
            user_id=str(user.id),
            unit_id=str(user.unit_id),
            roles=tuple(sorted(user.roles)),
            clearance=user.sealed_clearance,
            region_id=user.region_id,
        ),
    )
    request.state.user_id = str(user.id)
    return user
