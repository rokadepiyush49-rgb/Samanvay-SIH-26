"""Postgres-backed job queue. Enqueue happens inside the caller's transaction, so a job exists iff its cause does."""

from __future__ import annotations

import datetime as dt
import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def enqueue(
    db: Session,
    kind: str,
    payload: dict[str, Any] | None = None,
    *,
    priority: int = 100,
    dedupe_key: str | None = None,
    run_after: dt.datetime | None = None,
) -> None:
    db.execute(
        text(
            "INSERT INTO job (kind, payload, priority, dedupe_key, run_after) "
            "VALUES (:k, CAST(:p AS jsonb), :pr, :d, coalesce(:ra, now())) "
            "ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('QUEUED', 'RUNNING') DO NOTHING"
        ),
        {"k": kind, "p": json.dumps(payload or {}, default=str), "pr": priority, "d": dedupe_key, "ra": run_after},
    )


def claim(db: Session, worker_id: str, kinds: list[str] | None = None):
    """Claim one ready job with SKIP LOCKED. Caller commits after marking the job done or failed."""
    kind_filter = "AND kind = ANY(:kinds)" if kinds else ""
    return db.execute(
        text(
            f"""
            UPDATE job SET status = 'RUNNING', locked_at = now(), locked_by = :w, attempts = attempts + 1
            WHERE id = (
              SELECT id FROM job WHERE status = 'QUEUED' AND run_after <= now() {kind_filter}
              ORDER BY priority, run_after, id FOR UPDATE SKIP LOCKED LIMIT 1
            )
            RETURNING id, kind, payload, attempts, max_attempts
            """
        ),
        {"w": worker_id, "kinds": kinds},
    ).first()


def complete(db: Session, job_id: int) -> None:
    db.execute(
        text("UPDATE job SET status = 'DONE', finished_at = now(), locked_at = NULL WHERE id = :i"), {"i": job_id}
    )


def fail(db: Session, job_id: int, attempts: int, max_attempts: int, error: str) -> None:
    if attempts >= max_attempts:
        db.execute(
            text("UPDATE job SET status = 'DEAD', last_error = :e, finished_at = now() WHERE id = :i"),
            {"i": job_id, "e": error[:2000]},
        )
    else:
        backoff = min(600, 2**attempts * 5)
        db.execute(
            text(
                "UPDATE job SET status = 'QUEUED', last_error = :e, locked_at = NULL, "
                "run_after = now() + make_interval(secs => :b) WHERE id = :i"
            ),
            {"i": job_id, "e": error[:2000], "b": backoff},
        )
