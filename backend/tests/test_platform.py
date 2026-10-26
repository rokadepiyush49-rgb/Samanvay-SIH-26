"""Audit chain, dashboards, reports, documents, importer and SLA timers."""

import io
import json

from sqlalchemy import text

from tests.conftest import ROOT, new_case


def test_audit_chain_verifies_and_detects_tampering(as_user):
    new_case(as_user("pgrc_officer"))
    auditor, admin = as_user("auditor"), as_user("admin")
    assert admin.post("/audit/checkpoint").status_code == 200
    ok = auditor.post("/audit/verify").json()
    assert ok["ok"] is True and ok["entries"] > 0 and ok["checkpoints"] >= 1
    import psycopg

    from tests.conftest import ENV

    owner = f"postgresql://samanvay_owner:{ENV['DB_OWNER_PASSWORD']}@localhost:5432/samanvay_test"
    with psycopg.connect(owner, autocommit=True) as conn:
        seq, payload = conn.execute(
            "SELECT seq, payload FROM audit_event WHERE action = 'case.created' ORDER BY seq LIMIT 1"
        ).fetchone()
        tampered = {**payload, "status": "DISPOSED"}
        conn.execute("UPDATE audit_event SET payload = %s WHERE seq = %s", (json.dumps(tampered), seq))
        try:
            bad = auditor.post("/audit/verify").json()
            assert bad["ok"] is False and bad["first_broken_seq"] == seq
        finally:
            conn.execute("UPDATE audit_event SET payload = %s WHERE seq = %s", (json.dumps(payload), seq))
    assert auditor.post("/audit/verify").json()["ok"] is True


def test_cockpit_tiles_equal_drill_down_counts(as_user):
    senior = as_user("senior")
    new_case(as_user("pgrc_officer"))
    summary = senior.get("/dashboard/summary").json()
    for tile in summary["tiles"]:
        params = dict(p.split("=") for p in tile["query"].split("&") if p)
        listed = senior.get("/cases", params={**params, "limit": 1}).json()
        assert listed["total"] == tile["value"], tile["key"]


def test_unit_head_cockpit_is_scoped_to_own_unit(as_user):
    s = as_user("rb_head").get("/dashboard/summary", params={"unit": "PGRC"}).json()
    assert s["scope"]["unit"] == "RB"


def test_report_snapshot_checksum_and_downloads(as_user):
    senior = as_user("senior")
    new_case(as_user("pgrc_officer"))
    r = senior.post("/reports", json={"report_code": "UNIT_STATUS"})
    assert r.status_code == 201
    snap = r.json()
    again = senior.get(f"/reports/{snap['id']}").json()
    assert again["checksum"] == snap["checksum"] and again["checksum_verified"] is True
    for fmt in ("xlsx", "csv", "pdf"):
        d = senior.get(f"/reports/{snap['id']}/download", params={"fmt": fmt})
        assert d.status_code == 200 and d.headers["x-report-checksum"] == snap["checksum"]
    perf = senior.post("/reports", json={"report_code": "PERFORMANCE", "period": "quarter", "anchor": "2026-10-01"})
    assert perf.json()["data"]["period"]["label"] == "Q4 2026"


def test_document_upload_scan_hash_and_tiered_download(as_user):
    pgrc = as_user("pgrc_officer")
    case = new_case(pgrc)
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    r = pgrc.post(f"/cases/{case['case_no']}/documents", files={"file": ("letter.pdf", pdf, "application/pdf")})
    assert r.status_code == 201 and r.json()["scan_status"] == "CLEAN"
    doc = r.json()
    import hashlib

    assert doc["sha256"] == hashlib.sha256(pdf).hexdigest()
    assert pgrc.get(f"/documents/{doc['id']}").content == pdf
    assert as_user("rb_officer").get(f"/documents/{doc['id']}").status_code == 404
    eicar = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    bad = pgrc.post(f"/cases/{case['case_no']}/documents", files={"file": ("x.txt", eicar, "text/plain")})
    assert bad.status_code == 422 and bad.json()["type"].endswith("/malware")
    fake = pgrc.post(f"/cases/{case['case_no']}/documents", files={"file": ("x.pdf", b"MZ\x90\x00", "application/pdf")})
    assert fake.status_code == 415


def test_register_import_with_row_errors_and_idempotent_rerun(as_user, drain):
    api = as_user("rb_officer")
    csv_text = (
        "Diary No.,Date of Receipt,Name of the Institute,Place,Nature of Complaint,Gist of Complaint,Present Status\n"
        "RB/1,02.10.2026,Kaveri College of Pharmacy,Mysuru,Faculty shortage,"
        "Faculty shortage in pharmacy department for two years now,Under Process\n"
        "RB/2,31.02.2026,Shivaji Institute of Technology,Kolhapur,Faculty shortage,"
        "Faculty posts vacant for long,Pending\n"
        "RB/3,05.10.2026,Narmada Institute of Management,Bhopal,Infrastructure deficiency,Labs shut,Pending\n"
    )
    files = {"file": ("register.csv", csv_text.encode(), "text/csv")}
    preview = api.post("/imports/preview", files=files).json()
    assert preview["column_map"]["received_on"] == "Date of Receipt"
    assert preview["column_map"]["institution_name"] == "Name of the Institute"
    assert preview["status_map"]["Under Process"] == "UNDER_EXAMINATION"
    profile = {
        "channel": "REGISTER",
        "column_map": {**preview["column_map"], "source_ref": "Diary No."},
        "status_map": preview["status_map"],
        "category_map": {**preview["category_map"], "Infrastructure deficiency": "NV_INFRA"},
    }
    for expected_created in (1, 0):
        r = api.post(
            "/imports",
            files={"file": ("register.csv", csv_text.encode(), "text/csv")},
            data={"profile": json.dumps(profile)},
        )
        assert r.status_code == 202
        drain()
        job = api.get(f"/imports/{r.json()['id']}").json()
        assert job["status"] == "DONE", job["errors"]
        assert job["created_rows"] == expected_created and job["error_rows"] == 2
        reasons = " ".join(e["error"] for e in job["errors"])
        assert "not a recognised date" in reasons and "shorter than 10" in reasons
    assert job["duplicate_rows"] == 1


def test_timers_fire_once_and_escalate_transfers(as_user):
    from app.core.db import worker_session
    from app.modules.sla.timers import fire_due_timers

    pgrc = as_user("pgrc_officer")
    case = new_case(pgrc)
    pgrc.post(f"/cases/{case['case_no']}/transfers", json={"to_unit": "RB", "reason": "Jurisdiction"})
    db = worker_session()
    db.execute(
        text(
            "UPDATE timer SET due_at = now() - interval '1 minute' WHERE case_id = "
            "(SELECT id FROM case_record WHERE case_no = :n) AND kind LIKE 'TRANSFER_%'"
        ),
        {"n": case["case_no"]},
    )
    db.commit()
    assert fire_due_timers(db) >= 2
    db.commit()
    assert fire_due_timers(db) == 0
    db.commit()
    db.close()
    titles = [n["title"] for n in as_user("rb_head").get("/me/notifications").json()["items"]]
    assert any(case["case_no"] in t and "not accepted" in t for t in titles)


def test_sla_simulator_replays_history(as_user):
    r = as_user("senior").post("/simulations/sla", json={"target_days": 1, "day_basis": "CALENDAR"})
    assert r.status_code == 200
    totals = r.json()["totals"]
    assert totals["breaches_proposed"] >= totals["breaches_current"]


def test_benchmark_results_file_is_served(as_user):
    path = ROOT / "ml" / "benchmark" / "results.json"
    r = as_user("senior").get("/eval/overlap").json()
    assert r["available"] is path.exists()


def test_excel_preview_reads_xlsx(as_user):
    from openpyxl import Workbook

    wb = Workbook()
    wb.active.append(["Registration Number", "Received Date", "Grievance Description", "Category", "Institution"])
    wb.active.append(
        [
            "AICTE/E/2026/0000001",
            "01-10-2026",
            "Fee refund pending for B.Tech withdrawal",
            "GRV_FEE",
            "Kaveri College of Pharmacy",
        ]
    )
    buf = io.BytesIO()
    wb.save(buf)
    p = (
        as_user("pgrc_officer")
        .post("/imports/preview", files={"file": ("cpgrams.xlsx", buf.getvalue(), "application/octet-stream")})
        .json()
    )
    assert p["column_map"]["source_ref"] == "Registration Number" and p["row_count"] == 1
