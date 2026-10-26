"""Case API: intake, register search, workspace, actions, guard, transfers, assignment, notes."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import not_found
from app.models import GuardCheck
from app.modules.auth.deps import current_user
from app.modules.case import service, views
from app.modules.coordination import guard
from app.modules.coordination import service as coord
from app.modules.policy.roles import CASE_VIEW_ROLES, CurrentUser
from app.modules.search.query import CaseFilters

router = APIRouter(tags=["cases"])


def _version(if_match: str | None) -> int | None:
    if not if_match:
        return None
    try:
        return int(if_match.strip('"W/ '))
    except ValueError:
        return None


class CaseCreateIn(BaseModel):
    channel: str = Field(max_length=20)
    category_code: str = Field(max_length=40)
    received_on: dt.date
    subject: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=10, max_length=20000)
    institution_id: uuid.UUID | None = None
    institution_name: str | None = Field(default=None, max_length=300)
    institution_city: str | None = Field(default=None, max_length=100)
    institution_state: str | None = Field(default=None, max_length=100)
    institution_pin: str | None = Field(default=None, pattern=r"^\d{6}$")
    permanent_id: str | None = Field(default=None, pattern=r"^1-\d{7,10}$")
    source_ref: str | None = Field(default=None, max_length=80)
    unit_file_no: str | None = Field(default=None, max_length=80)
    complainant_type: str | None = Field(default=None, max_length=20)
    complainant_name: str | None = Field(default=None, max_length=200)
    complainant_phone: str | None = Field(default=None, max_length=20)
    complainant_email: str | None = Field(default=None, max_length=254)
    next_action: str | None = Field(default=None, max_length=300)

    @field_validator("complainant_type")
    @classmethod
    def _ctype(cls, v: str | None) -> str | None:
        if v and v not in service.COMPLAINANT_TYPES:
            raise ValueError(f"must be one of {', '.join(service.COMPLAINANT_TYPES)}")
        return v


@router.post("/cases", status_code=201)
def create_case(
    body: CaseCreateIn,
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None),
) -> dict:
    case, created = service.create_case(db, user, service.CaseInput(**body.model_dump()))
    db.commit()
    detail = (
        views.case_detail(db, user, case)
        if created or service.has_full_access(db, case.id)
        else {"case_no": case.case_no}
    )
    db.commit()
    return {"created": created, "case": detail}


@router.get("/cases")
def list_cases(
    q: str | None = None,
    institution: str | None = None,
    institution_id: str | None = None,
    permanent_id: str | None = None,
    case_no: str | None = None,
    unit: str | None = None,
    region: int | None = None,
    category: str | None = None,
    status: str | None = None,
    channel: str | None = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    overdue: bool | None = None,
    escalated: bool | None = None,
    overlap: bool | None = None,
    mine: bool | None = None,
    open_only: bool | None = None,
    resolution: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = None,
    order: Literal["received", "due"] = "received",
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    user.require(CASE_VIEW_ROLES, "view cases")
    f = CaseFilters(
        q=q,
        institution=institution,
        institution_id=institution_id,
        permanent_id=permanent_id,
        case_no=case_no,
        unit=unit,
        region=region,
        category=category,
        status=status,
        channel=channel,
        date_from=date_from,
        date_to=date_to,
        overdue=overdue,
        escalated=escalated,
        overlap=overlap,
        mine=mine,
        open_only=open_only,
        resolution=resolution,
    )
    return views.list_cases(db, user, f, limit=limit, cursor=cursor, order=order)


@router.get("/cases/{case_ref}")
def get_case(case_ref: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.require(CASE_VIEW_ROLES, "view cases")
    case = service.get_case(db, case_ref)
    out = views.case_detail(db, user, case)
    db.commit()  # persists the full-content view audit entry
    return out


class ActionIn(BaseModel):
    action: str = Field(max_length=40)
    remarks: str | None = Field(default=None, max_length=4000)
    guard_check_id: uuid.UUID | None = None
    guard_choice: Literal["PROCEED", "PROCEED_AND_NOTIFY"] | None = None
    guard_reason: str | None = Field(default=None, max_length=1000)
    next_action: str | None = Field(default=None, max_length=300)
    next_action_due: dt.date | None = None


@router.post("/cases/{case_ref}/actions")
def record_action(
    case_ref: str,
    body: ActionIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    case = service.get_case(db, case_ref, for_update=True)
    ev = service.perform_action(
        db,
        user,
        case,
        body.action,
        remarks=body.remarks,
        expected_version=_version(if_match),
        guard_check_id=body.guard_check_id,
        guard_choice=body.guard_choice,
        guard_reason=body.guard_reason,
        next_action=body.next_action,
        next_action_due=body.next_action_due,
    )
    db.commit()
    return {"event_id": ev.id, "status": case.status, "row_version": case.row_version}


class NoteIn(BaseModel):
    kind: Literal["NOTE", "INTERIM_REPLY_SENT", "NEXT_ACTION"] = "NOTE"
    remarks: str = Field(min_length=1, max_length=4000)
    next_action: str | None = Field(default=None, max_length=300)
    next_action_due: dt.date | None = None


@router.post("/cases/{case_ref}/notes", status_code=201)
def add_note(
    case_ref: str, body: NoteIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    case = service.get_case(db, case_ref, for_update=True)
    ev = service.record_note(db, user, case, body.kind, body.remarks, body.next_action, body.next_action_due)
    db.commit()
    return {"event_id": ev.id}


class GuardIn(BaseModel):
    action_type: str = Field(max_length=40)


@router.post("/cases/{case_ref}/guard-check")
def guard_check(
    case_ref: str, body: GuardIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    case = service.get_case(db, case_ref)
    gc = guard.run_guard(db, user, case, body.action_type)
    db.commit()
    return guard.guard_payload(gc)


class GuardChoiceIn(BaseModel):
    choice: Literal["OPEN_COORDINATION", "CANCEL"]
    reason: str | None = Field(default=None, max_length=1000)


@router.post("/guard-checks/{guard_id}/choice")
def guard_choice(
    guard_id: uuid.UUID, body: GuardChoiceIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    """Record 'open coordination' or 'cancel'. Proceeding is recorded together with the action itself."""
    gc = db.get(GuardCheck, guard_id, with_for_update=True)
    if gc is None or gc.actor_id != user.id:
        raise not_found("Guard check")
    guard.apply_choice(db, user, gc, body.choice, body.reason)
    opened = []
    if body.choice == "OPEN_COORDINATION":
        case = service.get_case(db, str(gc.case_id))
        for item in gc.found:
            if item.get("decided"):
                continue
            other = service.get_case(db, item["case_id"])
            co = coord.open_manual(db, user, case, other, reason=f"guard:{gc.action}")
            opened.append(co.code)
    gc.consumed_at = dt.datetime.now(dt.UTC)
    db.commit()
    return {"choice": gc.choice, "coordinations": opened}


class TransferIn(BaseModel):
    to_unit: str = Field(max_length=20)
    reason: str = Field(min_length=3, max_length=2000)


@router.post("/cases/{case_ref}/transfers", status_code=201)
def propose_transfer(
    case_ref: str,
    body: TransferIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    case = service.get_case(db, case_ref, for_update=True)
    tr = service.propose_transfer(db, user, case, body.to_unit, body.reason, _version(if_match))
    db.commit()
    return {"transfer_id": str(tr.id), "status": "AWAITING_ACCEPTANCE", "case_status": case.status}


class TransferDecisionIn(BaseModel):
    remarks: str | None = Field(default=None, max_length=2000)
    officer_id: uuid.UUID | None = None


@router.post("/transfers/{transfer_id}/accept")
def accept_transfer(
    transfer_id: uuid.UUID,
    body: TransferDecisionIn,
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    case = service.accept_transfer(db, user, transfer_id, body.officer_id, body.remarks)
    db.commit()
    return {"case_no": case.case_no, "status": case.status, "holding_unit": user.unit_code}


@router.post("/transfers/{transfer_id}/return")
def return_transfer(
    transfer_id: uuid.UUID,
    body: TransferDecisionIn,
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    case = service.return_transfer(db, user, transfer_id, body.remarks or "")
    db.commit()
    return {"case_no": case.case_no, "status": case.status}


class AssignIn(BaseModel):
    officer_id: uuid.UUID
    remarks: str | None = Field(default=None, max_length=1000)


@router.post("/cases/{case_ref}/assign")
def assign(
    case_ref: str,
    body: AssignIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    case = service.get_case(db, case_ref, for_update=True)
    service.assign(db, user, case, body.officer_id, body.remarks, _version(if_match))
    db.commit()
    return {"ok": True, "row_version": case.row_version}


class ConfirmInstitutionIn(BaseModel):
    institution_id: uuid.UUID


@router.post("/cases/{case_ref}/institution")
def confirm_institution(
    case_ref: str,
    body: ConfirmInstitutionIn,
    if_match: str | None = Header(default=None),
    user: CurrentUser = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    case = service.get_case(db, case_ref, for_update=True)
    service.confirm_institution(db, user, case, body.institution_id, _version(if_match))
    db.commit()
    return {"ok": True, "resolution_status": case.resolution_status}


class RevealIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.post("/cases/{case_ref}/complainant")
def reveal(
    case_ref: str, body: RevealIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    case = service.get_case(db, case_ref)
    out = views.reveal_complainant(db, user, case, body.reason)
    db.commit()
    return out


class LinkIn(BaseModel):
    other_case: str = Field(max_length=40)
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/cases/{case_ref}/coordination", status_code=201)
def open_coordination(
    case_ref: str, body: LinkIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    case = service.get_case(db, case_ref)
    other = service.get_case(db, body.other_case)
    co = coord.open_manual(db, user, case, other, reason=body.reason)
    db.commit()
    return {"coordination": co.code}
