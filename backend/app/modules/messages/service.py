"""Secure case-linked messaging (ministry note p. 16): one thread per case for the units that can see its content.

Who reads and writes is the case's full-content rule (smv_case_full, enforced again by row-level security), so access
starts and ends with custody, coordination, assistance or a pending transfer. Messages cannot be edited or deleted;
the audit chain keeps a SHA-256 of every body, and notifications carry the case number and author unit, never the text.
"""

from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import forbidden, invalid
from app.models import CaseMessage, CaseRecord
from app.modules.audit import chain
from app.modules.case import fsm
from app.modules.case.service import has_full_access
from app.modules.policy.roles import COORDINATION_ROLES, INTAKE_ROLES, CurrentUser
from app.modules.sla import notify as nt

WRITE_ROLES = COORDINATION_ROLES | INTAKE_ROLES


def can_post(db: Session, user: CurrentUser, case: CaseRecord) -> bool:
    return user.has(*WRITE_ROLES) and case.status not in fsm.TERMINAL and has_full_access(db, case.id)


def participants(db: Session, case: CaseRecord) -> list[dict]:
    """Units that can read the thread now, and why. Role-wide readers (Competent Authority, senior management,
    auditors, the regional officer of the case's region) are covered by the access policy and not listed."""
    rows = db.execute(
        text(
            """
            SELECT u.code, 'Holds the case' AS why, 0 AS ord FROM unit u WHERE u.id = :holder
            UNION
            SELECT u.code, 'Coordinating on a related case', 1 FROM case_link l
              JOIN coordination co ON co.link_id = l.id
              JOIN case_record o ON o.id = CASE WHEN l.left_id = :c THEN l.right_id ELSE l.left_id END
              JOIN unit u ON u.id = o.holding_unit_id
             WHERE (l.left_id = :c OR l.right_id = :c) AND (co.status <> 'DECIDED' OR co.decision <> 'NOT_RELATED')
               AND o.holding_unit_id <> :holder
            UNION
            SELECT u.code, 'Assisting (request open)', 2 FROM assistance_request a JOIN unit u ON u.id = a.to_unit_id
             WHERE a.case_id = :c AND a.status IN ('SENT', 'ACCEPTED')
            UNION
            SELECT u.code, 'Offered the case (transfer pending)', 3 FROM transfer t JOIN unit u ON u.id = t.to_unit_id
             WHERE t.case_id = :c AND t.status = 'PROPOSED'
            ORDER BY 3, 1
            """
        ),
        {"c": case.id, "holder": case.holding_unit_id},
    ).all()
    seen: dict[str, dict] = {}
    for r in rows:
        seen.setdefault(r.code, {"unit": r.code, "why": r.why})
    return list(seen.values())


def post(db: Session, user: CurrentUser, case: CaseRecord, body: str) -> CaseMessage:
    if not has_full_access(db, case.id):
        raise forbidden("Only units with full access to this case can write in its thread.")
    user.require(WRITE_ROLES, "write case messages")
    if case.status in fsm.TERMINAL:
        raise invalid("This case is closed; its thread is read-only.")
    body = (body or "").strip()
    if not body:
        raise invalid("Message cannot be empty.", field="body")
    if len(body) > 4000:
        raise invalid("Keep a message under 4,000 characters.", field="body")
    digest = hashlib.sha256(body.encode()).hexdigest()
    msg = CaseMessage(
        id=uuid.uuid4(), case_id=case.id, author_id=user.id, unit_id=user.unit_id, body=body, body_sha256=digest
    )
    db.add(msg)
    db.flush()
    earlier = db.execute(
        text("SELECT DISTINCT author_id FROM case_message WHERE case_id = :c AND id <> :m"),
        {"c": case.id, "m": msg.id},
    ).scalars()
    holder = [case.holding_officer_id] if case.holding_officer_id else nt.unit_officers(db, case.holding_unit_id)
    # The other units on the thread: officers holding a coordinating case, and the assisting unit (its assignee, or
    # its officers until someone accepts).
    coordinating = db.execute(
        text(
            "SELECT o.holding_officer_id FROM case_link l JOIN coordination co ON co.link_id = l.id "
            "JOIN case_record o ON o.id = CASE WHEN l.left_id = :c THEN l.right_id ELSE l.left_id END "
            "WHERE (l.left_id = :c OR l.right_id = :c) AND (co.status <> 'DECIDED' OR co.decision <> 'NOT_RELATED')"
        ),
        {"c": case.id},
    ).scalars()
    assisting: list = []
    for a in db.execute(
        text(
            "SELECT assignee_id, to_unit_id FROM assistance_request "
            "WHERE case_id = :c AND status IN ('SENT', 'ACCEPTED')"
        ),
        {"c": case.id},
    ).all():
        assisting += [a.assignee_id] if a.assignee_id else nt.unit_officers(db, a.to_unit_id)
    recipients = {r for r in [*holder, *earlier, *coordinating, *assisting] if r and r != user.id}
    nt.notify(
        db,
        sorted(recipients, key=str),
        family="MESSAGE",
        title=f"New message on {case.case_no} from {user.unit_code}",
        link=nt.case_link(case.case_no) + "?tab=messages",
        case_id=case.id,
        key=f"case-msg:{msg.id}",
    )
    chain.record(
        db,
        "case.message",
        actor_id=user.id,
        actor_unit_id=user.unit_id,
        entity_type="case",
        entity_id=case.case_no,
        payload={"message_id": str(msg.id), "sha256": digest},
    )
    return msg


LIST_SQL = """
SELECT m.id, m.body, m.body_sha256, m.created_at, m.author_id, u.full_name AS author, un.code AS unit
FROM case_message m JOIN app_user u ON u.id = m.author_id JOIN unit un ON un.id = m.unit_id
"""


def payload(r, user: CurrentUser) -> dict:
    return {
        "id": str(r.id),
        "body": r.body,
        "sha256": r.body_sha256,
        "at": r.created_at.isoformat(),
        "author": r.author,
        "unit": r.unit,
        "mine": r.author_id == user.id,
    }


def for_case(db: Session, user: CurrentUser, case_id: uuid.UUID) -> list[dict]:
    rows = db.execute(text(LIST_SQL + " WHERE m.case_id = :c ORDER BY m.created_at, m.id"), {"c": case_id}).all()
    return [payload(r, user) for r in rows]
