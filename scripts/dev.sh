#!/usr/bin/env bash
# Run API (:8000), worker and web (:3000) natively against a local PostgreSQL. Ctrl-C stops all three.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
trap 'kill 0' EXIT INT TERM
(cd "$ROOT/backend" && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
(cd "$ROOT/backend" && uv run python -m app.worker) &
(cd "$ROOT/frontend" && pnpm dev) &
wait
