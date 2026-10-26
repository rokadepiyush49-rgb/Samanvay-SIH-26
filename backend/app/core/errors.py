"""RFC 9457 problem-details errors. Messages are written for officials; internals never leave the server."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("samanvay.errors")

PROBLEM = "application/problem+json"


class AppError(Exception):
    def __init__(self, status: int, title: str, detail: str = "", code: str = "error", **extra: Any) -> None:
        super().__init__(detail or title)
        self.status, self.title, self.detail, self.code, self.extra = status, title, detail, code, extra


def not_found(what: str = "Record") -> AppError:
    return AppError(404, f"{what} not found", f"{what} does not exist or you do not have access to it.", "not-found")


def forbidden(detail: str, **extra: Any) -> AppError:
    return AppError(403, "Not permitted", detail, "forbidden", **extra)


def conflict(detail: str, **extra: Any) -> AppError:
    return AppError(409, "Conflict", detail, "conflict", **extra)


def invalid(detail: str, **extra: Any) -> AppError:
    return AppError(422, "Invalid request", detail, "invalid", **extra)


def _problem(status: int, title: str, detail: str, code: str, request: Request, **extra: Any) -> JSONResponse:
    body = {
        "type": f"https://samanvay.example/errors/{code}",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": request.url.path,
        **extra,
    }
    rid = getattr(request.state, "request_id", None)
    if rid:
        body["request_id"] = rid
    return JSONResponse(body, status_code=status, media_type=PROBLEM)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return _problem(exc.status, exc.title, exc.detail, exc.code, request, **exc.extra)

    @app.exception_handler(StaleDataError)
    async def _stale(request: Request, exc: StaleDataError):
        return _problem(
            409,
            "Record changed since you opened it",
            "Someone else saved a change to this record. Reload to see it, then try again.",
            "stale-version",
            request,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        return _problem(exc.status_code, str(exc.detail), str(exc.detail), "http", request)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        fields = [
            {"field": ".".join(str(p) for p in err.get("loc", []) if p != "body"), "message": err.get("msg", "")}
            for err in exc.errors()
        ]
        return _problem(
            422,
            "Some fields need attention",
            "The request did not pass validation.",
            "validation",
            request,
            errors=fields,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error", extra={"path": request.url.path})
        return _problem(
            500,
            "Something went wrong",
            "The server could not complete the request. It has been logged; please try again.",
            "internal",
            request,
        )
