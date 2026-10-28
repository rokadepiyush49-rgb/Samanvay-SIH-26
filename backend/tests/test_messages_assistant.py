"""Case-linked messaging (access follows the case, insert-only, text never in notifications) and the case assistant
(cited summary and answers, scoped to what the officer may see)."""

import hashlib

import pytest
from sqlalchemy import text

from tests.conftest import new_case


def _bhopal_case(rb):
    return new_case(
        rb,
        category_code="NV_FACULTY",
        institution_name="Narmada Institute of Management",
        institution_city="Bhopal",
        body="Faculty in the MBA programme are below the prescribed ratio for two years running.",
    )


def test_thread_follows_case_access_and_keeps_text_out_of_notifications(as_user):
    rb, ro, pgrc = as_user("rb_officer"), as_user("ro_officer"), as_user("pgrc_officer")
    no = _bhopal_case(rb)["case_no"]
    first = rb.post(f"/cases/{no}/messages", json={"body": "Faculty list requested from the institute."})
    assert first.status_code == 201, first.text
    assert first.json()["mine"] and first.json()["unit"] == "RB"
    assert ro.get(f"/cases/{no}/messages").status_code == 403  # metadata tier: no thread
    assert ro.post(f"/cases/{no}/messages", json={"body": "Can I see this?"}).status_code == 403
    assert rb.post(f"/cases/{no}/messages", json={"body": "   "}).status_code == 422

    req = rb.post(
        f"/cases/{no}/assistance",
        json={"to_unit": "RO-W", "kind": "VERIFICATION", "request": "Verify faculty on rolls during your visit."},
    ).json()
    assert any(no in n["title"] for n in ro.get("/me/notifications?family=MESSAGE").json()["items"]) is False
    rb.post(f"/cases/{no}/messages", json={"body": "Please check the attendance register on site."})
    assert any(no in n["title"] for n in ro.get("/me/notifications?family=MESSAGE").json()["items"])  # assisting unit
    thread = ro.get(f"/cases/{no}/messages").json()  # an open assistance request opens the thread
    assert [m["body"] for m in thread["items"]][0] == "Faculty list requested from the institute."
    assert {p["unit"] for p in thread["participants"]} == {"RB", "RO-W"} and thread["can_post"]
    secret = "Visit on 4 Nov confirmed; 7 of 22 faculty absent from the attendance register."
    assert ro.post(f"/cases/{no}/messages", json={"body": secret}).status_code == 201

    notes = rb.get("/me/notifications?family=MESSAGE").json()["items"]
    mine = [n for n in notes if no in n["title"]]
    assert mine and "RO-W" in mine[0]["title"] and secret not in mine[0]["title"] + mine[0]["body"]
    assert pgrc.get(f"/cases/{no}/messages").status_code == 403

    ro.post(f"/assistance/{req['id']}/accept", json={})
    ro.post(f"/assistance/{req['id']}/complete", json={"response": "Verified on site; report attached to the case."})
    assert ro.get(f"/cases/{no}/messages").status_code == 403  # access ends with the request

    trail = as_user("auditor").get(f"/audit?entity_id={no}&action=case.message").json()["items"]
    assert trail[0]["payload"]["sha256"] == hashlib.sha256(secret.encode()).hexdigest()


def test_messages_are_insert_only_for_the_api_role(as_user):
    from app.core.db import RlsContext, api_session, bind_identity

    rb = as_user("rb_officer")
    no = _bhopal_case(rb)["case_no"]
    msg = rb.post(f"/cases/{no}/messages", json={"body": "Original wording"}).json()
    db = api_session()
    unit, uid = db.execute(text("SELECT unit_id, id FROM app_user WHERE email = 'rb_officer@test.example'")).first()
    bind_identity(
        db, RlsContext(user_id=str(uid), unit_id=str(unit), roles=("CASE_OFFICER",), clearance=False, region_id=None)
    )
    with pytest.raises(Exception, match="permission denied"):
        db.execute(text("UPDATE case_message SET body = 'Changed' WHERE id = :i"), {"i": msg["id"]})
    db.rollback()
    db.close()


def test_holding_unit_turns_a_message_into_a_task(as_user):
    rb = as_user("rb_officer")
    no = _bhopal_case(rb)["case_no"]
    msg = rb.post(f"/cases/{no}/messages", json={"body": "Write to the principal for the faculty roster"}).json()
    r = rb.post(f"/cases/{no}/messages/{msg['id']}/task", json={})
    assert r.status_code == 201, r.text
    tasks = rb.get(f"/cases/{no}").json()["tasks"]
    assert any(t["title"] == msg["body"] and t["source"] == "MESSAGE" for t in tasks)


def test_assistant_summary_and_answers_cite_the_case_file(as_user):
    rb = as_user("rb_officer")
    no = _bhopal_case(rb)["case_no"]
    rb.post(f"/cases/{no}/actions", json={"action": "START_EXAMINATION"})
    rb.post(f"/cases/{no}/messages", json={"body": "Principal promised the roster by Friday."})

    s = rb.post(f"/cases/{no}/assistant/summary")
    assert s.status_code == 200, s.text
    out = s.json()
    assert out["mode"] == "offline" and out["headline"] and len(out["points"]) >= 3
    ids = {x["id"] for x in out["sources"]}
    assert "C1" in ids and all(set(p["sources"]) <= ids for p in out["points"])
    assert any("ratio" in x["text"] for x in out["sources"] if x["kind"] == "COMPLAINT")
    assert any("task" in m.lower() for m in out["missing"])  # no open task recorded

    a = rb.post(f"/cases/{no}/assistant/ask", json={"question": "When is this case due?"}).json()
    assert a["found"] and "[C1]" in a["answer"] and "Expected disposal" in a["answer"]
    rule = rb.post(f"/cases/{no}/assistant/ask", json={"question": "How does the conflict guard work?"}).json()
    assert any(x["id"] == "KB6" for x in rule["sources"])
    msg = rb.post(f"/cases/{no}/assistant/ask", json={"question": "What did the principal promise?"}).json()
    assert any(x["kind"] == "MESSAGE" for x in msg["sources"])


def test_assistant_never_sees_more_than_the_officer(as_user):
    rb, pgrc = as_user("rb_officer"), as_user("pgrc_officer")
    no = _bhopal_case(rb)["case_no"]
    rb.post(f"/cases/{no}/messages", json={"body": "Internal: principal is uncooperative."})
    out = pgrc.post(f"/cases/{no}/assistant/summary").json()
    assert out["tier"] == "metadata"
    kinds = {x["kind"] for x in out["sources"]}
    assert not kinds & {"COMPLAINT", "MESSAGE", "DOCUMENT"}
    a = pgrc.post(f"/cases/{no}/assistant/ask", json={"question": "What does the complaint say about faculty ratio?"})
    assert "ratio" not in a.json()["answer"] and "uncooperative" not in a.json()["answer"]
