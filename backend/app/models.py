"""ORM mappings. The schema itself is owned by the Alembic migrations (raw SQL incl. RLS)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import (
    ARRAY,
    REAL,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    Text,
)
from sqlalchemy.dialects.postgresql import BYTEA, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _now() -> Mapped[dt.datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), default=lambda: dt.datetime.now(dt.UTC))


class Region(Base):
    __tablename__ = "region"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)


class Unit(Base):
    __tablename__ = "unit"
    id: Mapped[uuid.UUID] = _uuid_pk()
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    name_hi: Mapped[str | None] = mapped_column(Text)
    unit_type: Mapped[str] = mapped_column(Text)
    region_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("region.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = _now()


class AppUser(Base):
    __tablename__ = "app_user"
    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(Text)
    designation: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column(Text)
    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    roles: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    sealed_clearance: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()


class UserSession(Base):
    __tablename__ = "user_session"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = _now()
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)


class Institution(Base):
    __tablename__ = "institution"
    id: Mapped[uuid.UUID] = _uuid_pk()
    permanent_id: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    name_norm: Mapped[str] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    district: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(Text)
    pin: Mapped[str | None] = mapped_column(Text)
    region_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("region.id"))
    inst_type: Mapped[str | None] = mapped_column(Text)
    approval_status: Mapped[str] = mapped_column(Text, default="APPROVED")
    trust_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()


class InstitutionAlias(Base):
    __tablename__ = "institution_alias"
    id: Mapped[uuid.UUID] = _uuid_pk()
    institution_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("institution.id"))
    alias: Mapped[str] = mapped_column(Text)
    alias_norm: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, default="MASTER")
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = _now()


class Category(Base):
    __tablename__ = "category"
    code: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    name_hi: Mapped[str | None] = mapped_column(Text)
    group_code: Mapped[str] = mapped_column(Text)
    default_unit_code: Mapped[str | None] = mapped_column(Text)
    sensitivity: Mapped[str] = mapped_column(Text, default="NORMAL")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class TransitionRule(Base):
    __tablename__ = "transition_rule"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_status: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    to_status: Mapped[str] = mapped_column(Text)
    allowed_roles: Mapped[list[str]] = mapped_column(ARRAY(Text))
    requires_remarks: Mapped[bool] = mapped_column(Boolean, default=False)
    consequential: Mapped[bool] = mapped_column(Boolean, default=False)
    label: Mapped[str] = mapped_column(Text)
    label_hi: Mapped[str | None] = mapped_column(Text)


class SlaPolicy(Base):
    __tablename__ = "sla_policy"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(Text)
    channel: Mapped[str | None] = mapped_column(Text)
    category_code: Mapped[str | None] = mapped_column(Text, ForeignKey("category.code"))
    category_group: Mapped[str | None] = mapped_column(Text)
    unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    day_basis: Mapped[str] = mapped_column(Text)
    target_days: Mapped[int] = mapped_column(Integer)
    reminder_offsets: Mapped[list[int]] = mapped_column(ARRAY(Integer))
    interim_reply_day: Mapped[int | None] = mapped_column(Integer)
    escalate_after_days: Mapped[int] = mapped_column(Integer)
    approval_status: Mapped[str] = mapped_column(Text, default="PROPOSED")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = _now()


class CaseRecord(Base):
    __tablename__ = "case_record"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_no: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(Text)
    source_ref: Mapped[str | None] = mapped_column(Text)
    unit_file_no: Mapped[str | None] = mapped_column(Text)
    cpgrams_no: Mapped[str | None] = mapped_column(Text)
    court_case_no: Mapped[str | None] = mapped_column(Text)
    refs: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    institution_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("institution.id"))
    institution_raw: Mapped[str | None] = mapped_column(Text)
    institution_weight: Mapped[float | None] = mapped_column(REAL)
    resolution_status: Mapped[str] = mapped_column(Text, default="PENDING")
    region_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("region.id"))
    category_code: Mapped[str] = mapped_column(Text, ForeignKey("category.code"))
    sensitivity: Mapped[str] = mapped_column(Text, default="NORMAL")
    status: Mapped[str] = mapped_column(Text)
    prior_status: Mapped[str | None] = mapped_column(Text)
    holding_unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    holding_officer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    holder_since: Mapped[dt.datetime] = _now()
    complainant_type: Mapped[str | None] = mapped_column(Text)
    complainant_hmac: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(Text, default="en")
    received_on: Mapped[dt.date] = mapped_column(Date)
    expected_disposal: Mapped[dt.date | None] = mapped_column(Date)
    sla_policy_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sla_policy.id"))
    escalated: Mapped[bool] = mapped_column(Boolean, default=False)
    last_action: Mapped[str | None] = mapped_column(Text)
    last_action_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    next_action: Mapped[str | None] = mapped_column(Text)
    next_action_due: Mapped[dt.date | None] = mapped_column(Date)
    disposed_on: Mapped[dt.date | None] = mapped_column(Date)
    import_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("import_job.id"))
    matched_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()
    row_version: Mapped[int] = mapped_column(Integer, default=1)

    __mapper_args__ = {"version_id_col": row_version}


class CaseContent(Base):
    __tablename__ = "case_content"
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"), primary_key=True)
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    complainant_name_enc: Mapped[str | None] = mapped_column(Text)
    complainant_contact_enc: Mapped[str | None] = mapped_column(Text)


class CaseEvent(Base):
    __tablename__ = "case_event"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    event_type: Mapped[str] = mapped_column(Text)
    action: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    actor_unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    at: Mapped[dt.datetime] = _now()
    from_status: Mapped[str | None] = mapped_column(Text)
    to_status: Mapped[str | None] = mapped_column(Text)
    from_unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    to_unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    remarks: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class Transfer(Base):
    __tablename__ = "transfer"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    from_unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    to_unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    proposed_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    proposed_at: Mapped[dt.datetime] = _now()
    reason: Mapped[str] = mapped_column(Text)
    prior_status: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="PROPOSED")
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    decision_remarks: Mapped[str | None] = mapped_column(Text)


class AccessGrant(Base):
    __tablename__ = "access_grant"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    granted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    reason: Mapped[str] = mapped_column(Text)
    valid_to: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _now()


class Document(Base):
    __tablename__ = "document"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    event_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("case_event.id"))
    filename: Mapped[str] = mapped_column(Text)
    mime: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(Text)
    object_key: Mapped[str] = mapped_column(Text)
    scan_status: Mapped[str] = mapped_column(Text)
    scan_detail: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    uploaded_at: Mapped[dt.datetime] = _now()


class CaseLink(Base):
    __tablename__ = "case_link"
    id: Mapped[uuid.UUID] = _uuid_pk()
    left_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    right_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    link_type: Mapped[str] = mapped_column(Text)
    probability: Mapped[float] = mapped_column(Float)
    score: Mapped[float] = mapped_column(Float)
    reasons: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    hard_keys: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    model_version: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="PROPOSED")
    created_at: Mapped[dt.datetime] = _now()
    updated_at: Mapped[dt.datetime] = _now()


class Coordination(Base):
    __tablename__ = "coordination"
    id: Mapped[uuid.UUID] = _uuid_pk()
    code: Mapped[str] = mapped_column(Text)
    link_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_link.id"))
    status: Mapped[str] = mapped_column(Text, default="OPEN")
    proposal: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    proposed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    proposed_unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    proposed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    decision: Mapped[str | None] = mapped_column(Text)
    lead_unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    joint_next_action: Mapped[str | None] = mapped_column(Text)
    joint_due: Mapped[dt.date | None] = mapped_column(Date)
    remarks: Mapped[str | None] = mapped_column(Text)
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    decide_by: Mapped[dt.date] = mapped_column(Date)
    escalated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    opened_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    verification: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = _now()
    row_version: Mapped[int] = mapped_column(Integer, default=1)

    __mapper_args__ = {"version_id_col": row_version}


class AssistanceRequest(Base):
    __tablename__ = "assistance_request"
    id: Mapped[uuid.UUID] = _uuid_pk()
    code: Mapped[str] = mapped_column(Text)
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    from_unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    to_unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    kind: Mapped[str] = mapped_column(Text)
    request: Mapped[str] = mapped_column(Text)
    due_on: Mapped[dt.date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(Text, default="SENT")
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    requested_at: Mapped[dt.datetime] = _now()
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    responded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    responded_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    response: Mapped[str | None] = mapped_column(Text)
    suggested_unit: Mapped[str | None] = mapped_column(Text)
    followed_recommendation: Mapped[bool] = mapped_column(Boolean, default=False)
    row_version: Mapped[int] = mapped_column(Integer, default=1)

    __mapper_args__ = {"version_id_col": row_version}


class CaseTask(Base):
    __tablename__ = "case_task"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    title: Mapped[str] = mapped_column(Text)
    owner_unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    due_on: Mapped[dt.date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(Text, default="OPEN")
    depends_on: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("case_task.id"))
    source: Mapped[str] = mapped_column(Text, default="MANUAL")
    source_ref: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = _now()
    done_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    done_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    done_note: Mapped[str | None] = mapped_column(Text)
    row_version: Mapped[int] = mapped_column(Integer, default=1)

    __mapper_args__ = {"version_id_col": row_version}


class CaseMessage(Base):
    __tablename__ = "case_message"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    body: Mapped[str] = mapped_column(Text)
    body_sha256: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()


class CoordinationMessage(Base):
    __tablename__ = "coordination_message"
    id: Mapped[uuid.UUID] = _uuid_pk()
    coordination_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coordination.id"))
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()


class GuardCheck(Base):
    __tablename__ = "guard_check"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    action: Mapped[str] = mapped_column(Text)
    result: Mapped[str] = mapped_column(Text)
    found: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    restricted_exists: Mapped[bool] = mapped_column(Boolean, default=False)
    fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    choice: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    at: Mapped[dt.datetime] = _now()
    consumed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Timer(Base):
    __tablename__ = "timer"
    id: Mapped[uuid.UUID] = _uuid_pk()
    kind: Mapped[str] = mapped_column(Text)
    due_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    case_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    transfer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("transfer.id"))
    coordination_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coordination.id"))
    assistance_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("assistance_request.id"))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    dedupe_key: Mapped[str] = mapped_column(Text)
    fired_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _now()


class Notification(Base):
    __tablename__ = "notification"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    family: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(Text, default="INFO")
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str | None] = mapped_column(Text)
    case_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    dedupe_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()
    read_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    email_status: Mapped[str] = mapped_column(Text, default="NONE")
    email_attempts: Mapped[int] = mapped_column(Integer, default=0)
    email_next_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Job(Base):
    __tablename__ = "job"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(Text, default="QUEUED")
    priority: Mapped[int] = mapped_column(Integer, default=100)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    run_after: Mapped[dt.datetime] = _now()
    locked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class ImportJob(Base):
    __tablename__ = "import_job"
    id: Mapped[uuid.UUID] = _uuid_pk()
    unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    filename: Mapped[str] = mapped_column(Text)
    file_sha256: Mapped[str] = mapped_column(Text)
    object_key: Mapped[str] = mapped_column(Text)
    profile: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, default="QUEUED")
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_rows: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_rows: Mapped[int] = mapped_column(Integer, default=0)
    error_rows: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    created_at: Mapped[dt.datetime] = _now()
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class MappingProfile(Base):
    __tablename__ = "mapping_profile"
    id: Mapped[uuid.UUID] = _uuid_pk()
    unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("unit.id"))
    name: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(Text)
    column_map: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status_map: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    category_map: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    date_format: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = _now()


class TextVector(Base):
    __tablename__ = "text_vector"
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"), primary_key=True)
    model: Mapped[str] = mapped_column(Text)
    text_hash: Mapped[str] = mapped_column(Text)
    vector: Mapped[list[float]] = mapped_column(ARRAY(REAL))


class MatchingModel(Base):
    __tablename__ = "matching_model"
    version: Mapped[str] = mapped_column(Text, primary_key=True)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = _now()


class Communication(Base):
    __tablename__ = "communication"
    id: Mapped[uuid.UUID] = _uuid_pk()
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("case_record.id"))
    recipient_type: Mapped[str] = mapped_column(Text)
    template_code: Mapped[str | None] = mapped_column(Text)
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    dispatched_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _now()


class ReportSnapshot(Base):
    __tablename__ = "report_snapshot"
    id: Mapped[uuid.UUID] = _uuid_pk()
    report_code: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    scope: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    cut_off: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    checksum: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = _now()


class AuditEvent(Base):
    __tablename__ = "audit_event"
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actor_unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    prev_hash: Mapped[bytes] = mapped_column(BYTEA)
    hash: Mapped[bytes] = mapped_column(BYTEA)


class AuditCheckpoint(Base):
    __tablename__ = "audit_checkpoint"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_seq: Mapped[int] = mapped_column(BigInteger)
    upto_seq: Mapped[int] = mapped_column(BigInteger)
    merkle_root: Mapped[bytes] = mapped_column(BYTEA)
    chain_head: Mapped[bytes] = mapped_column(BYTEA)
    signature: Mapped[bytes] = mapped_column(BYTEA)
    key_id: Mapped[str] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _now()
