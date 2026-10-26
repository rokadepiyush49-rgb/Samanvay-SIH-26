#!/usr/bin/env bash
# Rebuild samanvay_e2e as a copy of the local demo database, so the browser tests can record decisions and transfers
# without touching the data used for demos. pg_dump works while the dev API holds connections to the source.
set -euo pipefail
SRC="${E2E_SOURCE_DB:-samanvay}"
DST="${E2E_DB:-samanvay_e2e}"
if [[ "${APP_ENV:-}" == "production" ]]; then echo "refusing to run with APP_ENV=production" >&2; exit 1; fi
dropdb --if-exists --force "$DST"
createdb -O samanvay_owner "$DST"
pg_dump --no-comments "$SRC" | psql -q -v ON_ERROR_STOP=1 "$DST" >/dev/null
psql -q -d "$DST" -c "GRANT CONNECT ON DATABASE \"$DST\" TO samanvay_app, samanvay_worker" >/dev/null
echo "e2e database $DST ready (copy of $SRC)"
