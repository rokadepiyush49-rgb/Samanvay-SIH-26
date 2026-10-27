"""Case ledger services: intake, actions through the state machine, custody handshake, assignment, projections.

Every state change writes the case row, an append-only case_event and an audit entry in one transaction
(blueprint §20.4). Custody (holding unit + officer) changes only through accept_transfer and assign.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.config import get_settings
from app.core.errors import AppError, conflict, forbidden, invalid, not_found
from app.core.jobs import enqueue
from app.models import CaseContent, CaseEvent, CaseRecord, Category, GuardCheck, Institution, Transfer, Unit
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.coordination import guard
from app.modules.institution.resolver import InstQuery, Resolution, resolve
from app.modules.matching.normalize import detect_language, extract_refs
from app.modules.policy.roles import CASEWORK_ROLES, INTAKE_ROLES, CurrentUser, Role
from app.modules.routing import service as routing
from app.modules.sla import notify as nt
from app.modules.sla import service as sla
from app.modules.sla.calendar import today_ist

CHANNELS = ["CPGRAMS", "EMAIL", "LETTER", "REFERRAL", "REGISTER", "PORTAL", "WALK_IN", "COURT", "PARLIAMENT"]
COMPLAINANT_TYPES = ["STUDENT", "FACULTY", "PARENT", "STAKEHOLDER", "STAFF", "ANONYMOUS", "OTHER"]
GUARD_TTL = dt.timedelta(minutes=15)


@dataclass
class CaseInput:
    channel: str
    category_code: str
    received_on: dt.date
    subject: str
    body: str
    institution_id: uuid.UUID | None = None
    institution_name: str | None = None
    institution_city: str | None = None
    institution_state: str | None = None
    institution_pin: str | None = None
    permanent_id: str | None = None
    source_ref: str | None = None
    unit_file_no: str | None = None
    complainant_type: str | None = None
    complainant_name: str | None = None
    complainant_phone: str | None = None
    complainant_email: str | None = None
    sensitivity: str | None = None
    holding_officer_id: uuid.UUID | None = None
    initial_status: str | None = None  # importer only: canonical status mapped from a unit register
    next_action: str | None = None
    disposed_on: dt.date | None = None  # importer only, for registers that already record disposal
    extra_refs: dict[str, Any] = field(default_factory=dict)


SENSITIVITY_RANK = {"NORMAL": 0, "RESTRICTED": 1, "SEALED": 2}


def next_case_no(db: Session, year: int) -> str:
    n = db.execute(text("SELECT nextval('case_no_seq')")).scalar_one()
    return f"SMV-{year}-{n:06d}"


def add_event(
    db: Session,
    case: CaseRecord,
    event_type: str,
    actor: CurrentUser | None,
    *,
    action: str | None = None,
    from_status: str | None = None,
    to_status: str | None = None,
    from_unit: uuid.UUID | None = None,
    to_unit: uuid.UUID | None = None,
    remarks: str | None = None,
    data: dict[str, Any] | None = None,
) -> CaseEvent:
    ev = CaseEvent(
        case_id=case.id,
        event_type=event_type,
        action=action,
        actor_id=actor.id if actor else None,
        actor_unit_id=actor.unit_id if actor else None,
        from_status=from_status,
        to_status=to_status,
        from_unit_id=from_unit,
        to_unit_id=to_unit,
        remarks=remarks,
        data=data or {},
    )
    db.add(ev)
    db.flush()
    return ev


def _audit(db: Session, actor: CurrentUser | None, action: str, case: CaseRecord, payload: dict[str, Any]) -> int:
    return chain.record(
        db,
        action,
        actor_id=actor.id if actor else None,
        actor_unit_id=actor.unit_id if actor else None,
        entity_type="case",
        entity_id=case.case_no,
        payload=payload,
    )


def _apply_resolution(case: CaseRecord, res: Resolution) -> None:
    case.refs = {**(case.refs or {}), "institution_candidates": res.candidates_payload(), "resolver": res.method}
    if res.status == "RESOLVED" and res.institution:
        case.institution_id = res.institution.id
        case.institution_weight = round(res.probability, 3)
        case.resolution_status = "RESOLVED"
        case.region_id = res.institution.region_id or case.region_id
    else:
        case.resolution_status = res.status


def create_case(
    db: Session,
    actor: CurrentUser,
    data: CaseInput,
    *,
    import_job_id: uuid.UUID | None = None,
    enqueue_match: bool = True,
) -> tuple[CaseRecord, bool]:
    """Create a case in the actor's unit. Idempotent on (channel, source_ref): returns (case, created)."""
    actor.require(INTAKE_ROLES | {Role.COMPETENT_AUTHORITY}, "register cases")
    if data.channel not in CHANNELS:
        raise invalid(f"Unknown channel {data.channel}.")
    category = db.get(Category, data.category_code)
    if category is None or not category.is_active:
        raise invalid(f"Unknown category {data.category_code}.")
    if data.received_on > today_ist() + dt.timedelta(days=1):
        raise invalid("The receipt date cannot be in the future.")

    refs = extract_refs(f"{data.subject}\n{data.body}")
    source_ref = (data.source_ref or "").strip() or None
    if data.channel == "CPGRAMS" and not source_ref and refs["cpgrams"]:
        source_ref = refs["cpgrams"][0]
    if source_ref:
        existing = (
            db.query(CaseRecord).filter(CaseRecord.channel == data.channel, CaseRecord.source_ref == source_ref).first()
        )
        if existing:
            return existing, False

    sensitivity = category.sensitivity
    if data.sensitivity and SENSITIVITY_RANK.get(data.sensitivity, 0) > SENSITIVITY_RANK[sensitivity]:
        sensitivity = data.sensitivity
    if sensitivity == "SEALED" and not (actor.sealed_clearance or actor.has(Role.COMPETENT_AUTHORITY)):
        raise forbidden(
            "This category is sealed. It must be registered by a cleared officer, for example in the Anti-ragging Cell."
        )
    unit = db.get(Unit, actor.unit_id)
    year = data.received_on.year
    case = CaseRecord(
        id=uuid.uuid4(),
        case_no=next_case_no(db, year),
        channel=data.channel,
        source_ref=source_ref,
        unit_file_no=data.unit_file_no,
        category_code=category.code,
        sensitivity=sensitivity,
        status="RECEIVED",
        holding_unit_id=actor.unit_id,
        received_on=data.received_on,
        complainant_type=data.complainant_type,
        complainant_hmac=crypto.complainant_hmac(data.complainant_phone, data.complainant_email),
        language=detect_language(f"{data.subject} {data.body}"),
        import_job_id=import_job_id,
        created_by=actor.id,
        region_id=unit.region_id if unit else None,
        next_action=data.next_action,
        refs={**refs, **data.extra_refs},
    )
    case.cpgrams_no = (source_ref if data.channel == "CPGRAMS" else None) or (
        refs["cpgrams"][0] if refs["cpgrams"] else None
    )
    case.court_case_no = refs["court_cases"][0] if refs["court_cases"] else None
    case.institution_raw = data.institution_name

    if data.institution_id:
        inst = db.get(Institution, data.institution_id)
        if inst is None:
            raise invalid("The selected institution does not exist.")
        case.institution_id, case.institution_weight, case.resolution_status = inst.id, 1.0, "RESOLVED"
        case.region_id = inst.region_id or case.region_id
        case.refs = {**case.refs, "resolver": "officer_confirmed"}
    else:
        pid = data.permanent_id or (refs["permanent_ids"][0] if refs["permanent_ids"] else None)
        res = resolve(
            db,
            InstQuery(
                name=data.institution_name or "",
                city=data.institution_city,
                state=data.institution_state,
                pin=data.institution_pin,
                permanent_id=pid,
            ),
        )
        _apply_resolution(case, res)

    officer = data.holding_officer_id
    if officer is None and actor.has(*CASEWORK_ROLES):
        officer = actor.id
    if officer is None:
        officer = least_loaded_officer(db, actor.unit_id)
    case.holding_officer_id = officer

    db.add(case)
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        if source_ref:
            raise conflict(
                "A case with this source reference already exists in a unit you cannot see. Contact the nodal officer."
            ) from None
        raise
    db.add(
        CaseContent(
            case_id=case.id,
            subject=data.subject.strip(),
            body=data.body.strip(),
            complainant_name_enc=crypto.encrypt(data.complainant_name),
            complainant_contact_enc=crypto.encrypt(
                " / ".join(x for x in (data.complainant_phone, data.complainant_email) if x) or None
            ),
        )
    )
    add_event(
        db,
        case,
        "RECEIVED",
        actor,
        to_status="RECEIVED",
        to_unit=actor.unit_id,
        data={
            "channel": case.channel,
            "source_ref": source_ref,
            "import_job_id": str(import_job_id) if import_job_id else None,
        },
    )
    if case.resolution_status == "RESOLVED":
        add_event(
            db,
            case,
            "INSTITUTION_RESOLVED",
            actor,
            data={
                "institution_id": str(case.institution_id),
                "weight": case.institution_weight,
                "method": case.refs.get("resolver"),
            },
        )

    target = data.initial_status
    if target and target not in fsm.STATUSES:
        raise invalid(f"Unknown status {target}.")
    if case.resolution_status == "RESOLVED" and (target or "REGISTERED") != "RECEIVED":
        new_status = target or "REGISTERED"
        add_event(
            db,
            case,
            "STATUS_CHANGED",
            actor,
            action="REGISTER" if new_status == "REGISTERED" else "IMPORTED",
            from_status="RECEIVED",
            to_status=new_status,
        )
        case.status = new_status
        if new_status == "DISPOSED":
            case.disposed_on = data.disposed_on or case.received_on
    case.last_action, case.last_action_at = "RECEIVED", dt.datetime.now(dt.UTC)

    if case.status not in fsm.TERMINAL:
        policy = sla.assign_sla(db, case, category.group_code)
        add_event(
            db,
            case,
            "SLA_ASSIGNED",
            None,
            data={
                "policy": policy.code,
                "version": policy.version,
                "due": case.expected_disposal.isoformat() if case.expected_disposal else None,
                "approval_status": policy.approval_status,
            },
        )
    db.flush()
    _audit(
        db,
        actor,
        "case.created",
        case,
        {
            "channel": case.channel,
            "status": case.status,
            "unit": str(case.holding_unit_id),
            "import_job_id": str(import_job_id) if import_job_id else None,
        },
    )
    if enqueue_match:
        enqueue(
            db,
            "match_case",
            {"case_id": str(case.id)},
            priority=10 if not import_job_id else 50,
            dedupe_key=f"match:{case.id}",
        )
    return case, True


def least_loaded_officer(db: Session, unit_id: uuid.UUID) -> uuid.UUID | None:
    """Blueprint §14.3: the eligible officer with the fewest open cases (ties broken by name for determinism)."""
    return db.execute(
        text(
            "SELECT u.id FROM app_user u WHERE u.unit_id = :u AND u.is_active AND 'CASE_OFFICER' = ANY(u.roles) "
            "ORDER BY (SELECT count(*) FROM case_record c WHERE c.holding_officer_id = u.id "
            "AND c.status <> ALL(:t)), u.full_name LIMIT 1"
        ),
        {"u": unit_id, "t": list(fsm.TERMINAL)},
    ).scalar()


def get_case(db: Session, case_no_or_id: str, *, for_update: bool = False) -> CaseRecord:
    q = db.query(CaseRecord)
    try:
        q = q.filter(CaseRecord.id == uuid.UUID(case_no_or_id))
    except ValueError:
        q = q.filter(CaseRecord.case_no == case_no_or_id)
    case = q.with_for_update().first() if for_update else q.first()
    if case is None:
        if for_update and q.first() is not None:
            # Row-level security lets this official see the case (metadata) but not lock it for change.
            raise forbidden("Only the unit holding this case, or units coordinating on it, can change it.")
        raise not_found("Case")
    return case


def has_full_access(db: Session, case_id: uuid.UUID) -> bool:
    return bool(db.execute(text("SELECT smv_case_full(:c)"), {"c": case_id}).scalar())


def _check_version(case: CaseRecord, expected: int | None) -> None:
    if expected is not None and expected != case.row_version:
        raise AppError(
            409,
            "Case changed since you opened it",
            "Another officer saved a change to this case. Reload to see it, then try again.",
            "stale-version",
            current_version=case.row_version,
        )


def _require_holder(user: CurrentUser, case: CaseRecord, what: str) -> None:
    if case.holding_unit_id != user.unit_id and not user.has(Role.COMPETENT_AUTHORITY):
        raise forbidden(f"Only the unit holding this case can {what}.")


def allowed_actions(db: Session, user: CurrentUser, case: CaseRecord) -> list[dict[str, Any]]:
    if case.holding_unit_id != user.unit_id and not user.has(Role.COMPETENT_AUTHORITY):
        return []
    out = []
    for (frm, action), rule in sorted(fsm.rules(db).items()):
        if frm == case.status and user.roles & rule.allowed_roles:
            out.append(
                {
                    "action": action,
                    "label": rule.label,
                    "label_hi": rule.label_hi,
                    "to_status": rule.to_status,
                    "requires_remarks": rule.requires_remarks,
                    "consequential": rule.consequential,
                }
            )
    return out


def _consume_guard(
    db: Session,
    user: CurrentUser,
    case: CaseRecord,
    action: str,
    guard_check_id: uuid.UUID | None,
    choice: str | None,
    reason: str | None,
) -> GuardCheck:
    if guard_check_id is None:
        raise AppError(
            428,
            "Conflict check required",
            "This is a consequential action. Run the Action Conflict Guard first.",
            "guard-required",
        )
    gc = db.get(GuardCheck, guard_check_id, with_for_update=True)
    now = dt.datetime.now(dt.UTC)
    if (
        gc is None
        or gc.case_id != case.id
        or gc.action != action
        or gc.actor_id != user.id
        or gc.consumed_at
        or now - gc.at > GUARD_TTL
    ):
        raise AppError(
            428, "Conflict check expired", "Run the Action Conflict Guard again before acting.", "guard-required"
        )
    if choice:
        guard.apply_choice(db, user, gc, choice, reason)
    if gc.choice not in ("PROCEED", "PROCEED_AND_NOTIFY"):
        raise AppError(
            428,
            "Conflict check not cleared",
            "Choose to proceed in the conflict guard before taking this action.",
            "guard-required",
        )
    gc.consumed_at = now
    return gc


def perform_action(
    db: Session,
    user: CurrentUser,
    case: CaseRecord,
    action: str,
    *,
    remarks: str | None,
    expected_version: int | None = None,
    guard_check_id: uuid.UUID | None = None,
    guard_choice: str | None = None,
    guard_reason: str | None = None,
    next_action: str | None = None,
    next_action_due: dt.date | None = None,
    data: dict[str, Any] | None = None,
) -> CaseEvent:
    _check_version(case, expected_version)
    _require_holder(user, case, "act on it")
    rule = fsm.rules(db).get((case.status, action))
    if rule is None:
        raise AppError(
            422,
            "Action not allowed now",
            f"'{action}' is not allowed while the case is {fsm.STATUS_LABELS.get(case.status, case.status)}.",
            "illegal-transition",
            case_status=case.status,
        )
    if not user.roles & rule.allowed_roles:
        raise forbidden(f"Your role cannot '{rule.label}'.", required_roles=sorted(rule.allowed_roles))
    remarks = (remarks or "").strip() or None
    if rule.requires_remarks and not remarks:
        raise invalid("Remarks are required for this action.", field="remarks")
    if action == "REGISTER" and case.resolution_status != "RESOLVED":
        raise invalid("Confirm the institution before registering the case.")
    if action == "REOPEN":
        window = get_settings().reopen_window_days
        if case.disposed_on and (today_ist() - case.disposed_on).days > window:
            raise invalid(
                f"Cases can be reopened within {window} days of disposal. Register a new linked case instead."
            )

    gc = (
        _consume_guard(db, user, case, action, guard_check_id, guard_choice, guard_reason)
        if rule.consequential
        else None
    )

    prev = case.status
    case.status = rule.to_status
    case.last_action, case.last_action_at = action, dt.datetime.now(dt.UTC)
    case.updated_at = case.last_action_at
    if next_action is not None:
        case.next_action, case.next_action_due = next_action or None, next_action_due
    event_data = dict(data or {})
    if gc:
        event_data["guard_check_id"] = str(gc.id)
        event_data["guard_result"] = gc.result
        event_data["guard_choice"] = gc.choice
        event_data["guard_reason"] = gc.reason
    ev = add_event(
        db,
        case,
        "ACTION",
        user,
        action=action,
        from_status=prev,
        to_status=rule.to_status,
        remarks=remarks,
        data=event_data,
    )

    if rule.to_status == "DISPOSED":
        case.disposed_on = today_ist()
        sla.cancel_case_timers(db, case.id)
        _dispose_followers(db, user, case)
    elif rule.to_status == "REJECTED_AT_INTAKE":
        sla.cancel_case_timers(db, case.id)
    elif rule.to_status == "REOPENED":
        case.disposed_on = None
        group = db.get(Category, case.category_code).group_code
        sla.assign_sla(db, case, group, start=today_ist())

    if gc and gc.choice == "PROCEED_AND_NOTIFY":
        _notify_other_units(db, user, case, gc, rule.label)

    _audit(
        db,
        user,
        "case.action",
        case,
        {"action": action, "from": prev, "to": rule.to_status, "guard_check_id": str(gc.id) if gc else None},
    )
    if rule.to_status in fsm.ACTION_STAGE and prev not in fsm.ACTION_STAGE:
        enqueue(db, "match_case", {"case_id": str(case.id)}, priority=10, dedupe_key=f"match:{case.id}")
    db.flush()
    return ev


def _notify_other_units(db: Session, user: CurrentUser, case: CaseRecord, guard: GuardCheck, label: str) -> None:
    for item in guard.found or []:
        unit_id = item.get("unit_id")
        if not unit_id:
            continue
        recipients = [item.get("holding_officer_id"), *nt.unit_heads(db, uuid.UUID(unit_id))]
        nt.notify(
            db,
            recipients,
            family="COORDINATION",
            severity="WARNING",
            title=f"{user.unit_code} proceeded with '{label}' on {case.case_no}",
            body=f"Your case {item.get('case_no')} concerns the same institution. "
            "The officer recorded a reason for proceeding.",
            link=nt.case_link(item.get("case_no", case.case_no)),
            case_id=uuid.UUID(item["case_id"]),
            key=f"guard:{guard.id}:{item.get('case_id')}",
        )


def _dispose_followers(db: Session, user: CurrentUser, lead: CaseRecord) -> None:
    rows = db.execute(
        text(
            """
            SELECT c.id FROM coordination co
            JOIN case_link l ON l.id = co.link_id
            JOIN case_record c ON c.id = CASE WHEN l.left_id = :lead THEN l.right_id ELSE l.left_id END
            WHERE (l.left_id = :lead OR l.right_id = :lead) AND co.status = 'DECIDED' AND co.decision = 'DUPLICATE'
              AND co.lead_unit_id = :unit AND c.status = 'LINKED_FOLLOWS_LEAD'
            """
        ),
        {"lead": lead.id, "unit": lead.holding_unit_id},
    ).all()
    for r in rows:
        follower = db.get(CaseRecord, r.id, with_for_update=True)
        if follower is None:
            continue
        follower.status, follower.disposed_on = "DISPOSED", today_ist()
        follower.last_action, follower.last_action_at = "LEAD_DISPOSED", dt.datetime.now(dt.UTC)
        add_event(
            db,
            follower,
            "ACTION",
            user,
            action="LEAD_DISPOSED",
            from_status="LINKED_FOLLOWS_LEAD",
            to_status="DISPOSED",
            remarks=f"Disposed with lead case {lead.case_no}.",
            data={"lead_case": lead.case_no},
        )
        sla.cancel_case_timers(db, follower.id)
        nt.notify(
            db,
            [follower.holding_officer_id, *nt.unit_heads(db, follower.holding_unit_id)],
            family="COORDINATION",
            title=f"{follower.case_no} disposed with lead case {lead.case_no}",
            link=nt.case_link(follower.case_no),
            case_id=follower.id,
            key=f"follower-disposed:{follower.id}",
        )
        _audit(db, user, "case.follower_disposed", follower, {"lead": lead.case_no})


def record_note(
    db: Session,
    user: CurrentUser,
    case: CaseRecord,
    kind: str,
    remarks: str,
    next_action: str | None = None,
    next_action_due: dt.date | None = None,
) -> CaseEvent:
    """Non-transition entries: internal notes, interim replies and next-action updates."""
    _require_holder(user, case, "add notes")
    user.require(CASEWORK_ROLES | {Role.INTAKE_OFFICER}, "add notes")
    if kind not in ("NOTE", "INTERIM_REPLY_SENT", "NEXT_ACTION"):
        raise invalid("Unknown note type.")
    if not remarks.strip():
        raise invalid("Remarks are required.", field="remarks")
    if kind == "INTERIM_REPLY_SENT":
        sla.cancel_case_timers(db, case.id, ("SLA_INTERIM",))
    if next_action is not None:
        case.next_action, case.next_action_due = next_action or None, next_action_due
    case.updated_at = dt.datetime.now(dt.UTC)
    ev = add_event(
        db,
        case,
        kind,
        user,
        remarks=remarks.strip(),
        data={"next_action": next_action, "next_action_due": next_action_due.isoformat() if next_action_due else None},
    )
    _audit(db, user, f"case.{kind.lower()}", case, {"event_id": ev.id})
    return ev


def confirm_institution(
    db: Session, user: CurrentUser, case: CaseRecord, institution_id: uuid.UUID, expected_version: int | None
) -> None:
    _check_version(case, expected_version)
    _require_holder(user, case, "confirm its institution")
    user.require(INTAKE_ROLES, "confirm institutions")
    inst = db.get(Institution, institution_id)
    if inst is None:
        raise invalid("Unknown institution.")
    previous = str(case.institution_id) if case.institution_id else None
    _learn_alias(db, user, inst, case.institution_raw)
    case.institution_id, case.institution_weight, case.resolution_status = inst.id, 1.0, "RESOLVED"
    case.region_id = inst.region_id or case.region_id
    case.refs = {**(case.refs or {}), "resolver": "officer_confirmed"}
    add_event(
        db,
        case,
        "INSTITUTION_RESOLVED",
        user,
        data={"institution_id": str(inst.id), "previous": previous, "method": "officer_confirmed"},
    )
    _audit(db, user, "case.institution_confirmed", case, {"institution_id": str(inst.id), "previous": previous})
    enqueue(db, "match_case", {"case_id": str(case.id)}, priority=10, dedupe_key=f"match:{case.id}")


def _learn_alias(db: Session, user: CurrentUser, inst: Institution, raw: str | None) -> None:
    """Officer-confirmed name variants become aliases (source LEARNED) that the data steward can review."""
    from app.modules.matching.normalize import normalize_name

    norm = normalize_name(raw or "")
    if not norm or norm == inst.name_norm or len(norm) < 4:
        return
    db.execute(
        text(
            "INSERT INTO institution_alias (institution_id, alias, alias_norm, source, confirmed_by) "
            "VALUES (:i, :a, :n, 'LEARNED', :u) ON CONFLICT (institution_id, alias_norm) DO NOTHING"
        ),
        {"i": inst.id, "a": raw.strip()[:300], "n": norm, "u": user.id},
    )


# --- Custody handshake ---------------------------------------------------------------------------------------------


def propose_transfer(
    db: Session,
    user: CurrentUser,
    case: CaseRecord,
    to_unit_code: str,
    reason: str,
    expected_version: int | None,
    *,
    followed_recommendation: bool = False,
) -> Transfer:
    _check_version(case, expected_version)
    _require_holder(user, case, "transfer it")
    user.require(CASEWORK_ROLES, "transfer cases")
    if case.status not in ("REGISTERED", "UNDER_EXAMINATION"):
        raise AppError(
            422,
            "Transfer not allowed now",
            "Only registered or under-examination cases can be transferred.",
            "illegal-transition",
            case_status=case.status,
        )
    if not reason.strip():
        raise invalid("A reason is required for transfers.", field="reason")
    to_unit = db.query(Unit).filter(Unit.code == to_unit_code, Unit.is_active).first()
    if to_unit is None or to_unit.id == case.holding_unit_id:
        raise invalid("Choose another active unit to transfer to.")
    tr = Transfer(
        case_id=case.id,
        from_unit_id=case.holding_unit_id,
        to_unit_id=to_unit.id,
        proposed_by=user.id,
        reason=reason.strip(),
        prior_status=case.status,
    )
    db.add(tr)
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        raise conflict("A transfer for this case is already awaiting acceptance.") from None
    prev = case.status
    case.prior_status, case.status = prev, "TRANSFER_PROPOSED"
    case.updated_at = dt.datetime.now(dt.UTC)
    add_event(
        db,
        case,
        "TRANSFER_PROPOSED",
        user,
        from_status=prev,
        to_status="TRANSFER_PROPOSED",
        from_unit=case.holding_unit_id,
        to_unit=to_unit.id,
        remarks=reason.strip(),
        data={
            "transfer_id": str(tr.id),
            "to_unit": to_unit.code,
            "jurisdiction": routing.jurisdiction(db, to_unit.id, case)["mandate"],
            "followed_recommendation": followed_recommendation,
        },
    )
    sla.schedule_transfer_timers(db, tr.id, case.id, today_ist())
    nt.notify(
        db,
        nt.unit_officers(db, to_unit.id),
        family="TRANSFER",
        severity="WARNING",
        title=f"Transfer awaiting your acceptance: {case.case_no}",
        body=f"{user.unit_code} proposes to transfer this case to {to_unit.code}.",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"transfer:{tr.id}:proposed",
    )
    _audit(db, user, "case.transfer_proposed", case, {"transfer_id": str(tr.id), "to": to_unit.code})
    return tr


def _open_transfer(db: Session, transfer_id: uuid.UUID) -> tuple[Transfer, CaseRecord]:
    tr = db.get(Transfer, transfer_id, with_for_update=True)
    if tr is None:
        raise not_found("Transfer")
    if tr.status != "PROPOSED":
        raise conflict("This transfer has already been decided.")
    case = db.get(CaseRecord, tr.case_id, with_for_update=True)
    if case is None:
        raise not_found("Case")
    return tr, case


def accept_transfer(
    db: Session, user: CurrentUser, transfer_id: uuid.UUID, officer_id: uuid.UUID | None, remarks: str | None
) -> CaseRecord:
    tr, case = _open_transfer(db, transfer_id)
    if user.unit_id != tr.to_unit_id:
        raise forbidden("Only the receiving unit can accept this transfer.")
    user.require(CASEWORK_ROLES, "accept transfers")
    officer = officer_id or user.id
    _check_officer(db, officer, tr.to_unit_id)
    now = dt.datetime.now(dt.UTC)
    tr.status, tr.decided_by, tr.decided_at, tr.decision_remarks = "ACCEPTED", user.id, now, remarks
    from_unit = case.holding_unit_id
    case.holding_unit_id, case.holding_officer_id, case.holder_since = tr.to_unit_id, officer, now
    case.status, case.prior_status, case.updated_at = "REGISTERED", None, now
    add_event(
        db,
        case,
        "TRANSFER_ACCEPTED",
        user,
        from_status="TRANSFER_PROPOSED",
        to_status="REGISTERED",
        from_unit=from_unit,
        to_unit=tr.to_unit_id,
        remarks=remarks,
        data={
            "transfer_id": str(tr.id),
            "officer_id": str(officer),
            "waited_hours": round((now - tr.proposed_at).total_seconds() / 3600, 1),
        },
    )
    sla.cancel_transfer_timers(db, tr.id)
    nt.notify(
        db,
        [tr.proposed_by, *nt.unit_heads(db, from_unit)],
        family="TRANSFER",
        title=f"{user.unit_code} accepted {case.case_no}",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"transfer:{tr.id}:accepted",
    )
    _audit(db, user, "case.transfer_accepted", case, {"transfer_id": str(tr.id), "officer": str(officer)})
    return case


def return_transfer(db: Session, user: CurrentUser, transfer_id: uuid.UUID, remarks: str) -> CaseRecord:
    tr, case = _open_transfer(db, transfer_id)
    if user.unit_id != tr.to_unit_id:
        raise forbidden("Only the receiving unit can return this transfer.")
    user.require(CASEWORK_ROLES, "return transfers")
    if not (remarks or "").strip():
        raise invalid("A reason is required when returning a transfer.", field="remarks")
    now = dt.datetime.now(dt.UTC)
    tr.status, tr.decided_by, tr.decided_at, tr.decision_remarks = "RETURNED", user.id, now, remarks.strip()
    case.status, case.prior_status, case.updated_at = tr.prior_status, None, now
    add_event(
        db,
        case,
        "TRANSFER_RETURNED",
        user,
        from_status="TRANSFER_PROPOSED",
        to_status=tr.prior_status,
        from_unit=tr.to_unit_id,
        to_unit=tr.from_unit_id,
        remarks=remarks.strip(),
        data={"transfer_id": str(tr.id)},
    )
    sla.cancel_transfer_timers(db, tr.id)
    nt.notify(
        db,
        [tr.proposed_by, case.holding_officer_id],
        family="TRANSFER",
        severity="WARNING",
        title=f"{user.unit_code} returned {case.case_no}",
        body="See the timeline for the reason.",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"transfer:{tr.id}:returned",
    )
    _audit(db, user, "case.transfer_returned", case, {"transfer_id": str(tr.id)})
    return case


def _check_officer(db: Session, officer_id: uuid.UUID, unit_id: uuid.UUID) -> None:
    ok = db.execute(
        text(
            "SELECT 1 FROM app_user WHERE id = :o AND unit_id = :u AND is_active AND "
            "('CASE_OFFICER' = ANY(roles) OR 'UNIT_HEAD' = ANY(roles) OR 'REGIONAL_OFFICER' = ANY(roles))"
        ),
        {"o": officer_id, "u": unit_id},
    ).first()
    if not ok:
        raise invalid("The officer must be an active case officer or head in the holding unit.")


def assign(
    db: Session,
    user: CurrentUser,
    case: CaseRecord,
    officer_id: uuid.UUID,
    remarks: str | None,
    expected_version: int | None,
) -> None:
    _check_version(case, expected_version)
    _require_holder(user, case, "assign it")
    self_assign = officer_id == user.id and case.holding_officer_id is None
    if not (user.has(Role.UNIT_HEAD, Role.COMPETENT_AUTHORITY) or self_assign):
        raise forbidden("Only the unit head can reassign a case.")
    if case.status in fsm.TERMINAL:
        raise invalid("Closed cases cannot be reassigned.")
    _check_officer(db, officer_id, case.holding_unit_id)
    previous = case.holding_officer_id
    case.holding_officer_id, case.holder_since = officer_id, dt.datetime.now(dt.UTC)
    add_event(
        db,
        case,
        "ASSIGNED",
        user,
        remarks=remarks,
        data={"officer_id": str(officer_id), "previous": str(previous) if previous else None},
    )
    nt.notify(
        db,
        [officer_id],
        family="SYSTEM",
        title=f"{case.case_no} assigned to you",
        link=nt.case_link(case.case_no),
        case_id=case.id,
        key=f"assign:{case.id}:{officer_id}:{case.row_version}",
    )
    _audit(db, user, "case.assigned", case, {"officer": str(officer_id)})
