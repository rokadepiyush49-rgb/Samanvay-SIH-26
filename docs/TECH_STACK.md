# Samanvay — Technology stack

Source of truth for the product: the *Samanvay Solution Blueprint* artifact (SIH 2026, PS SIH26264, AICTE Regulation Bureau).
This file records what was actually chosen for the codebase, why, and where it deliberately differs from the blueprint.

## Summary

| Layer | Choice | Why it fits | Alternatives considered |
|---|---|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript 5.9 | Role workspaces, SSR shell, file-based routing; `/api/*` proxied to the backend so auth cookies stay same-origin | Vite SPA (no proxy/SSR), Angular |
| UI | Tailwind CSS 4, hand-built accessible components | No heavy component library; WCAG-friendly primitives (focus rings, text+shape status chips) | MUI, Ant Design, Radix |
| Motion | Motion (`motion/react`, formerly Framer Motion) | Short fades, staggered tiles, hover lift; `reducedMotion="user"` honours the OS setting | CSS transitions only |
| Charts | Plain SVG/CSS bars | Tiles, ageing and workload bars need no chart library | Apache ECharts (blueprint) — add only if graph/map views are built |
| Data fetching | SWR | Revalidation on focus/interval gives the ≤ 60 s freshness target without websockets | React Query |
| Backend | FastAPI (Python 3.12) modular monolith, SQLAlchemy 2.1 Core/ORM, Pydantic 2 | Same language as matching code; OpenAPI out of the box; transactions across case + event + audit in one commit | Django, NestJS |
| Database | PostgreSQL 16/17 with `pg_trgm`, `unaccent`, `pgcrypto`, full-text search, **row-level security** | One store for data, fuzzy search, full-text and the RLS second layer of access control | MySQL (no RLS), OpenSearch (sync + permission drift) |
| Migrations | Alembic (raw SQL for RLS, functions, grants) | Versioned, reviewable schema changes | — |
| Jobs / queue | Postgres `job` table with `FOR UPDATE SKIP LOCKED`, own worker process | No extra infrastructure; enqueue is transactional with the change that caused it | Celery + Redis, Procrastinate |
| Timers (SLA) | `timer` table indexed on `due_at`, fired by the worker | Exactly-once firing via `fired_at` in the same transaction; precise; no external scheduler | Cron recompute |
| Notifications | `notification` outbox; in-app always, SMTP e-mail when configured (MailHog in demo) | At-least-once delivery with dedupe keys; no complaint text in e-mail | Push services |
| Auth (prototype) | Local accounts, Argon2id hashes, JWT in `httpOnly` cookie + server-side session row + double-submit CSRF token | Works offline on one laptop for the demo; sessions revocable; role changes effective immediately | Keycloak (blueprint) |
| Auth (production) | OIDC (Keycloak → NIC Parichay) | Government SSO path; the session/role model already separates identity from authorisation | — |
| Authorisation | Policy module in Python (RBAC for actions, ABAC tiers for data) **plus** Postgres RLS | Defence in depth (case study 08): an API bug still cannot read another unit's complaint body | Casbin, OPA sidecar |
| Institution resolver | Fellegi–Sunter-style log-odds scorer over `rapidfuzz` comparisons, candidates from `pg_trgm` | Explainable per-field weights (reason codes), CPU-only, deterministic | Splink (blueprint; EM training is the upgrade path), LLM lookup (rejected) |
| Text similarity | Pluggable: character n-gram cosine (default, no download) or multilingual sentence embeddings (`paraphrase-multilingual-MiniLM-L12-v2`) when installed | Core never depends on a model; embedding backend adds Hindi–English matching | Hosted embedding APIs (data residency) |
| Calibration | Platt scaling fitted on benchmark labels (numpy) | Probability 0.8 should mean ~80% | Isotonic (after ~500 real decisions) |
| Documents | Storage abstraction: local filesystem (dev) or S3-compatible (MinIO / host S3); magic-byte type check; ClamAV via `clamd` when configured | Same API locally and on government cloud | DB blobs |
| Reports | Frozen JSON snapshots with SHA-256 checksum; XLSX (openpyxl), PDF (reportlab), CSV | Reproducible numbers after the meeting | WeasyPrint (needs system Pango), BI tools |
| Audit | Hash-chained `audit_event` + Ed25519-signed Merkle checkpoints (key outside the DB) | Tamper evidence with standard cryptography; no blockchain (single trusted organisation) | Hyperledger Fabric, public chain (rejected) |
| Testing | pytest (+ Hypothesis property tests), FastAPI TestClient against a real Postgres; ESLint + `tsc` + `next build` for the web app | Real database because RLS and SQL are part of the behaviour | SQLite (cannot test RLS) |
| Packaging | `uv` for Python, `pnpm` for Node | Fast, lockfile-based | pip, npm |
| Deployment | Docker Compose (web, api, worker, postgres, mailhog; optional minio/clamav profiles); same images for NIC / MeitY-empanelled cloud | Portable OCI images | Kubernetes manifests (pilot) |
| CI | GitHub Actions: ruff, pytest with a Postgres service, web lint/typecheck/build | Pipeline as code | GitLab CI |

## Deliberate deviations from the blueprint

1. **Keycloak not bundled in the prototype.** Docker was not available on the build machine and the demo must run offline. Local Argon2 accounts with revocable sessions are used; OIDC is the production path (`docs/ARCHITECTURE.md` §Auth). A guarded `DEMO_MODE` one-click role switch exists for the stage demo and refuses to start when `APP_ENV=production`.
2. **pgvector not required.** Blocking by resolved institution keeps candidate sets to tens of cases, so vectors are compared in Python. Embeddings are cached in a `REAL[]` column. pgvector/HNSW becomes useful only for the unresolved-institution fallback and RAG (not built).
3. **Splink replaced by an in-house Fellegi–Sunter scorer** with the same comparison levels (Jaro–Winkler bands, token-set ratio, acronym, PIN, city, address Jaccard). Weights are fixed starting values; EM / Splink training is listed as follow-up.
4. **Workflow transition table lives in the database** (`transition_rule`), seeded by migration, so rule changes do not need a redeploy.
5. **No Redis.** Rate limiting is in-process (single API instance). With more than one API replica, move the limiter to Redis.
6. **No LLM in the core.** All bounded drafting agents (blueprint §14.4) are not started; the product works without them, as the blueprint requires.
7. **Two pair-scoring weights changed and probabilities calibrated.** Category agreement (3.5c − 1.5 instead of 2.5c − 1.0)
   and shared specific facts (3.0·J instead of 1.5·J) carry more weight, and Platt parameters are fitted on an independent
   synthetic seed (2027) and evaluated on seed 2026. A logistic model with per-feature learned weights scored higher on
   the synthetic set but learned generator artefacts (e.g. "text not compared ⇒ same matter"), so it was rejected.
8. **Parallel-action alerts are a rule.** The PS defines the overlap by institution and action state (PGRC under process +
   RB action initiated), so a P-type link fires for the same confirmed institution, different units, both open, one acting
   and compatible categories (≥ 0.5), even when the same-matter probability is low. The card says so ("Rule: …").
9. **Embedding backend is optional.** With `paraphrase-multilingual-MiniLM-L12-v2` overall F1 is 0.856 vs 0.849 for the
   n-gram default and Hindi–English recall 0.35 vs 0.29 — a small gain for a ~500 MB download, so n-grams stay the default.

## Version pins

Python: see `backend/pyproject.toml` + `backend/uv.lock`. Node: see `frontend/package.json` + `frontend/pnpm-lock.yaml`.
Runtime: Python 3.12, Node 24, PostgreSQL ≥ 16 with `pg_trgm`, `unaccent`, `pgcrypto`.
