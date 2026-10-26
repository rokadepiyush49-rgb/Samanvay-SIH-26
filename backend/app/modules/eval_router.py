"""Matching benchmark results (blueprint W8). Synthetic data only; labels live outside the database."""

from __future__ import annotations

import json
import threading

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from app.core.errors import AppError
from app.ml import benchmark
from app.modules.auth.deps import current_user
from app.modules.policy.roles import MANAGEMENT_ROLES, CurrentUser, Role

router = APIRouter(prefix="/eval", tags=["evaluation"])
VIEW_ROLES = MANAGEMENT_ROLES | {Role.SYS_ADMIN, Role.AUDITOR, Role.DATA_STEWARD, Role.CASE_OFFICER}
_running = threading.Lock()


@router.get("/overlap")
def results(user: CurrentUser = Depends(current_user)) -> dict:
    user.require(VIEW_ROLES, "view the matching benchmark")
    path = benchmark.OUT_DIR / "results.json"
    if not path.exists():
        return {"available": False}
    alt = benchmark.OUT_DIR / "results_embedding.json"
    return {
        "available": True,
        **json.loads(path.read_text()),
        "embedding": json.loads(alt.read_text()) if alt.exists() else None,
    }


@router.post("/overlap/run")
async def rerun(user: CurrentUser = Depends(current_user)) -> dict:
    user.require({Role.SYS_ADMIN, Role.SENIOR_MGMT}, "re-run the benchmark")
    if not _running.acquire(blocking=False):
        raise AppError(409, "Benchmark already running", "Wait for the current run to finish.", "busy")
    try:
        out = await run_in_threadpool(benchmark.run)
    finally:
        _running.release()
    return {"available": True, **out}
