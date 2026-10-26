"""Test harness: a fresh `samanvay_test` database built by the real migrations, a small fixture world, and an API
client that signs in through the demo-login path. Tests hit PostgreSQL for real because row-level security and the
SQL itself are part of the behaviour under test."""

from __future__ import annotations

import base64
import os
import secrets
import uuid
from pathlib import Path

import psycopg
import pytest
from cryptography.fernet import Fernet
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
ENV = {**dotenv_values(ROOT / ".env"), **os.environ}
TEST_DB = "samanvay_test"


def _url(kind: str, user: str, password: str) -> str:
    host = ENV.get("TEST_DB_HOST", "localhost")
    return f"postgresql+psycopg://{user}:{password}@{host}:5432/{TEST_DB}"


os.environ.update(
    {
        "APP_ENV": "test",
        "DEMO_MODE": "true",
        "DATABASE_URL": _url("app", "samanvay_app", ENV.get("DB_APP_PASSWORD", "")),
        "WORKER_DATABASE_URL": _url("worker", "samanvay_worker", ENV.get("DB_WORKER_PASSWORD", "")),
        "MIGRATION_DATABASE_URL": _url("owner", "samanvay_owner", ENV.get("DB_OWNER_PASSWORD", "")),
        "JWT_SECRET": secrets.token_urlsafe(48),
        "FIELD_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "HMAC_KEY": secrets.token_urlsafe(32),
        "AUDIT_SIGNING_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
        "STORAGE_PATH": str(ROOT / "var" / "test-documents"),
        "SCANNER": "builtin",
        "TEXT_BACKEND": "ngram",
        "SMTP_HOST": "",
    }
)

PASSWORD = "correct-horse-battery-staple"
UNITS = [
    ("RB", "BUREAU", None),
    ("PGRC", "CELL", None),
    ("ARC", "CELL", None),
    ("RO-W", "REGIONAL_OFFICE", 8),
    ("MS", "BUREAU", None),
    ("PCB", "BUREAU", None),
    ("EGOV", "BUREAU", None),
    ("AUD", "CELL", None),
]
USERS = {
    "pgrc_intake": ("PGRC", ["INTAKE_OFFICER"], False),
    "pgrc_officer": ("PGRC", ["CASE_OFFICER", "INTAKE_OFFICER"], False),
    "pgrc_head": ("PGRC", ["UNIT_HEAD", "CASE_OFFICER"], False),
    "rb_officer": ("RB", ["CASE_OFFICER", "INTAKE_OFFICER"], False),
    "rb_head": ("RB", ["UNIT_HEAD", "CASE_OFFICER"], False),
    "arc_officer": ("ARC", ["CASE_OFFICER", "UNIT_HEAD", "INTAKE_OFFICER"], True),
    "ro_officer": ("RO-W", ["REGIONAL_OFFICER", "CASE_OFFICER", "INTAKE_OFFICER"], False),
    "senior": ("MS", ["SENIOR_MGMT"], False),
    "authority": ("MS", ["COMPETENT_AUTHORITY"], True),
    "nodal": ("PCB", ["NODAL_OFFICER"], False),
    "admin": ("EGOV", ["SYS_ADMIN"], False),
    "steward": ("EGOV", ["DATA_STEWARD"], False),
    "auditor": ("AUD", ["AUDITOR"], True),
}
INSTITUTIONS = [
    ("1-9990001234", "Sahyadri Valley Institute of Engineering", "Nashik", "Maharashtra", "422101", 8, "SV Trust"),
    ("1-9990001235", "Sahyadri Valley Institute of Engineering", "Pune", "Maharashtra", "411041", 8, "SV Trust"),
    ("1-1000000001", "Shivaji Institute of Technology", "Kolhapur", "Maharashtra", "416001", 8, None),
    ("1-1000000002", "Kaveri College of Pharmacy", "Mysuru", "Karnataka", "570001", 7, None),
    ("1-1000000003", "Narmada Institute of Management", "Bhopal", "Madhya Pradesh", "462001", 1, None),
]


def _admin_conn():
    url = (
        ENV.get("TEST_ADMIN_DATABASE_URL")
        or f"postgresql://{os.environ.get('USER', 'postgres')}@localhost:5432/postgres"
    )
    return psycopg.connect(url, autocommit=True)


@pytest.fixture(scope="session", autouse=True)
def database():
    with _admin_conn() as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{TEST_DB}" OWNER samanvay_owner')
        conn.execute(f'GRANT CONNECT ON DATABASE "{TEST_DB}" TO samanvay_app, samanvay_worker')
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(ROOT / "backend" / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "backend" / "migrations"))
    command.upgrade(cfg, "head")
    _seed_world()
    yield


def _seed_world() -> None:
    from app.core.db import worker_session
    from app.core.security import hash_password
    from app.models import AppUser, Institution, InstitutionAlias, Unit
    from app.modules.matching.normalize import normalize_name

    db = worker_session()
    units = {}
    for code, kind, region in UNITS:
        u = Unit(code=code, name=f"{code} unit", unit_type=kind, region_id=region)
        db.add(u)
        db.flush()
        units[code] = u.id
    pw = hash_password(PASSWORD)
    for handle, (unit, roles, cleared) in USERS.items():
        db.add(
            AppUser(
                email=f"{handle}@test.example",
                full_name=handle.replace("_", " ").title(),
                unit_id=units[unit],
                roles=roles,
                sealed_clearance=cleared,
                password_hash=pw,
                is_demo=True,
            )
        )
    for pid, name, city, state, pin, region, trust in INSTITUTIONS:
        inst = Institution(
            permanent_id=pid,
            name=name,
            name_norm=normalize_name(name),
            city=city,
            district=city,
            state=state,
            pin=pin,
            region_id=region,
            trust_name=trust,
        )
        db.add(inst)
        db.flush()
        db.add(
            InstitutionAlias(
                institution_id=inst.id, alias=f"{name}, {city}", alias_norm=normalize_name(f"{name}, {city}")
            )
        )
    db.commit()
    db.close()


class Api:
    """TestClient wrapper that keeps one signed-in official per instance and sends the CSRF header."""

    def __init__(self, client, handle: str | None = None) -> None:
        self.c = client
        self.handle = handle

    def _csrf(self) -> dict:
        if "smv_csrf" not in self.c.cookies:
            self.c.get("/api/v1/auth/csrf")
        return {"x-csrf-token": self.c.cookies.get("smv_csrf")}

    def get(self, path: str, **kw):
        return self.c.get(f"/api/v1{path}", **kw)

    def post(self, path: str, json=None, headers=None, **kw):
        return self.c.post(f"/api/v1{path}", json=json, headers={**self._csrf(), **(headers or {})}, **kw)

    def patch(self, path: str, json=None, **kw):
        return self.c.patch(f"/api/v1{path}", json=json, headers=self._csrf(), **kw)


@pytest.fixture
def as_user():
    from fastapi.testclient import TestClient

    from app.main import app

    def make(handle: str) -> Api:
        client = TestClient(app)
        api = Api(client, handle)
        users = {u["full_name"]: u["id"] for u in api.get("/auth/demo-users").json()}
        r = api.post("/auth/demo-login", json={"user_id": users[handle.replace("_", " ").title()]})
        assert r.status_code == 200, r.text
        return api

    return make


@pytest.fixture
def anon():
    from fastapi.testclient import TestClient

    from app.main import app

    return Api(TestClient(app))


@pytest.fixture
def drain():
    from app.worker import drain as _drain

    return _drain


def unique_ref() -> str:
    return f"AICTE/E/2026/{uuid.uuid4().int % 10_000_000:07d}"


def new_case(api: Api, **overrides) -> dict:
    body = {
        "channel": "EMAIL",
        "category_code": "GRV_CERTIFICATE",
        "received_on": "2026-10-20",
        "subject": "Certificates withheld",
        "institution_name": "Shivaji Institute of Technology",
        "institution_city": "Kolhapur",
        "body": "The institute is withholding my original B.Tech certificates for a fee demand of Rs. 25,000.",
        "complainant_name": "Test Complainant",
        "complainant_phone": f"98{uuid.uuid4().int % 10**8:08d}",
    }
    body.update(overrides)
    r = api.post("/cases", json=body)
    assert r.status_code == 201, r.text
    return r.json()["case"]
