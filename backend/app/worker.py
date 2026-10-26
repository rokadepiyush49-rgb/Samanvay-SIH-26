"""Worker process: claims jobs from the Postgres queue and runs periodic tasks (timers, e-mail, checkpoints).

Run: python -m app.worker
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import time
import traceback
import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core import jobs
from app.core.config import get_settings
from app.core.db import worker_session
from app.core.middleware import configure_logging
from app.models import ImportJob
from app.modules.audit import chain
from app.modules.imports.service import process_import
from app.modules.matching.engine import match_case, notify_related_digest
from app.modules.sla.timers import fire_due_timers, send_pending_emails

log = logging.getLogger("samanvay.worker")
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"


def _actor_for_import(db: Session, job: ImportJob):
    """The importer acts as the uploading officer (their unit and roles), with an ephemeral session id."""
    from sqlalchemy import text

    from app.modules.policy.roles import CurrentUser

    r = db.execute(
        text(
            "SELECT u.id, u.email, u.full_name, u.designation, u.unit_id, u.roles, u.sealed_clearance, "
            "un.code, un.name, un.region_id FROM app_user u JOIN unit un ON un.id = u.unit_id "
            "WHERE u.id = :u"
        ),
        {"u": job.uploaded_by},
    ).first()
    return CurrentUser(
        id=r.id,
        email=r.email,
        full_name=r.full_name,
        designation=r.designation,
        unit_id=r.unit_id,
        unit_code=r.code,
        unit_name=r.name,
        region_id=r.region_id,
        roles=frozenset(r.roles),
        sealed_clearance=r.sealed_clearance,
        session_id=uuid.uuid4(),
    )


def handle_match(db: Session, payload: dict) -> None:
    match_case(db, uuid.UUID(payload["case_id"]))


def handle_import(db: Session, payload: dict) -> None:
    job = db.get(ImportJob, uuid.UUID(payload["import_job_id"]), with_for_update=True)
    if job is None or job.status in ("DONE", "FAILED"):
        return
    job.status = "RUNNING"
    db.commit()
    try:
        process_import(db, job, _actor_for_import(db, job))
    except Exception as exc:
        db.rollback()
        job = db.get(ImportJob, uuid.UUID(payload["import_job_id"]))
        job.status, job.errors = "FAILED", [{"row": 0, "error": f"Import failed: {exc.__class__.__name__}"}]
        raise
    chain.record(
        db,
        "import.finished",
        actor_id=job.uploaded_by,
        actor_unit_id=job.unit_id,
        entity_type="import",
        entity_id=job.id,
        payload={
            "created": job.created_rows,
            "duplicates": job.duplicate_rows,
            "errors": job.error_rows,
            "status": job.status,
        },
    )


HANDLERS: dict[str, Callable[[Session, dict], None]] = {"match_case": handle_match, "import_register": handle_import}


def run_one_job(db: Session) -> bool:
    row = jobs.claim(db, WORKER_ID)
    if row is None:
        db.commit()
        return False
    db.commit()
    try:
        HANDLERS[row.kind](db, row.payload)
        jobs.complete(db, row.id)
        db.commit()
    except Exception as exc:  # noqa: BLE001 - every failure is recorded on the job and retried with backoff
        db.rollback()
        log.error("job %s (%s) failed: %s", row.id, row.kind, traceback.format_exc(limit=3))
        jobs.fail(db, row.id, row.attempts, row.max_attempts, f"{exc.__class__.__name__}: {exc}")
        db.commit()
    return True


def drain(max_jobs: int = 100000) -> int:
    """Process queued jobs until the queue is empty (used by seeding and tests)."""
    done = 0
    db = worker_session()
    try:
        while done < max_jobs and run_one_job(db):
            done += 1
    finally:
        db.close()
    return done


PERIODIC = [
    ("fire_timers", 15, lambda db: fire_due_timers(db)),
    ("send_emails", 30, lambda db: send_pending_emails(db)),
    ("related_digest", 24 * 3600, lambda db: notify_related_digest(db)),
    ("audit_checkpoint", 6 * 3600, lambda db: chain.create_checkpoint(db)),
]


def main() -> None:
    configure_logging()
    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    last_run = {name: 0.0 for name, _, _ in PERIODIC}
    log.info("worker started", extra={"user_id": WORKER_ID})
    db = worker_session()
    get_settings()
    while not stop:
        now = time.monotonic()
        for name, every, fn in PERIODIC:
            if now - last_run[name] >= every:
                try:
                    fn(db)
                    db.commit()
                except Exception:  # noqa: BLE001
                    db.rollback()
                    log.exception("periodic task %s failed", name)
                last_run[name] = now
        busy = False
        for _ in range(20):
            if stop or not run_one_job(db):
                break
            busy = True
        if not busy:
            time.sleep(1.0)
    db.close()
    log.info("worker stopped")


if __name__ == "__main__":
    main()
