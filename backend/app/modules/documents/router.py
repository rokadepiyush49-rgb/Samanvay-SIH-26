"""Supporting documents: quarantine → type check → scan → hash → store (blueprint SOL-11)."""

from __future__ import annotations

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import sha256_hex
from app.core.db import get_db
from app.core.errors import AppError, forbidden, invalid, not_found
from app.models import Document
from app.modules.audit import chain
from app.modules.auth.deps import current_user
from app.modules.case import service as case_service
from app.modules.documents.service import attach
from app.modules.documents.storage import store
from app.modules.policy.roles import CASEWORK_ROLES, CurrentUser, Role

router = APIRouter(tags=["documents"])


def read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    chunks, total = [], 0
    while True:
        chunk = upload.file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise AppError(
                413, "File too large", f"Files must be {max_bytes // (1024 * 1024)} MB or smaller.", "too-large"
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/cases/{case_ref}/documents", status_code=201)
def upload(
    case_ref: str,
    file: UploadFile = File(...),
    note: str | None = Form(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    case = case_service.get_case(db, case_ref, for_update=True)
    if not case_service.has_full_access(db, case.id):
        raise forbidden("Only officers with access to this case's content can attach documents.")
    user.require(CASEWORK_ROLES | {Role.INTAKE_OFFICER}, "attach documents")
    data = read_limited(file, get_settings().max_upload_mb * 1024 * 1024)
    if not data:
        raise invalid("The file is empty.")
    doc = attach(db, user, case, file.filename or "document", data, note)
    db.commit()
    if doc.scan_status == "REJECTED":
        raise AppError(422, "File rejected", doc.scan_detail, "malware", document_id=str(doc.id))
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "sha256": doc.sha256,
        "scan_status": doc.scan_status,
        "scan_detail": doc.scan_detail,
        "size_bytes": doc.size_bytes,
    }


@router.get("/documents/{doc_id}")
def download(doc_id: uuid.UUID, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    doc = db.get(Document, doc_id)  # RLS returns nothing unless the caller has full access to the case
    if doc is None:
        raise not_found("Document")
    if doc.scan_status != "CLEAN":
        raise AppError(409, "Document not available", "This file has not passed the malware scan.", "not-clean")
    data = store().get(doc.object_key)
    if sha256_hex(data) != doc.sha256:
        chain.record(
            db,
            "document.integrity_failed",
            actor_id=user.id,
            entity_type="document",
            entity_id=doc.id,
            payload={"expected": doc.sha256},
        )
        db.commit()
        raise AppError(
            409,
            "Integrity check failed",
            "The stored file no longer matches its recorded hash. The incident has been logged.",
            "integrity",
        )
    chain.record(
        db,
        "document.downloaded",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="document",
        entity_id=doc.id,
        payload={"sha256": doc.sha256},
    )
    db.commit()
    return Response(
        content=data,
        media_type=doc.mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(doc.filename)}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
