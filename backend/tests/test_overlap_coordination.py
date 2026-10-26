"""The PS's own scenario: RB has initiated action on an institution while PGRC holds a related grievance."""

import pytest

from tests.conftest import new_case, unique_ref

PHRASE = "Potential Overlapping Cases – Coordination Required"
HINDI = (
    "महोदय, मैंने सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग, नासिक से बी.टेक पूरा किया। संस्थान ₹40,000 शुल्क बकाया "
    "बताकर मेरी मूल डिग्री रोक रहा है। कृपया सहायता करें।"
)


@pytest.fixture
def scenario(as_user, drain):
    rb, pgrc = as_user("rb_officer"), as_user("pgrc_intake")
    rb_case = new_case(
        rb,
        channel="LETTER",
        category_code="NV_CERT_RETENTION",
        received_on="2026-09-02",
        institution_name="Sahyadri Valley Institute of Engineering",
        institution_city="Nashik",
        subject="Certificates retained for fee arrears",
        body="Parents report that Sahyadri Valley Institute of Engineering, Nashik retains original "
        "B.Tech certificates for fee arrears of Rs. 40,000 and lacks faculty.",
    )
    no = rb_case["case_no"]
    rb.post(f"/cases/{no}/actions", json={"action": "START_EXAMINATION"})
    g = rb.post(f"/cases/{no}/guard-check", json={"action_type": "EXPERT_COMMITTEE_VISIT"}).json()
    choice = "PROCEED" if g["result"] != "COORDINATION_SUGGESTED" else "PROCEED_AND_NOTIFY"
    r = rb.post(
        f"/cases/{no}/actions",
        json={
            "action": "EXPERT_COMMITTEE_VISIT",
            "remarks": "Committee visit ordered",
            "guard_check_id": g["guard_check_id"],
            "guard_choice": choice,
            "guard_reason": "Inspection was already scheduled by the committee",
        },
    )
    assert r.status_code == 200, r.text
    pg_case = new_case(
        pgrc,
        channel="CPGRAMS",
        source_ref=unique_ref(),
        received_on="2026-10-14",
        category_code="GRV_CERTIFICATE",
        subject="मूल प्रमाणपत्र रोका गया",
        body=HINDI,
        institution_name="सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग, नासिक",
        institution_city=None,
    )
    drain()
    return rb_case, pg_case


def test_hindi_grievance_resolves_to_the_right_campus(scenario):
    _, pg = scenario
    assert pg["language"] == "hi"
    assert pg["institution"]["permanent_id"] == "1-9990001234"  # Nashik, not the Pune sibling campus


def test_parallel_action_opens_coordination_with_ps_phrase(scenario, as_user):
    rb_case, pg_case = scenario
    view = as_user("pgrc_officer").get(f"/cases/{pg_case['case_no']}").json()
    link = next(lk for lk in view["links"] if lk["other_case"] == rb_case["case_no"])
    assert link["type"] == "P"
    codes = {r["code"] for r in link["reasons"]}
    assert "same_institution" in codes and "text_not_compared" in codes
    assert view["coordination_required"] and view["phrase"] == PHRASE
    notes = as_user("rb_head").get("/me/notifications").json()["items"]
    assert any(PHRASE in n["title"] for n in notes)


def test_two_party_decision_and_follow_up(scenario, as_user):
    rb_case, pg_case = scenario
    rb, pgrc = as_user("rb_officer"), as_user("pgrc_officer")
    card = next(
        c
        for c in rb.get("/coordination").json()["items"]
        if rb_case["case_no"] in (c["a"]["case_no"], c["b"]["case_no"])
    )
    code = card["code"]
    assert pgrc.get(f"/coordination/{code}").json()["a"].get("body") is not None  # participants see both files
    bad = rb.post(f"/coordination/{code}/decision", json={"decision": "NOT_RELATED"})
    assert bad.status_code == 422  # reason required
    r = rb.post(
        f"/coordination/{code}/decision",
        json={
            "decision": "RELATED",
            "lead_unit": "RB",
            "joint_next_action": "Consolidated reply",
            "joint_due": "2026-12-30",
            "remarks": "Same facts",
        },
    )
    assert r.status_code == 200 and r.json()["status"] == "AWAITING_CONFIRMATION"
    assert rb.post(f"/coordination/{code}/confirm").status_code == 403  # proposer's unit cannot confirm
    ok = pgrc.post(f"/coordination/{code}/confirm")
    assert ok.status_code == 200 and ok.json()["decision"] == "RELATED"
    timeline = pgrc.get(f"/cases/{pg_case['case_no']}").json()["timeline"]
    decided = next(e for e in timeline if e["type"] == "COORDINATION_DECIDED")
    assert decided["data"]["lead_unit"] == "RB"


def test_action_conflict_guard(scenario, as_user):
    rb_case, pg_case = scenario
    rb = as_user("rb_officer")
    no = rb_case["case_no"]
    blocked = rb.post(f"/cases/{no}/actions", json={"action": "SHOW_CAUSE_NOTICE", "remarks": "SCN"})
    assert blocked.status_code == 428
    g = rb.post(f"/cases/{no}/guard-check", json={"action_type": "SHOW_CAUSE_NOTICE"}).json()
    assert g["result"] == "COORDINATION_SUGGESTED"
    assert pg_case["case_no"] in [m["case_no"] for m in g["other_matters"]]
    assert set(g["choices"]) == {"OPEN_COORDINATION", "PROCEED_AND_NOTIFY", "CANCEL"}
    no_reason = rb.post(
        f"/cases/{no}/actions",
        json={
            "action": "SHOW_CAUSE_NOTICE",
            "remarks": "SCN",
            "guard_check_id": g["guard_check_id"],
            "guard_choice": "PROCEED_AND_NOTIFY",
        },
    )
    assert no_reason.status_code == 422
    ok = rb.post(
        f"/cases/{no}/actions",
        json={
            "action": "SHOW_CAUSE_NOTICE",
            "remarks": "SCN issued",
            "guard_check_id": g["guard_check_id"],
            "guard_choice": "PROCEED_AND_NOTIFY",
            "guard_reason": "Statutory deadline for the notice expires today",
        },
    )
    assert ok.status_code == 200, ok.text
    reuse = rb.post(
        f"/cases/{no}/actions",
        json={
            "action": "SHOW_CAUSE_NOTICE",
            "remarks": "again",
            "guard_check_id": g["guard_check_id"],
            "guard_choice": "PROCEED",
        },
    )
    assert reuse.status_code == 428  # a guard check is single-use
    notes = as_user("pgrc_head").get("/me/notifications").json()["items"]
    assert any("proceeded" in n["title"] for n in notes)
    assert pg_case["holding_officer"] is not None  # intake-only officers' cases are auto-assigned


def test_guard_open_coordination_choice_does_not_act(scenario, as_user):
    rb_case, _ = scenario
    rb = as_user("rb_officer")
    g = rb.post(f"/cases/{rb_case['case_no']}/guard-check", json={"action_type": "SCHEDULE_HEARING"}).json()
    r = rb.post(f"/guard-checks/{g['guard_check_id']}/choice", json={"choice": "OPEN_COORDINATION"})
    assert r.status_code == 200
    assert rb.get(f"/cases/{rb_case['case_no']}").json()["status"] == "ACTION_INITIATED"


def test_same_complainant_two_channels_is_duplicate(as_user, drain):
    pgrc = as_user("pgrc_officer")
    phone = "9811122233"
    a = new_case(
        pgrc,
        channel="EMAIL",
        category_code="GRV_FEE",
        complainant_phone=phone,
        institution_name="Narmada Institute of Management",
        institution_city="Bhopal",
        body="I withdrew from the MBA on 01/08/2026 and the refund of Rs. 48,000 is pending.",
    )
    b = new_case(
        pgrc,
        channel="CPGRAMS",
        source_ref=unique_ref(),
        category_code="GRV_FEE",
        complainant_phone=phone,
        institution_name="Narmada Inst. of Mgmt",
        institution_city="Bhopal",
        body="Refund of Rs 48,000 after MBA withdrawal on 01/08/2026 not given by the institute.",
    )
    drain()
    links = pgrc.get(f"/cases/{b['case_no']}").json()["links"]
    dup = next(lk for lk in links if lk["other_case"] == a["case_no"])
    assert dup["type"] == "D" and dup["probability"] > 0.9
    assert {"same_complainant", "same_institution"} <= {r["code"] for r in dup["reasons"]}
