"""Application settings, read from environment variables (and a local .env in development)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_env: Literal["development", "test", "demo", "production"] = "development"
    app_version: str = "0.1.0"

    # Three database roles: the API runs with row-level security enforced, the worker bypasses it
    # (matching must see every case), migrations run as the schema owner.
    database_url: str = "postgresql+psycopg://samanvay_app@localhost:5432/samanvay"
    worker_database_url: str = "postgresql+psycopg://samanvay_worker@localhost:5432/samanvay"
    migration_database_url: str = "postgresql+psycopg://samanvay_owner@localhost:5432/samanvay"

    jwt_secret: SecretStr = Field(default=SecretStr(""))
    session_minutes: int = 30
    cookie_secure: bool = False
    # Fernet key for complainant name/contact columns; HMAC key for complainant matching hashes.
    field_encryption_key: SecretStr = Field(default=SecretStr(""))
    hmac_key: SecretStr = Field(default=SecretStr(""))
    # Base64 Ed25519 private seed (32 bytes) used to sign audit checkpoints. Held outside the database.
    audit_signing_key: SecretStr = Field(default=SecretStr(""))

    # One-click role switching for the stage demo. Refused in production (see validator).
    demo_mode: bool = False

    cors_origins: list[str] = []
    public_base_url: str = "http://localhost:3000"

    storage_backend: Literal["local", "s3"] = "local"
    storage_path: str = "./var/documents"
    s3_endpoint_url: str | None = None
    s3_bucket: str = "samanvay-documents"
    s3_access_key: SecretStr | None = None
    s3_secret_key: SecretStr | None = None
    max_upload_mb: int = 25

    # "builtin" only detects the EICAR test signature and is for development; production must use ClamAV.
    scanner: Literal["clamav", "builtin"] = "builtin"
    clamav_host: str = "localhost"
    clamav_port: int = 3310

    smtp_host: str | None = None
    smtp_port: int = 1025
    smtp_from: str = "samanvay-noreply@localhost"

    text_backend: Literal["ngram", "embedding"] = "ngram"
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    reopen_window_days: int = 90
    login_max_failures: int = 5
    login_lockout_minutes: int = 15

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.app_env == "production":
            problems = []
            if self.demo_mode:
                problems.append("DEMO_MODE must be false in production")
            if not self.cookie_secure:
                problems.append("COOKIE_SECURE must be true in production")
            if self.scanner != "clamav":
                problems.append("SCANNER must be clamav in production")
            for name in ("jwt_secret", "field_encryption_key", "hmac_key", "audit_signing_key"):
                if len(getattr(self, name).get_secret_value()) < 32:
                    problems.append(f"{name.upper()} must be set to a strong value")
            if problems:
                raise ValueError("; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
