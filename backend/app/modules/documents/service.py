"""Attaching a document to a case: type check → quarantine → scan → hash → store, with a case event and an audit entry
(blueprint SOL-11). Shared by the upload endpoint and the demo seed, so seeded evidence passes the same pipeline."""

from __future__ import annotations

import re
import uuid

from sqlalchemy.orm import Session

from app.core.crypto import sha256_hex
from app.core.errors import AppError
from app.models import CaseRecord, Document
from app.modules.audit import chain
from app.modules.case import service as case_service
from app.modules.documents.storage import new_key, scan, sniff_type, store
from app.modules.policy.roles import CurrentUser

SAFE_NAME = re.compile(r"[^\w.\- ()ऀ-ॿ]")


def safe_filename(name: str) -> str:
    base = SAFE_NAME.sub("_", (name or "document").split("/")[-1].split("\\")[-1]).strip(". ") or "document"
    return base[:120]


def attach(
    db: Session, user: CurrentUser, case: CaseRecord, filename: str, data: bytes, note: str | None = None
) -> Document:
    """Store the file and record it. A file that fails the scan is recorded as REJECTED (and not stored)."""
    filename = safe_filename(filename)
    mime = sniff_type(data[:4096], filename)
    if mime is None:
        raise AppError(
            415,
            "File type not allowed",
            "Upload PDF, PNG, JPEG, DOCX, XLSX, CSV or plain-text files. The file's content must match its extension.",
            "unsupported-type",
        )
    digest = sha256_hex(data)
    quarantine_key = new_key("quarantine", filename)
    store().put(quarantine_key, data)
    result = scan(data)
    key = quarantine_key
    if result.status == "CLEAN":
        key = new_key(f"cases/{case.id}", filename)
        store().move(quarantine_key, key)
    elif result.status == "REJECTED":
        store().delete(quarantine_key)
    ev = case_service.add_event(
        db,
        case,
        "DOCUMENT_ADDED" if result.status == "CLEAN" else "DOCUMENT_REJECTED",
        user,
        remarks=note,
        data={"filename": filename, "sha256": digest, "scan": result.status, "scan_detail": result.detail},
    )
    doc = Document(
        id=uuid.uuid4(),
        case_id=case.id,
        event_id=ev.id,
        filename=filename,
        mime=mime,
        size_bytes=len(data),
        sha256=digest,
        object_key=key,
        scan_status=result.status,
        scan_detail=result.detail,
        uploaded_by=user.id,
    )
    db.add(doc)
    chain.record(
        db,
        "document.uploaded",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="case",
        entity_id=case.case_no,
        payload={"document_id": str(doc.id), "sha256": digest, "scan": result.status, "size": len(data)},
    )
    return doc
