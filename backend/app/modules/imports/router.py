"""Register Importer API: preview with suggested mappings, start an import, follow its row-level report."""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.crypto import sha256_hex
from app.core.db import get_db
from app.core.errors import invalid, not_found
from app.core.jobs import enqueue
from app.models import ImportJob, MappingProfile
from app.modules.audit import chain
from app.modules.auth.deps import current_user
from app.modules.documents.router import _safe_filename, read_limited
from app.modules.documents.storage import new_key, scan, store
from app.modules.imports import service
from app.modules.policy.roles import INTAKE_ROLES, CurrentUser

router = APIRouter(prefix="/imports", tags=["imports"])
MAX_MB = 10


class ProfileIn(BaseModel):
    channel: str
    column_map: dict[str, str | None]
    status_map: dict[str, str | None] = Field(default_factory=dict)
    category_map: dict[str, str | None] = Field(default_factory=dict)
    date_format: str | None = None
    save_as: str | None = Field(default=None, max_length=80)


@router.get("/profiles")
def profiles(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = (
        db.query(MappingProfile)
        .filter((MappingProfile.unit_id == user.unit_id) | (MappingProfile.unit_id.is_(None)))
        .order_by(MappingProfile.name)
        .all()
    )
    return {
        "items": [
            {
                "id": str(p.id),
                "name": p.name,
                "channel": p.channel,
                "column_map": p.column_map,
                "status_map": p.status_map,
                "category_map": p.category_map,
                "date_format": p.date_format,
                "shared": p.unit_id is None,
            }
            for p in rows
        ]
    }


@router.post("/preview")
def preview(
    file: UploadFile = File(...), user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    user.require(INTAKE_ROLES, "import registers")
    data = read_limited(file, MAX_MB * 1024 * 1024)
    return service.preview(db, data, _safe_filename(file.filename or "register.csv"))


@router.post("", status_code=202)
def start(
    file: UploadFile = File(...),
    profile: str = Form(...),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    user.require(INTAKE_ROLES, "import registers")
    try:
        prof = ProfileIn.model_validate(json.loads(profile))
    except (ValueError, ValidationError) as exc:
        raise invalid("The mapping profile is not valid JSON.", detail_errors=str(exc)[:500]) from None
    data = read_limited(file, MAX_MB * 1024 * 1024)
    filename = _safe_filename(file.filename or "register.csv")
    service.read_table(data, filename)  # fail fast on unreadable files
    result = scan(data)
    if result.status != "CLEAN":
        raise invalid(f"The file did not pass the malware scan: {result.detail}")
    key = new_key(f"imports/{user.unit_id}", filename)
    store().put(key, data)
    body = prof.model_dump(exclude={"save_as"})
    job = service.new_job(db, user, filename, sha256_hex(data), key, body)
    if prof.save_as:
        existing = (
            db.query(MappingProfile)
            .filter(MappingProfile.unit_id == user.unit_id, MappingProfile.name == prof.save_as)
            .first()
        )
        if existing:
            existing.column_map, existing.status_map = prof.column_map, prof.status_map
            existing.category_map, existing.date_format, existing.channel = (
                prof.category_map,
                prof.date_format,
                prof.channel,
            )
        else:
            db.add(
                MappingProfile(
                    unit_id=user.unit_id,
                    name=prof.save_as,
                    channel=prof.channel,
                    column_map=prof.column_map,
                    status_map=prof.status_map,
                    category_map=prof.category_map,
                    date_format=prof.date_format,
                    created_by=user.id,
                )
            )
    enqueue(db, "import_register", {"import_job_id": str(job.id)}, priority=60)
    chain.record(
        db,
        "import.started",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="import",
        entity_id=job.id,
        payload={"filename": filename, "sha256": job.file_sha256, "channel": prof.channel},
    )
    db.commit()
    return {"id": str(job.id), "status": job.status}


def _job_payload(j: ImportJob, errors: bool = False) -> dict:
    out = {
        "id": str(j.id),
        "filename": j.filename,
        "status": j.status,
        "total_rows": j.total_rows,
        "created_rows": j.created_rows,
        "duplicate_rows": j.duplicate_rows,
        "error_rows": j.error_rows,
        "created_at": j.created_at.isoformat(),
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        "channel": j.profile.get("channel"),
        "file_sha256": j.file_sha256,
    }
    if errors:
        out["errors"] = j.errors
    return out


@router.get("")
def list_jobs(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    jobs = db.query(ImportJob).filter(ImportJob.unit_id == user.unit_id).order_by(ImportJob.created_at.desc()).limit(30)
    return {"items": [_job_payload(j) for j in jobs]}


@router.get("/{job_id}")
def get_job(job_id: uuid.UUID, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    job = db.get(ImportJob, job_id)
    if job is None or job.unit_id != user.unit_id:
        raise not_found("Import")
    out = _job_payload(job, errors=True)
    out["overlaps_found"] = db.execute(
        text(
            "SELECT count(*) FROM case_link l JOIN case_record c ON c.id IN (l.left_id, l.right_id) "
            "WHERE c.import_job_id = :j AND l.link_type IN ('D', 'P', 'R')"
        ),
        {"j": job_id},
    ).scalar_one()
    out["matching_pending"] = db.execute(
        text("SELECT count(*) FROM case_record WHERE import_job_id = :j AND matched_at IS NULL"), {"j": job_id}
    ).scalar_one()
    return out
