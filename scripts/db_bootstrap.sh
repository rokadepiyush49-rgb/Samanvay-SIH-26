#!/usr/bin/env bash
# Create the three database roles and the database, then run migrations. Needs a superuser connection
# (PGSUPERUSER, default: the current OS user over the local socket). Safe to re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
DB="${DB_NAME:-samanvay}"
SU="${PGSUPERUSER:-$USER}"
psql_su() { psql -v ON_ERROR_STOP=1 -U "$SU" -d postgres -qtAc "$1"; }

create_role() {
  local name="$1" pass="$2" extra="$3"
  if [[ -z "$(psql_su "SELECT 1 FROM pg_roles WHERE rolname = '$name'")" ]]; then
    psql_su "CREATE ROLE $name LOGIN PASSWORD '$pass' $extra"
  else
    psql_su "ALTER ROLE $name WITH LOGIN PASSWORD '$pass' $extra"
  fi
}
create_role samanvay_owner "$DB_OWNER_PASSWORD" ""
create_role samanvay_app "$DB_APP_PASSWORD" "NOBYPASSRLS"
create_role samanvay_worker "$DB_WORKER_PASSWORD" "BYPASSRLS"

for name in "$DB" "${DB}_test"; do
  if [[ -z "$(psql_su "SELECT 1 FROM pg_database WHERE datname = '$name'")" ]]; then
    psql_su "CREATE DATABASE \"$name\" OWNER samanvay_owner"
  fi
  psql_su "REVOKE ALL ON DATABASE \"$name\" FROM PUBLIC; GRANT CONNECT ON DATABASE \"$name\" TO samanvay_app, samanvay_worker"
done

cd "$ROOT/backend"
uv run alembic upgrade head
echo "Database '$DB' is ready."
