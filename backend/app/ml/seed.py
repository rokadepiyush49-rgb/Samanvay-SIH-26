"""Demo seed: units, demo officials for every role, the institution master, ~3,000 synthetic cases loaded through the
same intake path the Register Importer uses, the walkthrough story cases, matching, and sample files to import live.

Run: python -m app.ml.seed      (requires SEED_DEMO_PASSWORD in the environment; refuses if data already exists)
"""

from __future__ import annotations

import csv
import datetime as dt
import os
import random
import sys
import time
import uuid
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import worker_session
from app.core.security import hash_password
from app.ml import synthetic as syn
from app.models import AppUser, CaseRecord, Institution, InstitutionAlias, MappingProfile, Unit
from app.modules.audit import chain
from app.modules.case import service as cs
from app.modules.matching.normalize import normalize_name
from app.modules.policy.roles import CurrentUser

ROOT = Path(__file__).resolve().parents[3]
SAMPLES = ROOT / "samples"
DOMAIN = "samanvay.example"

UNITS = [
    ("RB", "Regulation Bureau", "विनियमन ब्यूरो", "BUREAU", None),
    ("PGRC", "Public Grievance Redressal Cell", "लोक शिकायत निवारण प्रकोष्ठ", "CELL", None),
    ("AB", "Approval Bureau", "अनुमोदन ब्यूरो", "BUREAU", None),
    ("ARC", "Anti-Ragging Cell", "रैगिंग-रोधी प्रकोष्ठ", "CELL", None),
    ("PCB", "Planning and Coordination Bureau", "योजना एवं समन्वय ब्यूरो", "BUREAU", None),
    ("EGOV", "e-Governance Bureau", "ई-गवर्नेंस ब्यूरो", "BUREAU", None),
    ("MS", "Office of the Member Secretary", "सदस्य सचिव कार्यालय", "BUREAU", None),
    ("AUD", "Internal Audit and Vigilance", "आंतरिक लेखा परीक्षा एवं सतर्कता", "CELL", None),
    ("RO-W", "Western Regional Office (Mumbai)", "पश्चिमी क्षेत्रीय कार्यालय", "REGIONAL_OFFICE", 8),
    ("RO-S", "Southern Regional Office (Chennai)", "दक्षिणी क्षेत्रीय कार्यालय", "REGIONAL_OFFICE", 5),
    ("RO-N", "Northern Regional Office (Kanpur)", "उत्तरी क्षेत्रीय कार्यालय", "REGIONAL_OFFICE", 3),
]

# handle, name, designation, unit, roles, sealed clearance
USERS = [
    ("kavita.menon", "Kavita Menon", "Dealing Assistant", "PGRC", ["INTAKE_OFFICER"], False),
    ("arjun.sharma", "Arjun Sharma", "Section Officer", "PGRC", ["CASE_OFFICER", "INTAKE_OFFICER"], False),
    ("lakshmi.nair", "Lakshmi Nair", "Section Officer", "PGRC", ["CASE_OFFICER"], False),
    ("imran.khan", "Imran Khan", "Assistant Section Officer", "PGRC", ["CASE_OFFICER"], False),
    ("sanjay.gupta", "Prof. Sanjay Gupta", "Director, PGRC", "PGRC", ["UNIT_HEAD", "CASE_OFFICER"], False),
    ("neha.iyer", "Dr Neha Iyer", "Deputy Director, RB", "RB", ["UNIT_HEAD", "CASE_OFFICER"], False),
    ("rohit.verma", "Rohit Verma", "Assistant Director, RB", "RB", ["CASE_OFFICER", "INTAKE_OFFICER"], False),
    ("pooja.joshi", "Pooja Joshi", "Section Officer, RB", "RB", ["CASE_OFFICER"], False),
    (
        "harpreet.gill",
        "Harpreet Gill",
        "Deputy Director, Approval Bureau",
        "AB",
        ["UNIT_HEAD", "CASE_OFFICER", "INTAKE_OFFICER"],
        False,
    ),
    ("tanvi.pawar", "Tanvi Pawar", "Assistant Director, Approval Bureau", "AB", ["CASE_OFFICER"], False),
    (
        "mary.thomas",
        "Mary Thomas",
        "Nodal Officer, Anti-Ragging Cell",
        "ARC",
        ["UNIT_HEAD", "CASE_OFFICER", "INTAKE_OFFICER"],
        True,
    ),
    (
        "fernandes",
        "Anthony Fernandes",
        "Assistant Director, Western RO",
        "RO-W",
        ["REGIONAL_OFFICER", "CASE_OFFICER", "INTAKE_OFFICER"],
        False,
    ),
    ("ritika.das", "Ritika Das", "Section Officer, Western RO", "RO-W", ["CASE_OFFICER"], False),
    (
        "venkat.reddy",
        "Venkat Reddy",
        "Assistant Director, Southern RO",
        "RO-S",
        ["REGIONAL_OFFICER", "CASE_OFFICER", "INTAKE_OFFICER"],
        False,
    ),
    (
        "alok.singh",
        "Alok Singh",
        "Assistant Director, Northern RO",
        "RO-N",
        ["REGIONAL_OFFICER", "CASE_OFFICER", "INTAKE_OFFICER"],
        False,
    ),
    ("meera.bora", "Meera Bora", "Coordination Nodal Officer", "PCB", ["NODAL_OFFICER"], False),
    ("dr.rao", "Dr Suresh Rao", "Adviser", "MS", ["SENIOR_MGMT"], False),
    ("member.secretary", "Member Secretary (demo)", "Member Secretary", "MS", ["COMPETENT_AUTHORITY"], True),
    ("zoya.khan", "Zoya Khan", "Joint Director, e-Governance", "EGOV", ["SYS_ADMIN"], False),
    ("deepa.kulkarni", "Deepa Kulkarni", "Data Steward", "EGOV", ["DATA_STEWARD"], False),
    ("auditor", "Internal Auditor (demo)", "Auditor", "AUD", ["AUDITOR"], True),
]

UNIT_INTAKE = {
    "PGRC": "kavita.menon",
    "RB": "rohit.verma",
    "AB": "harpreet.gill",
    "ARC": "mary.thomas",
    "RO-W": "fernandes",
    "RO-S": "venkat.reddy",
    "RO-N": "alok.singh",
}
UNIT_OFFICERS = {
    "PGRC": ["arjun.sharma", "lakshmi.nair", "imran.khan"],
    "RB": ["neha.iyer", "rohit.verma", "pooja.joshi"],
    "AB": ["harpreet.gill", "tanvi.pawar"],
    "ARC": ["mary.thomas"],
    "RO-W": ["fernandes", "ritika.das"],
    "RO-S": ["venkat.reddy"],
    "RO-N": ["alok.singh"],
}

CPGRAMS_PROFILE = {
    "channel": "CPGRAMS",
    "date_format": "%d-%m-%Y",
    "column_map": {
        "source_ref": "Registration Number",
        "received_on": "Received Date",
        "complainant_name": "Name",
        "complainant_phone": "Mobile",
        "body": "Grievance Description",
        "status": "Status",
        "institution_name": "Institution",
        "city": "District",
        "category": "Category",
    },
    "status_map": {
        "Under process": "UNDER_EXAMINATION",
        "Pending": "REGISTERED",
        "Disposed": "DISPOSED",
        "Received": "RECEIVED",
    },
    "category_map": {},
}


def actor(db: Session, handle: str) -> CurrentUser:
    r = db.execute(
        text(
            "SELECT u.id, u.email, u.full_name, u.designation, u.unit_id, u.roles, u.sealed_clearance, "
            "un.code, un.name, un.region_id FROM app_user u JOIN unit un ON un.id = u.unit_id "
            "WHERE u.email = :e"
        ),
        {"e": f"{handle}@{DOMAIN}"},
    ).first()
    return CurrentUser(
        id=r.id,
        email=r.email,
        full_name=r.full_name,
        designation=r.designation,
        unit_id=r.unit_id,
        unit_code=r.code,
        unit_name=r.name,
        region_id=r.region_id,
        roles=frozenset(r.roles),
        sealed_clearance=r.sealed_clearance,
        session_id=uuid.uuid4(),
    )


def seed_people(db: Session, password: str) -> None:
    for code, name, name_hi, utype, region in UNITS:
        db.add(Unit(code=code, name=name, name_hi=name_hi, unit_type=utype, region_id=region))
    db.flush()
    units = {u.code: u.id for u in db.query(Unit).all()}
    pw = hash_password(password)
    for handle, name, desig, unit, roles, cleared in USERS:
        db.add(
            AppUser(
                email=f"{handle}@{DOMAIN}",
                full_name=name,
                designation=desig,
                unit_id=units[unit],
                roles=roles,
                sealed_clearance=cleared,
                password_hash=pw,
                is_demo=True,
            )
        )
    db.flush()


def seed_institutions(db: Session, ds: syn.Dataset) -> dict[str, uuid.UUID]:
    ids = {}
    for i in ds.institutions:
        inst = Institution(
            permanent_id=i.permanent_id,
            name=i.name,
            name_norm=normalize_name(i.name),
            address=i.address,
            city=i.city,
            district=i.district,
            state=i.state,
            pin=i.pin,
            region_id=i.region_id,
            inst_type=i.inst_type,
            approval_status=i.approval_status,
            trust_name=i.trust_name,
        )
        db.add(inst)
        db.flush()
        ids[i.permanent_id] = inst.id
        seen = {inst.name_norm}
        for a in i.aliases:
            n = normalize_name(a)
            if n and n not in seen:
                seen.add(n)
                db.add(InstitutionAlias(institution_id=inst.id, alias=a, alias_norm=n, source="MASTER"))
    db.flush()
    return ids


def _target_status(rng: random.Random, unit: str, category: str, age: int) -> str:
    regulatory = category.startswith(("NV_", "MAL_")) and unit in ("RB", "AB", "RO-W", "RO-S", "RO-N")
    if rng.random() < 0.02:
        return "REJECTED_AT_INTAKE"
    if age < 10:
        return rng.choice(["REGISTERED", "REGISTERED", "UNDER_EXAMINATION"])
    p_disposed = min(0.9, age / (200 if regulatory else 90))
    if rng.random() < p_disposed:
        return "DISPOSED"
    if regulatory:
        return rng.choice(
            [
                "UNDER_EXAMINATION",
                "AWAITING_INFORMATION",
                "ACTION_INITIATED",
                "ACTION_INITIATED",
                "HEARING",
                "DECISION_RECORDED",
            ]
        )
    return rng.choice(["REGISTERED", "UNDER_EXAMINATION", "UNDER_EXAMINATION", "AWAITING_INFORMATION"])


def _set_status(db: Session, case: CaseRecord, status: str, who: CurrentUser, disposed_on: dt.date | None) -> None:
    if case.status == status:
        return
    cs.add_event(
        db,
        case,
        "STATUS_CHANGED",
        who,
        action="IMPORTED",
        from_status=case.status,
        to_status=status,
        remarks="Status carried over from the unit register.",
    )
    case.status = status
    if status in ("DISPOSED", "REJECTED_AT_INTAKE"):
        case.disposed_on = disposed_on
        db.execute(
            text("UPDATE timer SET cancelled_at = now() WHERE case_id = :c AND fired_at IS NULL"), {"c": case.id}
        )


def seed_cases(db: Session, ds: syn.Dataset, inst_ids: dict[str, uuid.UUID]) -> list[tuple[syn.SynComplaint, str]]:
    rng = random.Random(syn.SEED + 7)
    actors = {u: actor(db, h) for u, h in UNIT_INTAKE.items()}
    officers = {u: [actor(db, h).id for h in hs] for u, hs in UNIT_OFFICERS.items()}
    rr = dict.fromkeys(officers, 0)
    created = []
    t0 = time.perf_counter()
    for n, c in enumerate(ds.complaints, 1):
        unit = "ARC" if c.category == "RAGGING" else c.unit
        who = actors[unit]
        offs = officers[unit]
        officer = offs[rr[unit] % len(offs)]
        rr[unit] += 1
        age = (syn.TODAY - c.received_on).days
        status = _target_status(rng, unit, c.category, age)
        city = c.city_text if rng.random() < syn_city_rate() else None
        inp = cs.CaseInput(
            channel=c.channel,
            category_code=c.category,
            received_on=c.received_on,
            subject=c.subject,
            body=c.body,
            institution_name=c.institution_text,
            institution_city=city,
            source_ref=c.source_ref,
            complainant_type=c.complainant_type,
            complainant_name=c.complainant_name,
            complainant_phone=c.complainant_phone,
            holding_officer_id=officer,
        )
        case, _ = cs.create_case(db, who, inp)
        if case.resolution_status != "RESOLVED":
            top3 = [x["permanent_id"] for x in (case.refs or {}).get("institution_candidates", [])[:3]]
            if c.institution_pid in top3 and rng.random() < 0.9:
                cs.confirm_institution(db, who, case, inst_ids[c.institution_pid], None)
        if case.resolution_status == "RESOLVED":
            if case.status == "RECEIVED":
                _set_status(db, case, "REGISTERED", who, None)
            disposed = c.received_on + dt.timedelta(days=rng.randint(5, max(6, min(age, 120))))
            _set_status(db, case, status, who, min(disposed, syn.TODAY))
        created.append((c, case.case_no))
        if n % 250 == 0:
            db.commit()
            print(f"  {n} cases ({time.perf_counter() - t0:.0f} s)", flush=True)
    db.commit()
    return created


def syn_city_rate() -> float:
    from app.ml.benchmark import CITY_PROVIDED

    return CITY_PROVIDED


def seed_story(db: Session, inst_ids: dict[str, uuid.UUID]) -> None:
    for s in syn.STORY_CASES:
        who = actor(db, UNIT_INTAKE[s["unit"]])
        officer = actor(db, s["officer"])
        name, phone = s["complainant"]
        inp = cs.CaseInput(
            channel=s["channel"],
            category_code=s["category"],
            received_on=s["received_on"],
            subject=s["subject"],
            body=s["body"],
            institution_id=inst_ids[s["pid"]],
            source_ref=s.get("source_ref"),
            complainant_name=name,
            complainant_phone=phone,
            complainant_type="PARENT" if "Parents" in name else "STUDENT",
            holding_officer_id=officer.id,
            next_action=s.get("next_action"),
        )
        case, _ = cs.create_case(db, who, inp)
        if s["key"] == "S1":
            _set_status(db, case, "UNDER_EXAMINATION", officer, None)
            cs.add_event(
                db,
                case,
                "ACTION",
                officer,
                action="EXPERT_COMMITTEE_VISIT",
                from_status="UNDER_EXAMINATION",
                to_status="ACTION_INITIATED",
                remarks="Expert committee visited on 24-09-2026 and confirmed the faculty shortage.",
            )
            case.status, case.last_action = "ACTION_INITIATED", "EXPERT_COMMITTEE_VISIT"
        else:
            _set_status(db, case, s["status"], officer, s.get("disposed_on"))
    db.commit()


def finish_history(db: Session) -> None:
    """Historical timers count as already handled; escalation flags reflect cases past their escalation date."""
    db.execute(
        text(
            "UPDATE case_record SET escalated = true WHERE status NOT IN ('DISPOSED', 'REJECTED_AT_INTAKE') "
            "AND id IN (SELECT case_id FROM timer WHERE kind = 'SLA_ESCALATION' AND due_at < now() "
            "AND cancelled_at IS NULL)"
        )
    )
    db.execute(
        text("UPDATE timer SET fired_at = due_at WHERE due_at < now() AND fired_at IS NULL AND cancelled_at IS NULL")
    )
    db.add(
        MappingProfile(
            unit_id=None,
            name="CPGRAMS export (DARPG format)",
            channel="CPGRAMS",
            column_map=CPGRAMS_PROFILE["column_map"],
            status_map=CPGRAMS_PROFILE["status_map"],
            category_map={},
            date_format=CPGRAMS_PROFILE["date_format"],
        )
    )
    db.commit()


def activate_calibrated_model(db: Session) -> None:
    import json

    from app.ml.benchmark import calibrate
    from app.modules.matching.similarity import get_backend

    params = calibrate(syn.SEED + 1, get_backend())
    db.execute(text("UPDATE matching_model SET is_active = false"))
    db.execute(
        text(
            "INSERT INTO matching_model (version, params, notes, is_active) VALUES (:v, CAST(:p AS jsonb), :n, "
            "true) ON CONFLICT (version) DO UPDATE SET params = EXCLUDED.params, is_active = true"
        ),
        {
            "v": "fs-v2-cal",
            "p": json.dumps(params),
            "n": f"Platt-calibrated on synthetic seed {params['fitted_on_seed']} ({params['backend']}). "
            "Re-fit on officers' decisions before relying on it with real data.",
        },
    )
    db.commit()


def write_samples(ds: syn.Dataset, created: list[tuple[syn.SynComplaint, str]]) -> None:
    from openpyxl import Workbook

    SAMPLES.mkdir(exist_ok=True)
    rng = random.Random(syn.SEED + 99)
    by_pid = {i.permanent_id: i for i in ds.institutions}
    wb = Workbook()
    ws = wb.active
    ws.title = "RB Register"
    ws.append(
        [
            "Sl. No.",
            "Diary No.",
            "Date of Receipt",
            "Name of the Institute",
            "Place",
            "Nature of Complaint",
            "Gist of Complaint",
            "Complainant",
            "Mobile No.",
            "Present Status",
            "File No.",
        ]
    )
    natures = {
        "NV_FACULTY": "Faculty shortage",
        "NV_INFRA": "Infrastructure deficiency",
        "NV_CERT_RETENTION": "Retention of original certificates",
        "MAL_FINANCIAL": "Capitation fee",
        "NV_UNAPPROVED": "Unapproved institution",
    }
    statuses = ["Pending", "Under Process", "SCN issued", "Reply awaited", "Disposed of", "Under Process"]
    rows = []
    # Nine rows describe matters PGRC already holds (same institution and facts) so overlaps appear on import.
    pgrc_open = [
        c
        for c, _ in created
        if c.unit == "PGRC"
        and c.category == "GRV_CERTIFICATE"
        and c.language == "en"
        and (syn.TODAY - c.received_on).days < 60
    ][:9]
    for c in pgrc_open:
        inst = by_pid[c.institution_pid]
        gist = (
            f"Students of {inst.name} report that original certificates are retained for fee arrears; "
            f"{c.body.split('.')[0]}."
        )
        rows.append(
            [
                c.received_on + dt.timedelta(days=rng.randint(1, 10)),
                inst.name,
                inst.city,
                natures["NV_CERT_RETENTION"],
                gist,
                "Parents' representation",
                c.complainant_phone,
                "Under Process",
            ]
        )
    while len(rows) < 300:
        inst = rng.choice(ds.institutions[2:])
        cat = rng.choice(list(natures))
        d = syn.TODAY - dt.timedelta(days=rng.randint(1, 400))
        tpl = syn.TEMPLATES[cat][1][0]
        facts = syn._facts(rng, d)
        gist = syn._fill(
            tpl, syn._variant(rng, inst.name, inst.city, rng.choice([0, 1, 2])).split(",")[0], inst.city, facts
        )
        rows.append(
            [
                d,
                syn._variant(rng, inst.name, inst.city, 1).split(",")[0],
                inst.city,
                natures[cat],
                gist,
                f"{rng.choice(syn.FIRST)} {rng.choice(syn.LAST)}",
                f"9{rng.randint(100000000, 999999999)}",
                rng.choice(statuses),
            ]
        )
    for i, r in enumerate(rows, 1):
        d, name, place, nature, gist, who, mobile, status = r
        ws.append(
            [
                i,
                f"RB/{d.year}/{1000 + i}",
                d.strftime("%d.%m.%Y"),
                name,
                place,
                nature,
                gist,
                who,
                mobile,
                status,
                f"F.No. RB/{d.year}/{(i % 40) + 1:03d}-{i}",
            ]
        )
    # Three deliberately bad rows to show the row-level error report.
    ws.append(
        [
            301,
            "RB/2026/9001",
            "31.02.2026",
            "Shivaji College of Engineering",
            "Pune",
            "Faculty shortage",
            "Faculty shortage reported in civil engineering department for two semesters.",
            "Anonymous",
            "",
            "Pending",
            "",
        ]
    )
    ws.append(
        [
            302,
            "RB/2026/9002",
            "12.10.2026",
            "Narmada Institute of Technology",
            "Bhopal",
            "Infrastructure deficiency",
            "Labs closed.",
            "Student",
            "",
            "Pending",
            "",
        ]
    )
    ws.append(
        [
            303,
            "RB/2026/9003",
            "13.10.2026",
            "Kaveri Institute of Management",
            "Mysuru",
            "Capitation fee",
            "Capitation fee of Rs. 3,00,000 demanded for MBA admission without receipt.",
            "Parent",
            "",
            "Sent to Minister",
            "",
        ]
    )
    wb.save(SAMPLES / "rb_register_sample.xlsx")

    with (SAMPLES / "cpgrams_export_sample.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "Registration Number",
                "Received Date",
                "Name",
                "Mobile",
                "Institution",
                "District",
                "Category",
                "Grievance Description",
                "Status",
            ]
        )
        for i in range(40):
            inst = rng.choice(ds.institutions[2:])
            d = syn.TODAY - dt.timedelta(days=rng.randint(1, 30))
            cat = rng.choice(["GRV_FEE", "GRV_CERTIFICATE", "GRV_SCHOLARSHIP"])
            facts = syn._facts(rng, d)
            body = syn._fill(syn.TEMPLATES[cat][1][0], inst.name, inst.city, facts)
            w.writerow(
                [
                    f"AICTE/E/2026/{8800000 + i:07d}",
                    d.strftime("%d-%m-%Y"),
                    f"{rng.choice(syn.FIRST)} {rng.choice(syn.LAST)}",
                    f"9{rng.randint(100000000, 999999999)}",
                    syn._variant(rng, inst.name, inst.city, 1).split(",")[0],
                    inst.city,
                    cat,
                    body,
                    rng.choice(["Pending", "Under process"]),
                ]
            )

    live = syn.STORY_LIVE_CPGRAMS
    (SAMPLES / "story_cpgrams_hindi.txt").write_text(
        "Live demo complaint (blueprint §27, step 1). Enter it as the PGRC intake officer.\n\n"
        f"Channel: {live['channel']}\nCPGRAMS registration number: {live['source_ref']}\n"
        f"Received on: {live['received_on']}\nCategory: {live['category_code']}\n"
        f"Institution (as written): {live['institution_name']}\n\nSubject: {live['subject']}\n\n{live['body']}\n",
        encoding="utf-8",
    )


def main() -> None:
    password = os.environ.get("SEED_DEMO_PASSWORD", "")
    if len(password) < 12:
        sys.exit("Set SEED_DEMO_PASSWORD (12+ characters) in .env before seeding.")
    db = worker_session()
    if db.execute(text("SELECT count(*) FROM unit")).scalar_one():
        sys.exit("The database already has data. Re-create it with scripts/db_reset.sh before seeding again.")
    t0 = time.perf_counter()
    print("Seeding units and demo officials…", flush=True)
    seed_people(db, password)
    ds = syn.build_dataset()
    print(f"Seeding {len(ds.institutions)} institutions…", flush=True)
    ids = seed_institutions(db, ds)
    db.commit()
    print("Seeding story cases…", flush=True)
    seed_story(db, ids)
    print(f"Loading {len(ds.complaints)} synthetic cases through the intake path…", flush=True)
    created = seed_cases(db, ds, ids)
    finish_history(db)
    print("Calibrating the matching model on an independent synthetic draw…", flush=True)
    activate_calibrated_model(db)
    print("Running overlap matching…", flush=True)
    from app.worker import drain

    jobs_done = drain()
    print(f"  {jobs_done} matching jobs", flush=True)
    chain.create_checkpoint(db)
    db.commit()
    write_samples(ds, created)
    stats = db.execute(
        text(
            "SELECT (SELECT count(*) FROM case_record) AS cases, (SELECT count(*) FROM case_link "
            "WHERE link_type <> 'L') AS links, (SELECT count(*) FROM coordination) AS coordinations, "
            "(SELECT count(*) FROM audit_event) AS audit"
        )
    ).first()
    print(
        f"Done in {time.perf_counter() - t0:.0f} s: {stats.cases} cases, {stats.links} overlap proposals, "
        f"{stats.coordinations} coordination cards, {stats.audit} audit entries. Samples in {SAMPLES}."
    )
    db.close()


if __name__ == "__main__":
    main()
