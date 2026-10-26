from sqlalchemy import text

from tests.conftest import new_case


def test_metadata_tier_hides_content_from_other_units(as_user):
    case = new_case(as_user("pgrc_officer"))
    view = as_user("rb_officer").get(f"/cases/{case['case_no']}").json()
    assert view["tier"] == "metadata"
    assert view["content"] is None and view["documents"] is None
    assert view["holding_unit"]["code"] == "PGRC"  # custodian visibility is what the PS asks for
    assert all("remarks" not in e for e in view["timeline"])
    full = as_user("senior").get(f"/cases/{case['case_no']}").json()
    assert full["tier"] == "full" and "withholding" in full["content"]["body"]


def test_sealed_category_is_invisible_without_clearance(as_user):
    arc = as_user("arc_officer")
    case = new_case(
        arc,
        category_code="RAGGING",
        subject="Ragging in hostel",
        body="Junior students are ragged in the hostel since September; the committee did nothing.",
    )
    assert case["sensitivity"] == "SEALED"
    assert as_user("pgrc_officer").get(f"/cases/{case['case_no']}").status_code == 404
    assert as_user("senior").get(f"/cases/{case['case_no']}").status_code == 404  # senior mgmt without clearance
    assert as_user("authority").get(f"/cases/{case['case_no']}").json()["tier"] == "full"
    listed = as_user("rb_head").get("/cases", params={"q": f"id:{case['case_no']}"}).json()
    assert listed["total"] == 0


def test_sealed_intake_requires_clearance(as_user):
    r = as_user("pgrc_intake").post(
        "/cases",
        json={
            "channel": "EMAIL",
            "category_code": "RAGGING",
            "received_on": "2026-10-20",
            "subject": "Ragging",
            "body": "Ragging complaint about hostel seniors at the institute.",
            "institution_name": "Shivaji Institute of Technology",
        },
    )
    assert r.status_code == 403


def test_rls_blocks_content_even_for_a_raw_query(as_user):
    """Defence in depth: with the API role and another unit's identity, SQL alone cannot read the complaint body."""
    from app.core.db import RlsContext, api_session, bind_identity

    case = new_case(as_user("pgrc_officer"))
    db = api_session()
    rb_unit = db.execute(text("SELECT id FROM unit WHERE code = 'RB'")).scalar()
    bind_identity(
        db,
        RlsContext(
            user_id="00000000-0000-0000-0000-000000000009",
            unit_id=str(rb_unit),
            roles=("CASE_OFFICER",),
            clearance=False,
            region_id=None,
        ),
    )
    meta = db.execute(text("SELECT count(*) FROM case_record WHERE case_no = :n"), {"n": case["case_no"]}).scalar()
    body = db.execute(
        text("SELECT count(*) FROM case_content cc JOIN case_record c ON c.id = cc.case_id WHERE c.case_no = :n"),
        {"n": case["case_no"]},
    ).scalar()
    db.rollback()
    db.close()
    assert meta == 1 and body == 0


def test_complainant_identity_is_encrypted_and_reveal_is_audited(as_user):
    api = as_user("pgrc_officer")
    case = new_case(api, complainant_name="Asha Patil")
    from app.core.db import worker_session

    db = worker_session()
    raw = db.execute(
        text(
            "SELECT complainant_name_enc FROM case_content cc JOIN case_record c ON c.id = cc.case_id "
            "WHERE c.case_no = :n"
        ),
        {"n": case["case_no"]},
    ).scalar()
    db.close()
    assert raw and "Asha" not in raw
    assert api.post(f"/cases/{case['case_no']}/complainant", json={"reason": "short"}).status_code == 422
    r = api.post(f"/cases/{case['case_no']}/complainant", json={"reason": "Need to send the interim reply"})
    assert r.status_code == 200 and r.json()["name"] == "Asha Patil"
    audit = (
        as_user("auditor")
        .get("/audit", params={"entity_id": case["case_no"], "action": "case.complainant_revealed"})
        .json()
    )
    assert len(audit["items"]) == 1
    assert (
        as_user("rb_officer")
        .post(f"/cases/{case['case_no']}/complainant", json={"reason": "curious about the name"})
        .status_code
        == 403
    )
