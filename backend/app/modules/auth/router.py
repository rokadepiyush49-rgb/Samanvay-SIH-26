"""Sign-in, sign-out, session refresh and (demo builds only) one-click role switching."""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import AppError, not_found
from app.core.security import CSRF_COOKIE, SESSION_COOKIE, issue_token, new_csrf_token, verify_password
from app.models import AppUser, UserSession
from app.modules.audit import chain
from app.modules.auth.deps import current_user, load_user
from app.modules.policy.roles import ROLE_LABELS, CurrentUser, Role

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class DemoLoginIn(BaseModel):
    user_id: uuid.UUID


def me_payload(user: CurrentUser) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "designation": user.designation,
        "unit": {"id": str(user.unit_id), "code": user.unit_code, "name": user.unit_name},
        "region_id": user.region_id,
        "roles": sorted(user.roles),
        "role_labels": [ROLE_LABELS[Role(r)] for r in sorted(user.roles) if r in Role.__members__],
        "sealed_clearance": user.sealed_clearance,
        "landing": user.landing,
        "is_demo": user.is_demo,
        "demo_mode": get_settings().demo_mode,
    }


def _start_session(db: Session, user: AppUser, request: Request, response: Response) -> uuid.UUID:
    settings = get_settings()
    expires = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=settings.session_minutes)
    sess = UserSession(
        user_id=user.id,
        expires_at=expires,
        ip=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    db.add(sess)
    db.flush()
    _set_cookies(response, issue_token(user.id, sess.id, expires), settings.session_minutes)
    return sess.id


def _set_cookies(response: Response, token: str, minutes: int) -> None:
    secure = get_settings().cookie_secure
    response.set_cookie(
        SESSION_COOKIE, token, max_age=minutes * 60, httponly=True, secure=secure, samesite="lax", path="/"
    )
    # Rotate the CSRF token on every sign-in.
    response.set_cookie(CSRF_COOKIE, new_csrf_token(), httponly=False, secure=secure, samesite="lax", path="/")


@router.get("/csrf")
def csrf(request: Request, response: Response) -> dict:
    """Ensures the browser holds a CSRF cookie before its first unsafe request (the middleware sets it)."""
    return {"ok": True}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    email = body.email.strip().lower()
    user = db.query(AppUser).filter(AppUser.email == email).with_for_update().first()
    now = dt.datetime.now(dt.UTC)
    generic = AppError(401, "Sign-in failed", "The e-mail or password is incorrect.", "bad-credentials")
    if user is None:
        verify_password(body.password, None)  # equal timing for unknown accounts
        raise generic
    if user.locked_until and user.locked_until > now:
        raise AppError(
            423,
            "Account temporarily locked",
            "Too many failed attempts. Try again later or contact your administrator.",
            "locked",
        )
    if not user.is_active or not verify_password(body.password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= settings.login_max_failures:
            user.locked_until = now + dt.timedelta(minutes=settings.login_lockout_minutes)
            user.failed_logins = 0
            chain.record(db, "auth.locked", actor_id=user.id, entity_type="user", entity_id=user.id)
        db.commit()
        raise generic
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    session_id = _start_session(db, user, request, response)
    chain.record(db, "auth.login", actor_id=user.id, actor_unit_id=user.unit_id, entity_type="user", entity_id=user.id)
    db.commit()
    return me_payload(load_user(db, str(user.id), str(session_id)))


@router.post("/logout")
def logout(response: Response, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    db.execute(text("UPDATE user_session SET revoked_at = now() WHERE id = :s"), {"s": user.session_id})
    chain.record(db, "auth.logout", actor_id=user.id, actor_unit_id=user.unit_id, entity_type="user", entity_id=user.id)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)) -> dict:
    return me_payload(user)


@router.post("/refresh")
def refresh(response: Response, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    minutes = get_settings().session_minutes
    expires = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=minutes)
    db.execute(text("UPDATE user_session SET expires_at = :e WHERE id = :s"), {"e": expires, "s": user.session_id})
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        issue_token(user.id, user.session_id, expires),
        max_age=minutes * 60,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        path="/",
    )
    return {"expires_at": expires.isoformat()}


def _require_demo() -> None:
    settings = get_settings()
    if not settings.demo_mode or settings.app_env == "production":
        raise not_found("Page")


@router.get("/demo-users")
def demo_users(db: Session = Depends(get_db)) -> list[dict]:
    _require_demo()
    rows = db.execute(
        text(
            "SELECT u.id, u.full_name, u.designation, u.roles, un.code AS unit_code, un.name AS unit_name "
            "FROM app_user u JOIN unit un ON un.id = u.unit_id WHERE u.is_demo AND u.is_active "
            "ORDER BY un.code, u.full_name"
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "full_name": r.full_name,
            "designation": r.designation,
            "unit_code": r.unit_code,
            "unit_name": r.unit_name,
            "roles": r.roles,
            "role_labels": [ROLE_LABELS[Role(x)] for x in r.roles if x in Role.__members__],
        }
        for r in rows
    ]


@router.post("/demo-login")
def demo_login(body: DemoLoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    _require_demo()
    user = db.get(AppUser, body.user_id)
    if user is None or not user.is_demo or not user.is_active:
        raise not_found("Demo user")
    user.last_login_at = dt.datetime.now(dt.UTC)
    session_id = _start_session(db, user, request, response)
    chain.record(
        db, "auth.demo_login", actor_id=user.id, actor_unit_id=user.unit_id, entity_type="user", entity_id=user.id
    )
    db.commit()
    return me_payload(load_user(db, str(user.id), str(session_id)))
