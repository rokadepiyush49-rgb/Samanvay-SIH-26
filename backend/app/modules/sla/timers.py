"""Firing due timers (worker). Each timer fires exactly once: it is claimed with SKIP LOCKED and its fired_at is set
in the same transaction as the notifications it produces."""

from __future__ import annotations

import datetime as dt
import logging
import smtplib
from email.message import EmailMessage

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AssistanceRequest, CaseRecord, Coordination, Timer, Transfer
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.sla import notify as nt

log = logging.getLogger("samanvay.sla")


def _claim(db: Session, limit: int):
    return (
        db.execute(
            text(
                "SELECT id FROM timer WHERE fired_at IS NULL AND cancelled_at IS NULL AND due_at <= now() "
                "ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT :n"
            ),
            {"n": limit},
        )
        .scalars()
        .all()
    )


def fire_due_timers(db: Session, limit: int = 200) -> int:
    fired = 0
    for timer_id in _claim(db, limit):
        timer = db.get(Timer, timer_id)
        try:
            _fire(db, timer)
        except Exception:
            log.exception("timer %s failed", timer_id)
            raise
        timer.fired_at = dt.datetime.now(dt.UTC)
        fired += 1
    return fired


def _fire(db: Session, t: Timer) -> None:
    if t.kind.startswith("SLA_") or t.kind == "JOINT_DUE":
        case = db.get(CaseRecord, t.case_id)
        if case is None or case.status in fsm.TERMINAL:
            return
        officer = [case.holding_officer_id]
        heads = nt.unit_heads(db, case.holding_unit_id)
        link = nt.case_link(case.case_no)
        due = t.payload.get("due")
        if t.kind == "SLA_REMINDER":
            nt.notify(
                db,
                officer,
                family="SLA",
                severity="WARNING",
                title=f"{case.case_no} is due in {t.payload.get('offset')} "
                f"{'working ' if t.payload.get('basis') == 'WORKING' else ''}days",
                body=f"Expected disposal {due}.",
                link=link,
                case_id=case.id,
                key=f"timer:{t.id}",
            )
        elif t.kind == "SLA_INTERIM":
            nt.notify(
                db,
                officer,
                family="SLA",
                severity="WARNING",
                title=f"Interim reply due for {case.case_no}",
                body=f"Day {t.payload.get('day')} of the CPGRAMS timeline: send an interim reply with reasons "
                f"and a timeline if disposal will take longer (due {due}).",
                link=link,
                case_id=case.id,
                key=f"timer:{t.id}",
            )
        elif t.kind == "SLA_BREACH":
            nt.notify(
                db,
                [*officer, *heads],
                family="SLA",
                severity="CRITICAL",
                title=f"{case.case_no} is overdue",
                body=f"Expected disposal was {due}.",
                link=link,
                case_id=case.id,
                key=f"timer:{t.id}",
            )
        elif t.kind == "SLA_ESCALATION":
            case.escalated = True
            db.execute(
                text(
                    "INSERT INTO case_event (case_id, event_type, remarks, data) VALUES "
                    "(:c, 'ESCALATED', :r, CAST(:d AS jsonb))"
                ),
                {
                    "c": case.id,
                    "r": f"Overdue {t.payload.get('after_days')} days past {due}.",
                    "d": '{"reason": "sla"}',
                },
            )
            nt.notify(
                db,
                [*heads, *nt.users_with_role(db, "NODAL_OFFICER")],
                family="ESCALATION",
                severity="CRITICAL",
                title=f"{case.case_no} escalated: overdue since {due}",
                link=link,
                case_id=case.id,
                key=f"timer:{t.id}",
            )
            chain.record(db, "case.escalated", entity_type="case", entity_id=case.case_no, payload={"reason": "sla"})
        elif t.kind == "JOINT_DUE":
            nt.notify(
                db,
                officer,
                family="COORDINATION",
                severity="WARNING",
                title=f"Joint action due tomorrow for {case.case_no}",
                body=f"Agreed in coordination; due {t.payload.get('joint_due')}.",
                link=link,
                case_id=case.id,
                key=f"timer:{t.id}",
            )
    elif t.kind in ("TRANSFER_REMINDER", "TRANSFER_ESCALATION"):
        tr = db.get(Transfer, t.transfer_id)
        if tr is None or tr.status != "PROPOSED":
            return
        case = db.get(CaseRecord, tr.case_id)
        if t.kind == "TRANSFER_REMINDER":
            nt.notify(
                db,
                nt.unit_officers(db, tr.to_unit_id),
                family="TRANSFER",
                severity="WARNING",
                title=f"Transfer of {case.case_no} still awaits acceptance (2 working days)",
                link=nt.case_link(case.case_no),
                case_id=case.id,
                key=f"timer:{t.id}",
            )
        else:
            nt.notify(
                db,
                [*nt.unit_heads(db, tr.to_unit_id), *nt.unit_heads(db, tr.from_unit_id)],
                family="ESCALATION",
                severity="CRITICAL",
                title=f"Transfer of {case.case_no} not accepted in 5 working days",
                link=nt.case_link(case.case_no),
                case_id=case.id,
                key=f"timer:{t.id}",
            )
    elif t.kind in ("ASSIST_REMINDER", "ASSIST_OVERDUE"):
        req = db.get(AssistanceRequest, t.assistance_id)
        if req is None or req.status not in ("SENT", "ACCEPTED"):
            return
        case = db.get(CaseRecord, req.case_id)
        if case is None or case.status in fsm.TERMINAL:
            return
        if t.kind == "ASSIST_REMINDER":
            if req.status != "SENT":
                return
            nt.notify(
                db,
                nt.unit_officers(db, req.to_unit_id),
                family="ASSISTANCE",
                severity="WARNING",
                title=f"{req.code} on {case.case_no} still awaits acknowledgement (2 working days)",
                link=nt.case_link(case.case_no),
                case_id=case.id,
                key=f"timer:{t.id}",
            )
        else:
            nt.notify(
                db,
                [
                    req.requested_by,
                    req.assignee_id,
                    *nt.unit_heads(db, req.to_unit_id),
                    *nt.unit_heads(db, req.from_unit_id),
                ],
                family="ESCALATION",
                severity="CRITICAL",
                title=f"Assistance {req.code} on {case.case_no} is overdue (due {req.due_on.strftime('%d-%m-%Y')})",
                link=nt.case_link(case.case_no),
                case_id=case.id,
                key=f"timer:{t.id}",
            )
    elif t.kind == "COORD_ESCALATION":
        co = db.get(Coordination, t.coordination_id)
        if co is None or co.status in ("DECIDED", "ESCALATED"):
            return
        from app.modules.coordination.service import escalate

        escalate(db, co, None, "No joint decision within 3 working days.")


def send_pending_emails(db: Session, limit: int = 50) -> int:
    settings = get_settings()
    rows = db.execute(
        text(
            "SELECT n.id, n.title, n.body, n.link, n.email_attempts, u.email FROM notification n "
            "JOIN app_user u ON u.id = n.user_id WHERE n.email_status = 'PENDING' AND n.email_next_at <= now() "
            "ORDER BY n.created_at FOR UPDATE OF n SKIP LOCKED LIMIT :n"
        ),
        {"n": limit},
    ).all()
    if not rows:
        return 0
    if not settings.smtp_host:
        db.execute(
            text("UPDATE notification SET email_status = 'SKIPPED' WHERE id = ANY(:ids)"), {"ids": [r.id for r in rows]}
        )
        return 0
    sent = 0
    try:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
    except OSError as exc:
        log.warning("smtp unavailable: %s", exc)
        _backoff(db, rows)
        return 0
    with smtp:
        for r in rows:
            msg = EmailMessage()
            msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, r.email, f"[Samanvay] {r.title}"
            msg.set_content(
                f"{r.title}\n\n{r.body}\n\nOpen: {settings.public_base_url}{r.link or ''}\n\n"
                "This message contains no complaint text. Sign in to view details."
            )
            try:
                smtp.send_message(msg)
                db.execute(
                    text(
                        "UPDATE notification SET email_status = 'SENT', email_attempts = email_attempts + 1 "
                        "WHERE id = :i"
                    ),
                    {"i": r.id},
                )
                sent += 1
            except smtplib.SMTPException as exc:
                log.warning("email to user failed: %s", exc)
                _backoff(db, [r])
    return sent


def _backoff(db: Session, rows) -> None:
    for r in rows:
        attempts = r.email_attempts + 1
        db.execute(
            text(
                "UPDATE notification SET email_attempts = :a, email_status = CASE WHEN :a >= 5 THEN 'FAILED' "
                "ELSE 'PENDING' END, email_next_at = now() + make_interval(secs => :b) WHERE id = :i"
            ),
            {"a": attempts, "b": min(3600, 30 * 2**attempts), "i": r.id},
        )
