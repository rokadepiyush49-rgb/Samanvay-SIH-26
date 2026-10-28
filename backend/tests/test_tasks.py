"""Case tasks: owner, deadline, status and dependencies; joint actions and coordination messages become tasks."""

import datetime as dt

from sqlalchemy import text

from tests.conftest import new_case

SOON = (dt.date.today() + dt.timedelta(days=10)).isoformat()


def test_tasks_with_a_dependency_and_the_next_step(as_user):
    pgrc = as_user("pgrc_officer")
    case = new_case(
        pgrc, category_code="GRV_EXAM", body="Results for the June examination are withheld by the institute."
    )
    no = case["case_no"]
    first = pgrc.post(f"/cases/{no}/tasks", json={"title": "Ask the institute for the result sheet", "due_on": SOON})
    assert first.status_code == 201, first.text
    t1 = first.json()
    t2 = pgrc.post(
        f"/cases/{no}/tasks", json={"title": "Reply to the complainant", "depends_on": t1["id"], "owner_unit": "PGRC"}
    ).json()
    assert t2["blocked"] and not t2["can_complete"]
    assert pgrc.post(f"/tasks/{t2['id']}/complete", json={}).status_code == 409  # blocked by its dependency
    view = pgrc.get(f"/cases/{no}").json()
    assert view["next_task"]["id"] == t1["id"] and view["can_add_task"]
    done = pgrc.post(f"/tasks/{t1['id']}/complete", json={"note": "Result sheet received"}, headers={"if-match": "1"})
    assert done.status_code == 200 and done.json()["status"] == "DONE"
    assert pgrc.post(f"/tasks/{t2['id']}/complete", json={}).json()["status"] == "DONE"
    types = [e["type"] for e in pgrc.get(f"/cases/{no}").json()["timeline"]]
    assert types.count("TASK_ADDED") == 2 and types.count("TASK_DONE") == 2
    assert as_user("rb_officer").post(f"/cases/{no}/tasks", json={"title": "Not my case"}).status_code == 403
    assert pgrc.post(f"/cases/{no}/tasks", json={"title": "Back-dated", "due_on": "2020-01-01"}).status_code == 422


def test_a_task_owned_by_another_unit_reaches_that_unit(as_user):
    rb, ro = as_user("rb_officer"), as_user("ro_officer")
    case = new_case(rb, category_code="NV_INFRA", body="Hostel and laboratory buildings lack fire safety clearance.")
    t = rb.post(
        f"/cases/{case['case_no']}/tasks",
        json={"title": "Site check of fire safety", "owner_unit": "RO-W", "due_on": SOON},
    ).json()
    inbox = ro.get("/tasks?scope=unit").json()
    mine = next(i for i in inbox["items"] if i["id"] == t["id"])
    assert mine["can_complete"] and not mine["can_cancel"]
    assert ro.post(f"/tasks/{t['id']}/cancel", json={"reason": "Not ours"}).status_code == 403
    assert ro.post(f"/tasks/{t['id']}/complete", json={"note": "Checked 27 Oct"}).json()["status"] == "DONE"


def test_joint_action_with_a_deadline_and_room_messages_become_tasks(as_user, drain):
    rb, pgrc = as_user("rb_officer"), as_user("pgrc_officer")
    body = "Narmada Institute of Management, Bhopal retains original MBA certificates for fee arrears of Rs. 62,000."
    rb_case = new_case(
        rb,
        channel="LETTER",
        category_code="NV_CERT_RETENTION",
        received_on="2026-09-15",
        institution_name="Narmada Institute of Management",
        institution_city="Bhopal",
        body=body,
    )
    no = rb_case["case_no"]
    rb.post(f"/cases/{no}/actions", json={"action": "START_EXAMINATION"})
    g = rb.post(f"/cases/{no}/guard-check", json={"action_type": "EXPERT_COMMITTEE_VISIT"}).json()
    rb.post(
        f"/cases/{no}/actions",
        json={
            "action": "EXPERT_COMMITTEE_VISIT",
            "remarks": "Visit ordered",
            "guard_check_id": g["guard_check_id"],
            "guard_choice": "PROCEED" if g["result"] != "COORDINATION_SUGGESTED" else "PROCEED_AND_NOTIFY",
            "guard_reason": "Committee visit already scheduled",
        },
    )
    pg_case = new_case(
        pgrc,
        category_code="GRV_CERTIFICATE",
        institution_name="Narmada Institute of Management",
        institution_city="Bhopal",
        body="My original MBA certificate is withheld by Narmada Institute of Management for Rs. 62,000 fee arrears.",
    )
    drain()
    code = next(
        c["code"] for c in pgrc.get("/coordination").json()["items"] if no in (c["a"]["case_no"], c["b"]["case_no"])
    )
    msg = pgrc.post(f"/coordination/{code}/messages", json={"body": "PGRC will collect the complainant's fee receipts"})
    made = pgrc.post(f"/coordination/{code}/messages/{msg.json()['id']}/task", json={"due_on": SOON})
    assert made.status_code == 201 and made.json()["source"] == "MESSAGE"
    assert made.json()["case_no"] == pg_case["case_no"]  # lands on the author's own case
    assert as_user("senior").post(f"/coordination/{code}/messages/{msg.json()['id']}/task", json={}).status_code == 403
    rb.post(
        f"/coordination/{code}/decision",
        json={
            "decision": "RELATED",
            "lead_unit": "RB",
            "joint_next_action": "Joint reply to the institute",
            "joint_due": SOON,
        },
    )
    pgrc.post(f"/coordination/{code}/confirm")
    for case_no, api in ((no, rb), (pg_case["case_no"], pgrc)):
        tasks = api.get(f"/cases/{case_no}").json()["tasks"]
        joint = [t for t in tasks if t["source"] == "COORDINATION"]
        assert (
            len(joint) == 1 and joint[0]["title"] == "Joint reply to the institute" and joint[0]["source_ref"] == code
        )


def test_task_timers_fire_once(as_user):
    from app.core.db import worker_session
    from app.modules.sla.timers import fire_due_timers

    pgrc = as_user("pgrc_officer")
    case = new_case(
        pgrc, category_code="GRV_SCHOLARSHIP", body="Scholarship for 2025-26 not credited despite approval."
    )
    t = pgrc.post(f"/cases/{case['case_no']}/tasks", json={"title": "Write to the state portal", "due_on": SOON}).json()
    db = worker_session()
    db.execute(
        text("UPDATE timer SET due_at = now() - interval '1 minute' WHERE payload->>'task_id' = :t"), {"t": t["id"]}
    )
    db.commit()
    assert fire_due_timers(db) >= 2
    db.commit()
    assert fire_due_timers(db) == 0
    db.commit()
    db.close()
    titles = [n["title"] for n in pgrc.get("/me/notifications").json()["items"]]
    assert sum(1 for x in titles if "Write to the state portal" in x and "overdue" in x) == 1
