"""Request id, structured access logging, security headers, CSRF double-submit check and rate limiting."""

from __future__ import annotations

import json
import logging
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.security import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, decode_token, new_csrf_token

log = logging.getLogger("samanvay.access")
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("request_id", "method", "path", "status", "ms", "user_id"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)


class SlidingWindowLimiter:
    """In-process limiter (single API instance). Use Redis when running more than one replica."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_s: float = 60.0) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()

LIMITS = {"login": 10, "write": 60, "read": 600, "import": 5}


def _problem(status: int, title: str, detail: str, code: str, rid: str) -> JSONResponse:
    return JSONResponse(
        {
            "type": f"https://samanvay.example/errors/{code}",
            "title": title,
            "status": status,
            "detail": detail,
            "request_id": rid,
        },
        status_code=status,
        media_type="application/problem+json",
    )


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = rid
        started = time.perf_counter()
        path = request.url.path
        is_api = path.startswith("/api/")

        if is_api and request.method in UNSAFE:
            cookie = request.cookies.get(CSRF_COOKIE)
            header = request.headers.get(CSRF_HEADER)
            if not cookie or not header or not secrets.compare_digest(cookie, header):
                return _problem(
                    403,
                    "Security check failed",
                    "The request was missing its security token. Reload the page and try again.",
                    "csrf",
                    rid,
                )

        if is_api and get_settings().app_env != "test":
            token = request.cookies.get(SESSION_COOKIE)
            claims = decode_token(token) if token else None
            who = f"u:{claims['sub']}" if claims else f"ip:{request.client.host if request.client else '?'}"
            if path.endswith("/auth/login") or path.endswith("/auth/demo-login"):
                bucket = "login"
                who = f"ip:{request.client.host if request.client else '?'}"
            elif path.endswith("/imports") and request.method == "POST":
                bucket = "import"
            else:
                bucket = "write" if request.method in UNSAFE else "read"
            if not limiter.allow(f"{bucket}:{who}", LIMITS[bucket], 3600.0 if bucket == "import" else 60.0):
                return _problem(
                    429, "Too many requests", "Please wait a moment before trying again.", "rate-limit", rid
                )

        response = await call_next(request)

        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers.setdefault("Cache-Control", "no-store")
        if is_api:
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if get_settings().cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if is_api and not request.cookies.get(CSRF_COOKIE) and "set-cookie" not in response.headers:
            response.set_cookie(
                CSRF_COOKIE,
                new_csrf_token(),
                httponly=False,
                secure=get_settings().cookie_secure,
                samesite="lax",
                path="/",
            )

        log.info(
            "request",
            extra={
                "request_id": rid,
                "method": request.method,
                "path": path,
                "status": response.status_code,
                "ms": round((time.perf_counter() - started) * 1000, 1),
                "user_id": getattr(request.state, "user_id", None),
            },
        )
        return response


def install_middleware(app: FastAPI) -> None:
    app.add_middleware(SecurityMiddleware)
