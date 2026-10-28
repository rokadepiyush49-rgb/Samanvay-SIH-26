"""Case assistant API: a cited summary of the case and answers to an officer's questions about it."""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.models import CaseRecord
from app.modules.audit import chain
from app.modules.auth.deps import current_user
from app.modules.case import service as case_service
from app.modules.case import views
from app.modules.copilot import engine
from app.modules.messages import service as messages
from app.modules.policy.roles import CASE_VIEW_ROLES, CurrentUser

router = APIRouter(tags=["assistant"])


def _context(db: Session, user: CurrentUser, case: CaseRecord) -> tuple[dict, list[dict]]:
    """The case exactly as this officer may see it, so the assistant can never reveal more than the case page."""
    c = views.case_detail(db, user, case)
    thread = messages.for_case(db, user, case.id) if c["tier"] == "full" else []
    return c, thread


def _audit(db: Session, user: CurrentUser, case: CaseRecord, action: str, out: dict, extra: dict) -> None:
    chain.record(
        db,
        action,
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="case",
        entity_id=case.case_no,
        payload={"mode": out["mode"], "model": out["model"], "sources": [s["id"] for s in out["sources"]], **extra},
    )


@router.get("/assistant/status")
def status(user: CurrentUser = Depends(current_user)) -> dict:
    s = get_settings()
    claude = s.ai_provider == "anthropic"
    return {"mode": "claude" if claude else "offline", "model": s.ai_model if claude else None}


@router.post("/cases/{case_ref}/assistant/summary")
def summary(case_ref: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require(CASE_VIEW_ROLES, "use the case assistant")
    case = case_service.get_case(db, case_ref)
    c, thread = _context(db, user, case)
    out = engine.summarize(c, thread)
    _audit(db, user, case, "ai.summary", out, {})
    db.commit()
    return {**out, "case_no": case.case_no, "tier": c["tier"]}


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@router.post("/cases/{case_ref}/assistant/ask")
def ask(case_ref: str, body: AskIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require(CASE_VIEW_ROLES, "use the case assistant")
    case = case_service.get_case(db, case_ref)
    c, thread = _context(db, user, case)
    question = body.question.strip()
    out = engine.answer(c, thread, question)
    # The question may quote case content, so the audit keeps its hash rather than the text.
    _audit(db, user, case, "ai.question", out, {"question_sha256": hashlib.sha256(question.encode()).hexdigest()})
    db.commit()
    return {**out, "question": question, "case_no": case.case_no, "tier": c["tier"]}
