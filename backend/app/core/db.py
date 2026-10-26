"""Database engines and sessions.

The API session carries the caller's identity into PostgreSQL with SET LOCAL (set_config(..., true)) at the start
of every transaction, so row-level security policies see the same user, unit, roles and clearance as the API.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@dataclass(frozen=True)
class RlsContext:
    user_id: str
    unit_id: str
    roles: tuple[str, ...]
    clearance: bool
    region_id: int | None


_SET_RLS = text(
    "SELECT set_config('app.user_id', :u, true), set_config('app.unit_id', :un, true), "
    "set_config('app.roles', :r, true), set_config('app.clearance', :c, true), "
    "set_config('app.region_id', :rg, true)"
)


def apply_rls(connection, ctx: RlsContext) -> None:
    connection.execute(
        _SET_RLS,
        {
            "u": ctx.user_id,
            "un": ctx.unit_id,
            "r": ",".join(ctx.roles),
            "c": "on" if ctx.clearance else "off",
            "rg": "" if ctx.region_id is None else str(ctx.region_id),
        },
    )


@event.listens_for(Session, "after_begin")
def _set_rls_on_begin(session: Session, transaction, connection) -> None:
    ctx = session.info.get("rls")
    if ctx is not None:
        apply_rls(connection, ctx)


def bind_identity(session: Session, ctx: RlsContext) -> None:
    """Attach the identity for this and every later transaction of the session."""
    session.info["rls"] = ctx
    if session.in_transaction():
        apply_rls(session.connection(), ctx)


@lru_cache
def api_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True, pool_size=10, max_overflow=10)


@lru_cache
def worker_engine() -> Engine:
    return create_engine(get_settings().worker_database_url, pool_pre_ping=True, pool_size=5)


@lru_cache
def _api_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=api_engine(), expire_on_commit=False)


@lru_cache
def _worker_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=worker_engine(), expire_on_commit=False)


def api_session() -> Session:
    return _api_sessionmaker()()


def worker_session() -> Session:
    return _worker_sessionmaker()()


def get_db() -> Iterator[Session]:
    """FastAPI dependency. Endpoints commit explicitly; anything uncommitted is rolled back."""
    db = api_session()
    try:
        yield db
    finally:
        db.rollback()
        db.close()
