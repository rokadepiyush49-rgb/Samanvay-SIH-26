"""Samanvay API (FastAPI modular monolith)."""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import api_engine
from app.core.errors import install_error_handlers
from app.core.middleware import configure_logging, install_middleware
from app.modules.admin.router import router as admin_router
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.case.router import router as case_router
from app.modules.coordination.router import router as coordination_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.documents.router import router as documents_router
from app.modules.eval_router import router as eval_router
from app.modules.imports.router import router as imports_router
from app.modules.institution.router import router as institution_router
from app.modules.reports.router import router as reports_router
from app.modules.sla.router import router as sla_router


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.app_env != "test":
        configure_logging()
    app = FastAPI(
        title="Samanvay API",
        version=settings.app_version,
        description="Integrated institution complaint ledger and coordination dashboard for AICTE bureaus and cells.",
        docs_url="/api/docs" if settings.app_env != "production" else None,
        openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
        redoc_url=None,
    )
    install_error_handlers(app)
    install_middleware(app)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH"],
            allow_headers=["content-type", "x-csrf-token", "if-match", "idempotency-key"],
        )

    api = APIRouter(prefix="/api/v1")
    for r in (
        auth_router,
        case_router,
        coordination_router,
        institution_router,
        dashboard_router,
        documents_router,
        reports_router,
        imports_router,
        sla_router,
        admin_router,
        audit_router,
        eval_router,
    ):
        api.include_router(r)
    app.include_router(api)

    @app.get("/health/live", tags=["health"])
    def live() -> dict:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    def ready() -> dict:
        with api_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready", "version": settings.app_version}

    return app


app = create_app()
