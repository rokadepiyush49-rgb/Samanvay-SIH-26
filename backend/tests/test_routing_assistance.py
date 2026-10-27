"""Inter-bureau routing (recommendation + jurisdiction check), assistance requests, and the "needs verification"
coordination outcome (ministry note pp. 3–4 and 13–15)."""

from sqlalchemy import text

from tests.conftest import new_case


def test_directory_names_a_primary_unit_for_every_category(as_user):
    from app.reference_data import CATEGORIES

    items = as_user("pgrc_officer").get("/routing/directory").json()["items"]
    primary = {i["category_code"] for i in items if i["role"] == "PRIMARY" and i["code"] != "AB"}
    assert primary | {"NV_INTAKE"} == {c[0] for c in CATEGORIES}  # AB (primary for NV_INTAKE) is not a test unit
    ro_rows = [i for i in items if i["code"] == "RO-W"]
    assert ro_rows and all(i["role"] == "SUPPORT" and i["own_region_only"] for i in ro_rows)


def test_regional_office_infra_case_is_recommended_to_rb_and_transfer_records_jurisdiction(as_user):
    ro = as_user("ro_officer")
    case = new_case(
        ro,
        category_code="NV_INFRA",
        institution_name="Shivaji Institute of Technology",
        institution_city="Kolhapur",
        subject="Laboratories closed",
        body="The civil engineering laboratories of the institute have been closed since July for want of equipment.",
    )
    view = ro.get(f"/cases/{case['case_no']}").json()
    rec = view["routing"]
    assert rec["action"] == "TRANSFER" and rec["unit"] == "RB"
    assert any(r["code"] == "mandate_primary" for r in rec["reasons"])
    assert 0 < rec["confidence"] <= 1 and rec["alternatives"]
    ro.post(f"/cases/{case['case_no']}/actions", json={"action": "START_EXAMINATION"})
    r = ro.post(
        f"/cases/{case['case_no']}/transfers",
        json={"to_unit": "RB", "reason": "RB holds the mandate", "followed_recommendation": True},
    )
    assert r.status_code == 201, r.text
    assert r.json()["jurisdiction"]["mandate"] == "PRIMARY"
    event = next(e for e in ro.get(f"/cases/{case['case_no']}").json()["timeline"] if e["type"] == "TRANSFER_PROPOSED")
    assert event["data"]["followed_recommendation"] is True and event["data"]["jurisdiction"] == "PRIMARY"
    # A unit outside the directory gets an advisory warning, not a refusal.
    other = new_case(ro, category_code="GRV_FEE", body="Refund of Rs. 32,500 pending after withdrawal from MBA.")
    warn = ro.post(f"/cases/{other['case_no']}/transfers", json={"to_unit": "AUD", "reason": "Wrong unit"})
    assert warn.status_code == 201 and warn.json()["jurisdiction"]["warning"]


def test_grievance_held_by_pgrc_stays_with_pgrc(as_user):
    pgrc = as_user("pgrc_officer")
    case = new_case(pgrc, category_code="GRV_SCHOLARSHIP", body="Post-matric scholarship not credited since April.")
    rec = pgrc.get(f"/cases/{case['case_no']}").json()["routing"]
    assert rec["action"] == "KEEP" and rec["unit"] == "PGRC"
    assert as_user("rb_officer").get(f"/cases/{case['case_no']}").json()["routing"] is None  # holder only


def test_assistance_lifecycle_grants_content_access_only_while_open(as_user):
    rb, ro = as_user("rb_officer"), as_user("ro_officer")
    # Bhopal is outside RO-W's region, so RO-W has no regional access to this case of its own.
    case = new_case(
        rb,
        category_code="NV_FACULTY",
        institution_name="Narmada Institute of Management",
        institution_city="Bhopal",
        body="Faculty in the MBA programme are below the prescribed ratio for two years running.",
    )
    no = case["case_no"]
    assert ro.get(f"/cases/{no}").json()["tier"] == "metadata"
    assert (
        rb.post(f"/cases/{no}/assistance", json={"to_unit": "RB", "kind": "OPINION", "request": "x" * 12}).status_code
        == 422
    )
    r = rb.post(
        f"/cases/{no}/assistance",
        json={"to_unit": "RO-W", "kind": "VERIFICATION", "request": "Verify faculty on rolls during your visit."},
    )
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["status"] == "SENT" and req["code"].startswith("A-")
    dup = rb.post(f"/cases/{no}/assistance", json={"to_unit": "RO-W", "kind": "INFORMATION", "request": "Again please"})
    assert dup.status_code == 409
    view = ro.get(f"/cases/{no}").json()
    assert view["tier"] == "full" and view["content"]["body"]
    mine = next(a for a in view["assistance"] if a["id"] == req["id"])
    assert mine["can_respond"] and not mine["can_cancel"]
    assert ro.post(f"/assistance/{req['id']}/cancel", json={"reason": "Not ours to cancel"}).status_code == 403
    inbox = ro.get("/assistance?direction=incoming").json()
    assert any(i["id"] == req["id"] for i in inbox["items"]) and inbox["counts"]["awaiting_ack"] >= 1
    assert ro.post(f"/assistance/{req['id']}/accept", json={}).json()["status"] == "ACCEPTED"
    assert ro.post(f"/assistance/{req['id']}/complete", json={"response": "short"}).status_code == 422
    done = ro.post(
        f"/assistance/{req['id']}/complete",
        json={"response": "Verified on 26-10-2026: 11 of 18 faculty on rolls; report attached to the case."},
    )
    assert done.status_code == 200 and done.json()["status"] == "COMPLETED"
    assert ro.get(f"/cases/{no}").json()["tier"] == "metadata"  # access ends with the request
    after = rb.get(f"/cases/{no}").json()
    assert after["holding_unit"]["code"] == "RB"  # the requester kept the case throughout
    types = [e["type"] for e in after["timeline"]]
    assert {"ASSISTANCE_REQUESTED", "ASSISTANCE_ACCEPTED", "ASSISTANCE_COMPLETED"} <= set(types)
    titles = [n["title"] for n in rb.get("/me/notifications").json()["items"]]
    assert any(req["code"] in t and "completed" in t for t in titles)


def test_decline_returns_with_reason_and_suggestion_and_sealed_cases_are_refused(as_user):
    rb, pgrc = as_user("rb_officer"), as_user("pgrc_officer")
    case = new_case(
        rb, category_code="NV_UNAPPROVED", body="The institute advertises an MCA programme without approval."
    )
    req = rb.post(
        f"/cases/{case['case_no']}/assistance",
        json={"to_unit": "PGRC", "kind": "INFORMATION", "request": "Share any grievances about this institute."},
    ).json()
    assert pgrc.post(f"/assistance/{req['id']}/decline", json={"reason": "no"}).status_code == 422
    r = pgrc.post(
        f"/assistance/{req['id']}/decline",
        json={"reason": "Approval records sit with the Approval Bureau.", "suggested_unit": "MS"},
    )
    assert r.status_code == 200 and r.json()["status"] == "DECLINED" and r.json()["suggested_unit"] == "MS"
    arc = as_user("arc_officer")
    sealed = new_case(arc, category_code="RAGGING", body="Senior students ragged first-year students in the hostel.")
    refused = arc.post(
        f"/cases/{sealed['case_no']}/assistance",
        json={"to_unit": "RB", "kind": "OPINION", "request": "Advise on penal action under the regulations."},
    )
    assert refused.status_code == 403


def test_overdue_assistance_escalates_once(as_user):
    from app.core.db import worker_session
    from app.modules.sla.timers import fire_due_timers

    rb = as_user("rb_officer")
    case = new_case(rb, category_code="NV_FACULTY", body="Faculty shortage reported in the pharmacy department.")
    req = rb.post(
        f"/cases/{case['case_no']}/assistance",
        json={"to_unit": "PGRC", "kind": "INFORMATION", "request": "Any related grievances on file?"},
    ).json()
    db = worker_session()
    db.execute(text("UPDATE timer SET due_at = now() - interval '1 minute' WHERE assistance_id = :a"), {"a": req["id"]})
    db.commit()
    assert fire_due_timers(db) >= 2
    db.commit()
    assert fire_due_timers(db) == 0
    db.commit()
    db.close()
    titles = [n["title"] for n in as_user("pgrc_head").get("/me/notifications").json()["items"]]
    assert sum(1 for t in titles if req["code"] in t and "overdue" in t) == 1


def test_needs_verification_keeps_the_card_undecided(as_user, drain):
    rb, pgrc = as_user("rb_officer"), as_user("pgrc_officer")
    rb_case = new_case(
        rb,
        channel="LETTER",
        category_code="NV_CERT_RETENTION",
        received_on="2026-09-10",
        institution_name="Kaveri College of Pharmacy",
        institution_city="Mysuru",
        body="Kaveri College of Pharmacy, Mysuru retains original D.Pharm certificates for fee arrears of Rs. 55,000.",
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
    new_case(
        pgrc,
        category_code="GRV_CERTIFICATE",
        institution_name="Kaveri College of Pharmacy",
        institution_city="Mysuru",
        body="My original D.Pharm certificate is withheld by Kaveri College of Pharmacy for Rs. 55,000 fee arrears.",
    )
    drain()
    card = next(c for c in pgrc.get("/coordination").json()["items"] if no in (c["a"]["case_no"], c["b"]["case_no"]))
    code = card["code"]
    assert pgrc.post(f"/coordination/{code}/verification", json={"remarks": "check"}).status_code == 422
    too_late = pgrc.post(
        f"/coordination/{code}/verification", json={"remarks": "Confirm the campus first", "verify_by": "2030-01-01"}
    )
    assert too_late.status_code == 422
    r = pgrc.post(f"/coordination/{code}/verification", json={"remarks": "Confirm it is the same batch of students"})
    assert r.status_code == 200 and r.json()["status"] == "VERIFYING"
    detail = rb.get(f"/coordination/{code}").json()
    assert detail["verification"]["by_unit"] == "PGRC" and detail["status"] == "VERIFYING"
    g2 = rb.post(f"/cases/{no}/guard-check", json={"action_type": "SHOW_CAUSE_NOTICE"}).json()
    assert g2["result"] == "COORDINATION_SUGGESTED"  # still undecided for the guard
    proposed = rb.post(f"/coordination/{code}/decision", json={"decision": "RELATED", "lead_unit": "RB"})
    assert proposed.json()["status"] == "AWAITING_CONFIRMATION"
    assert pgrc.post(f"/coordination/{code}/confirm").json()["decision"] == "RELATED"
