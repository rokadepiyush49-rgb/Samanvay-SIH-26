"""Create a local .env with freshly generated secrets (development/demo only). Never overwrites an existing file."""

from __future__ import annotations

import base64
import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / ".env"


def _quote(v: str) -> str:
    return f'"{v}"' if " " in v else v


def main() -> None:
    if TARGET.exists():
        print(f"{TARGET} already exists; leaving it unchanged.")
        return
    from cryptography.fernet import Fernet

    owner, app, worker = (secrets.token_urlsafe(18) for _ in range(3))
    host = os.environ.get("PGHOST_FOR_ENV", "localhost")
    values = {
        "APP_ENV": "development",
        "DEMO_MODE": "true",
        "DATABASE_URL": f"postgresql+psycopg://samanvay_app:{app}@{host}:5432/samanvay",
        "WORKER_DATABASE_URL": f"postgresql+psycopg://samanvay_worker:{worker}@{host}:5432/samanvay",
        "MIGRATION_DATABASE_URL": f"postgresql+psycopg://samanvay_owner:{owner}@{host}:5432/samanvay",
        "DB_OWNER_PASSWORD": owner,
        "DB_APP_PASSWORD": app,
        "DB_WORKER_PASSWORD": worker,
        "JWT_SECRET": secrets.token_urlsafe(48),
        "FIELD_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "HMAC_KEY": secrets.token_urlsafe(48),
        "AUDIT_SIGNING_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
        "SEED_DEMO_PASSWORD": secrets.token_urlsafe(12),
        "STORAGE_PATH": str(ROOT / "var" / "documents"),
        "SCANNER": "builtin",
        "TEXT_BACKEND": "ngram",
        "COOKIE_SECURE": "false",
        "PUBLIC_BASE_URL": "http://localhost:3000",
    }
    TARGET.write_text("".join(f"{k}={_quote(v)}\n" for k, v in values.items()))
    TARGET.chmod(0o600)
    print(f"Wrote {TARGET} (mode 600). Demo password is in SEED_DEMO_PASSWORD.")


if __name__ == "__main__":
    sys.exit(main())
