#!/usr/bin/env bash
# DEVELOPMENT ONLY: drop and re-create the local demo database, migrate and seed it. Refuses in production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
if [[ "${APP_ENV:-development}" == "production" ]]; then echo "Refusing to reset a production database." >&2; exit 1; fi
DB="${DB_NAME:-samanvay}"
SU="${PGSUPERUSER:-$USER}"
if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "This deletes all data in database '$DB'. Type the database name to continue: " answer
  [[ "$answer" == "$DB" ]] || { echo "Cancelled."; exit 1; }
fi
psql -v ON_ERROR_STOP=1 -U "$SU" -d postgres -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
rm -rf "$ROOT/var/documents"
"$ROOT/scripts/db_bootstrap.sh"
cd "$ROOT/backend" && uv run python -m app.ml.seed
