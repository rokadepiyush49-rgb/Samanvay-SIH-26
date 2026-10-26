# Samanvay (समन्वय)

**Integrated Institution Complaint Monitoring and Status Dashboard** for AICTE — SIH 2026, problem statement SIH26264
(AICTE Regulation Bureau, Software / Smart Automation).

One case ledger for the Regulation Bureau, PGRC, other bureaus and Regional Offices:

- **Custody handshake** — every case has exactly one holding unit and officer; transfers are proposed and accepted (or returned with a reason), with reminders and escalation.
- **Institution identity resolution** — free-text names (English or Hindi) resolve to an AICTE Permanent ID with a visible, per-field match score; sibling campuses are never merged silently.
- **Explainable overlap detection** — hard references → institution → text similarity → shared facts → timing, typed as duplicate / parallel action / related / co-occurrence, with reason codes on every link.
- **"Potential Overlapping Cases – Coordination Required"** — both units see the card; one proposes (lead unit, joint action), the other confirms; undecided cards escalate after 3 working days.
- **Action Conflict Guard** — before a show-cause notice, committee visit, hearing notice, letter or closure, the officer sees other units' open matters and records a choice.
- Working-day SLA timers (DARPG 21-day CPGRAMS rule with interim-reply prompt), Bureau Desk, Management Cockpit with drill-down, SLA what-if simulator, Institution 360, Register Importer, frozen checksummed reports (XLSX / PDF / CSV), hash-chained audit with signed checkpoints, three-tier need-to-know access enforced in the API **and** by PostgreSQL row-level security.

All data in this repository is **synthetic**. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TECH_STACK.md](docs/TECH_STACK.md)
and [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

## Run it locally (no Docker)

Requirements: PostgreSQL ≥ 16 running locally with a superuser for your OS user, Python 3.12 via [uv](https://docs.astral.sh/uv/), Node 24 with pnpm.

```bash
python3 scripts/gen_env.py
```

```bash
cd backend && uv sync && cd ../frontend && pnpm install && cd ..
```

```bash
./scripts/db_reset.sh --yes
```

`db_reset.sh` creates the three database roles, migrates, and loads the demo (≈3,000 cases, 400 institutions, ~1–2 minutes).
It **drops the local `samanvay` database first** and refuses to run when `APP_ENV=production`.

```bash
./scripts/dev.sh
```

Open http://localhost:3000. With `DEMO_MODE=true` the sign-in page lists demo officials for every role (one click, no password).
The demo password for the form is `SEED_DEMO_PASSWORD` in your `.env`.

### Demo script (≈5 minutes)

1. Sign in as **Kavita Menon (PGRC intake)** → *New case* → **Load demo CPGRAMS grievance (Hindi)**. The resolver picks
   Sahyadri Valley Institute of Engineering, **Nashik 0.98**, and shows the Pune sibling campus at 0.50 with the reason. Register.
2. The case opens with **Potential Overlapping Cases – Coordination Required — RB holds SMV-2026-000001**.
3. Switch role to **Dr Neha Iyer (RB)** → open SMV-2026-000001 → **Issue show-cause notice** → the **Action Conflict Guard**
   lists the PGRC grievance and the Western RO matter → *Coordinate first*.
4. In the coordination card, propose **Related, RB leads**, with a joint action. Switch to **Prof. Sanjay Gupta (PGRC)** and confirm.
5. **Institution 360** for 1-9990001234: every case across units, custodians, and the case-constellation timeline.
6. **Dr Suresh Rao (Adviser)** → *Management Cockpit*: tiles drill down to the exact cases; replay a 15-day CPGRAMS target in the SLA simulator; generate a monthly report and note its SHA-256.
7. **Internal Auditor** → *Audit* → *Verify chain*. To show tamper detection, edit one `audit_event.payload` row as the schema owner and verify again: the first broken entry is named.
8. *Matching benchmark*: B0 / B1 baselines vs the cascade, per overlap kind, with caveats.

Sample files to import live: [samples/rb_register_sample.xlsx](samples/rb_register_sample.xlsx) (300 rows, 9 overlapping
PGRC matters, 3 deliberately bad rows) and [samples/cpgrams_export_sample.csv](samples/cpgrams_export_sample.csv).

## Run with Docker Compose

```bash
docker compose -f infra/docker-compose.yml --env-file .env up --build
```

```bash
docker compose -f infra/docker-compose.yml --env-file .env run --rm api python -m app.ml.seed
```

Web on :3000, API on :8000 (OpenAPI at `/api/docs` outside production), MailHog on :8025. Add `--profile clamav` for real malware scanning.

## Tests and checks

```bash
cd backend && uv run pytest -o addopts="" -q
```

```bash
cd backend && uv run ruff check app tests migrations && uv run python -m app.ml.benchmark
```

```bash
cd frontend && pnpm lint && pnpm typecheck && pnpm build
```

The backend tests build a separate `samanvay_test` database from the real migrations (row-level security is part of what is tested).

## Repository layout

```
backend/   FastAPI modular monolith (app/modules/*), Alembic migrations (schema, RLS, reference data), worker, tests
frontend/  Next.js 16 app (role workspaces), Tailwind 4, Motion
ml/        benchmark results and labels (kept outside the application database)
infra/     docker-compose stack, Postgres role bootstrap
scripts/   env generation, DB bootstrap/reset, native dev runner
samples/   import files and the live demo complaint
docs/      architecture, stack decisions, implementation status
```

## Production prerequisites (not done here)

OIDC single sign-on (NIC Parichay), TLS termination, keys in a KMS/HSM, ClamAV, S3-compatible storage on NIC or a
MeitY-empanelled cloud, WAL-archived backups with tested restore, NTP sync with NIC/NPL, 180-day log retention (CERT-In),
a CERT-In-empanelled security audit, and AICTE sign-off on statuses, categories, timelines, sealed categories and the
list of consequential actions (all currently labelled *proposed*).
