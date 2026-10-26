#!/usr/bin/env bash
# Runs once when the Postgres container initialises an empty data directory.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE samanvay_owner LOGIN PASSWORD '${DB_OWNER_PASSWORD}';
CREATE ROLE samanvay_app LOGIN PASSWORD '${DB_APP_PASSWORD}' NOBYPASSRLS;
CREATE ROLE samanvay_worker LOGIN PASSWORD '${DB_WORKER_PASSWORD}' BYPASSRLS;
CREATE DATABASE samanvay OWNER samanvay_owner;
REVOKE ALL ON DATABASE samanvay FROM PUBLIC;
GRANT CONNECT ON DATABASE samanvay TO samanvay_app, samanvay_worker;
SQL
