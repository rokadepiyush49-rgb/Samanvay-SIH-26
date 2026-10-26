"""Password hashing, session tokens and CSRF tokens."""

from __future__ import annotations

import datetime as dt
import secrets
import uuid

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

SESSION_COOKIE = "smv_session"
CSRF_COOKIE = "smv_csrf"
CSRF_HEADER = "x-csrf-token"

_hasher = PasswordHasher()
# Verifying against a dummy hash for unknown users keeps login timing uniform.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def _secret() -> str:
    secret = get_settings().jwt_secret.get_secret_value()
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters")
    return secret


def issue_token(user_id: uuid.UUID, session_id: uuid.UUID, expires_at: dt.datetime) -> str:
    now = dt.datetime.now(dt.UTC)
    claims = {
        "sub": str(user_id),
        "sid": str(session_id),
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "typ": "session",
    }
    return jwt.encode(claims, _secret(), algorithm="HS256")


def decode_token(token: str) -> dict | None:
    try:
        claims = jwt.decode(token, _secret(), algorithms=["HS256"], options={"require": ["sub", "sid", "exp"]})
    except jwt.PyJWTError:
        return None
    return claims if claims.get("typ") == "session" else None


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)
