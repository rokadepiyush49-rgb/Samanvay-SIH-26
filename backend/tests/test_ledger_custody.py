from tests.conftest import new_case, unique_ref


def test_intake_resolves_institution_and_registers(as_user):
    case = new_case(as_user("pgrc_intake"))
    assert case["case_no"].startswith("SMV-2026-")
    assert case["status"] == "REGISTERED"
    assert case["institution"]["permanent_id"] == "1-1000000001"
    assert case["holding_unit"]["code"] == "PGRC"
    assert case["expected_disposal"] is not None
    assert [e["type"] for e in case["timeline"]][-1] == "RECEIVED"


def test_cpgrams_intake_is_idempotent_on_registration_number(as_user):
    api = as_user("pgrc_intake")
    ref = unique_ref()
    first = new_case(api, channel="CPGRAMS", source_ref=ref)
    r = api.post(
        "/cases",
        json={
            "channel": "CPGRAMS",
            "category_code": "GRV_FEE",
            "received_on": "2026-10-21",
            "subject": "Again",
            "body": "Same grievance submitted twice by mistake, please see.",
            "source_ref": ref,
            "institution_name": "Kaveri College of Pharmacy",
        },
    )
    assert r.status_code == 201 and r.json()["created"] is False
    assert r.json()["case"]["case_no"] == first["case_no"]


def test_cpgrams_policy_21_days_with_interim_prompt(as_user):
    case = new_case(as_user("pgrc_officer"), channel="CPGRAMS", source_ref=unique_ref(), received_on="2026-10-01")
    assert case["expected_disposal"] == "2026-10-22"
    assert case["sla_policy"]["code"] == "CPGRAMS" and case["sla_policy"]["day_basis"] == "CALENDAR"
    kinds = {t["kind"] for t in case["upcoming"]}
    assert "SLA_BREACH" in kinds  # interim (day 15) and reminders already passed for this back-dated case


def test_low_confidence_institution_needs_officer(as_user):
    api = as_user("pgrc_intake")
    case = new_case(api, institution_name="Sahyadri Valley Institute", institution_city=None)
    assert case["status"] == "RECEIVED" and case["resolution_status"] in ("PENDING", "UNRESOLVED")
    cands = {c["city"] for c in case["institution_candidates"]}
    assert {"Nashik", "Pune"} <= cands
    nashik = next(c for c in case["institution_candidates"] if c["city"] == "Nashik")
    r = api.post(f"/cases/{case['case_no']}/institution", json={"institution_id": nashik["institution_id"]})
    assert r.status_code == 200
    reg = api.post(f"/cases/{case['case_no']}/actions", json={"action": "REGISTER"})
    assert reg.status_code == 200 and reg.json()["status"] == "REGISTERED"


def test_illegal_transition_and_remarks_and_stale_version(as_user):
    api = as_user("pgrc_officer")
    case = new_case(api)
    r = api.post(f"/cases/{case['case_no']}/actions", json={"action": "DISPOSE", "remarks": "x"})
    assert r.status_code == 422 and r.json()["type"].endswith("illegal-transition")
    ok = api.post(
        f"/cases/{case['case_no']}/actions",
        json={"action": "START_EXAMINATION"},
        headers={"If-Match": str(case["row_version"])},
    )
    assert ok.status_code == 200
    stale = api.post(
        f"/cases/{case['case_no']}/actions",
        json={"action": "SEEK_INFORMATION", "remarks": "letter"},
        headers={"If-Match": str(case["row_version"])},
    )
    assert stale.status_code == 409
    no_remarks = api.post(f"/cases/{case['case_no']}/actions", json={"action": "RECORD_DECISION"})
    assert no_remarks.status_code in (403, 422)  # case officer may not decide; heads must give remarks


def test_other_unit_cannot_act(as_user):
    case = new_case(as_user("pgrc_officer"))
    r = as_user("rb_officer").post(f"/cases/{case['case_no']}/actions", json={"action": "START_EXAMINATION"})
    assert r.status_code == 403


def test_custody_handshake_transfer_accept(as_user):
    pgrc, rb = as_user("pgrc_officer"), as_user("rb_officer")
    case = new_case(pgrc)
    no = case["case_no"]
    assert rb.get(f"/cases/{no}").json()["tier"] == "metadata"
    r = pgrc.post(f"/cases/{no}/transfers", json={"to_unit": "RB", "reason": "Norm violation; RB has jurisdiction"})
    assert r.status_code == 201
    tid = r.json()["transfer_id"]
    view = rb.get(f"/cases/{no}").json()
    assert view["status"] == "TRANSFER_PROPOSED" and view["holding_unit"]["code"] == "PGRC"
    assert view["tier"] == "full"  # receiving unit reads the file before accepting
    assert pgrc.post(f"/transfers/{tid}/accept", json={}).status_code == 403
    acc = rb.post(f"/transfers/{tid}/accept", json={"remarks": "Accepted"})
    assert acc.status_code == 200 and acc.json()["status"] == "REGISTERED"
    after = rb.get(f"/cases/{no}").json()
    assert after["holding_unit"]["code"] == "RB" and after["holding_officer"]["name"] == "Rb Officer"
    types = [e["type"] for e in after["timeline"]]
    assert "TRANSFER_PROPOSED" in types and "TRANSFER_ACCEPTED" in types
    assert rb.post(f"/transfers/{tid}/accept", json={}).status_code == 409


def test_transfer_return_restores_prior_status(as_user):
    pgrc, rb = as_user("pgrc_officer"), as_user("rb_officer")
    case = new_case(pgrc)
    pgrc.post(f"/cases/{case['case_no']}/actions", json={"action": "START_EXAMINATION"})
    tid = pgrc.post(f"/cases/{case['case_no']}/transfers", json={"to_unit": "RB", "reason": "Check"}).json()[
        "transfer_id"
    ]
    assert rb.post(f"/transfers/{tid}/return", json={}).status_code == 422  # reason required
    r = rb.post(f"/transfers/{tid}/return", json={"remarks": "Grievance belongs to PGRC"})
    assert r.status_code == 200 and r.json()["status"] == "UNDER_EXAMINATION"


def test_search_filters_and_fuzzy_name(as_user):
    api = as_user("pgrc_officer")
    case = new_case(
        api, institution_name="Kaveri College of Pharmacy", institution_city="Mysuru", category_code="GRV_FEE"
    )
    found = api.get("/cases", params={"institution": "Kaveri Coll. Pharm", "category": "GRV_FEE"}).json()
    assert case["case_no"] in [i["case_no"] for i in found["items"]]
    by_id = api.get("/cases", params={"q": f"id:{case['case_no']}"}).json()
    assert by_id["total"] == 1
    by_pid = api.get("/cases", params={"q": "pid:1-1000000002", "unit": "PGRC"}).json()
    assert by_pid["total"] >= 1
