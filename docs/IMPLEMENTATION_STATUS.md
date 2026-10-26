# Implementation status

Last updated: 26 Oct 2026 (frontend rebuild in the afternoon). Source of truth for scope: the *Samanvay Solution Blueprint* artifact (31 sections, 51 requirements).
Status values: **Completed**, **In progress**, **Not started**, **Blocked**. "Completed" means implemented, exercised by an
automated test or by the browser walkthrough below, and not a mock.

## Verification run (this session)

| Check | Result |
|---|---|
| Backend tests (`uv run pytest`, real PostgreSQL 17, fresh `samanvay_test` DB from migrations) | **48 passed**, 0 failed (26 Oct, after the frontend rebuild: +2 for the transfers list and cockpit analytics feeds) |
| Backend lint / format (`ruff check`, `ruff format --check`) | clean |
| Frontend `tsc --noEmit`, `eslint .` | 0 errors, 0 warnings |
| Frontend unit tests (`pnpm test`, Vitest) | **23 passed** |
| Frontend browser journeys (`pnpm e2e`, Playwright + Chrome, real API on a copy of the demo DB) | **12 passed** — sign-in per role, sign-out, search, filter persistence, overlap evidence, two-party decision, transfer handshake, Action Conflict Guard, restricted roles, loading / empty / error / session-expiry |
| Frontend `next build` (production) | succeeds, 31 routes |
| Demo seed (`app.ml.seed`) | 3,005 cases, 400 institutions, 802 overlap proposals, 198 coordination cards, ~100 s |
| Matching benchmark, n-gram backend (default) | Samanvay P 0.896 / R 0.807 / F1 0.849 vs B1 fuzzy-name F1 0.589, B0 0.452 |
| Matching benchmark, multilingual embeddings | P 0.904 / R 0.813 / F1 0.856; Hindi–English recall 0.35 (n-gram 0.29) |
| Institution resolution (benchmark) | auto-resolve precision 1.000, top-3 recall 0.999, 0 sibling-campus false merges, 34% routed to an officer |
| Browser walkthrough (built-in browser, dev server) | intake → resolver → P-type coordination card → guard on show-cause → coordinate first → propose / confirm decision → cockpit, 360, benchmark, reports pages; no page-level horizontal overflow at 672 px |
| Docker Compose | `docker compose config` validates; **images not built or run** (Docker daemon unavailable on the build machine) |
| CI workflow | written; **not run** (repository has no remote yet) |

Recall is below the blueprint target of 0.85 (0.807). The shortfall is Hindi–English pairs without the embedding backend;
all other overlap kinds are ≥ 0.93. Precision meets the 0.80 target.

## Checklist by solution card

| SOL | Scope | Status | Main files | Tests / evidence | Notes and decisions |
|---|---|---|---|---|---|
| 01 | Unified register, manual intake, Register Importer, CPGRAMS profile, status mapping | Completed | `backend/app/modules/case/service.py`, `imports/*`, `frontend/app/(app)/cases/new`, `imports` | `test_ledger_custody`, `test_register_import_with_row_errors_and_idempotent_rerun`, `test_excel_preview_reads_xlsx` | Idempotent on (channel, source_ref); per-row savepoints; mapping suggestions by string similarity (no AI). Mailbox reader not built (production roadmap). |
| 02 | Institution master, resolver, aliases, Institution 360 | Completed | `institution/resolver.py`, `institution/router.py`, `frontend/app/(app)/institutions` | `test_matching_unit` (siblings, PID, city), `test_low_confidence_institution_needs_officer`, benchmark | Fellegi–Sunter-style scorer instead of Splink (no EM training yet). Officer-confirmed variants become `LEARNED` aliases. Master feed from the approval portal not integrated (A-10). |
| 03 | Case FSM (table-driven), custody handshake, assignment, history, optimistic locking | Completed | `case/fsm.py`, `case/service.py`, migration `0002` (`transition_rule`) | `test_custody_handshake_transfer_accept`, `test_transfer_return_restores_prior_status`, `test_illegal_transition_and_remarks_and_stale_version` | Intake-only officers' cases are auto-assigned to the least-loaded case officer (blueprint §14.3), so no open case lacks a custodian. Per-unit transition sets not built. |
| 04 | Overlap engine: cascade, typology, reasons, calibration, worker | Completed | `matching/normalize.py`, `similarity.py`, `scoring.py`, `engine.py` | `test_overlap_coordination`, `test_matching_unit`, benchmark | See TECH_STACK deviations 7–9 (weights, calibration, parallel-action rule, embeddings optional). Monthly re-estimation from officers' decisions not built. |
| 05 | Coordination Required workflow, lead unit, two-party confirmation, room, escalation | Completed | `coordination/service.py`, `coordination/router.py`, `frontend/app/(app)/coordination` | `test_two_party_decision_and_follow_up`, browser walkthrough | Head-level confirmation of lead unit is not a separate step (either officer or head of the other unit confirms). |
| 06 | Action Conflict Guard | Completed | `coordination/guard.py`, `case/service.py` (`_consume_guard`), `components/case-dialogs.tsx` | `test_action_conflict_guard`, `test_guard_open_coordination_choice_does_not_act` | Single-use guard token (15 min); reason ≥ 10 chars to proceed past an undecided overlap; other units notified. "Head approval for proceed" option not built. |
| 07 | SLA policies (versioned), working-day calendar, timers, notifications outbox, e-mail | Completed | `sla/*`, migration `0002` (calendar, policies) | `test_cpgrams_policy_21_days_with_interim_prompt`, `test_timers_fire_once_and_escalate_transfers`, hypothesis calendar test | Strictest applicable policy wins (keeps the DARPG 21-day rule). Only fixed-date national holidays seeded; regional calendars not loaded. Daily e-mail digests: R-type digest only. |
| 08 | Cockpit, Bureau Desk, drill-down, freshness | Completed | `dashboard/router.py`, `frontend/app/(app)/cockpit`, `desk` | `test_cockpit_tiles_equal_drill_down_counts`, `test_unit_head_cockpit_is_scoped_to_own_unit` | Polling every 30 s instead of server-sent events. |
| 09 | Search: typed tokens, 8 filters, fuzzy names, full text in scope, keyset pagination | Completed | `search/query.py`, `case/views.py`, `frontend/app/(app)/cases` | `test_search_filters_and_fuzzy_name` | p95 at 200k cases not load-tested. Transliterated Hindi search column not built. |
| 10 | Reports (8), frozen snapshots + SHA-256, XLSX/PDF/CSV, register health, SLA simulator | Completed | `reports/*`, `dashboard/router.py` (`/simulations/sla`) | `test_report_snapshot_checksum_and_downloads`, `test_sla_simulator_replays_history` | Scheduled distribution of monthly reports and attention signals not built. Small-cell suppression not needed for current breakdowns (no category split). |
| 11 | Documents: size limit, magic bytes, scan, hash, tiered download | Completed (dev scanner) | `documents/*` | `test_document_upload_scan_hash_and_tiered_download` | `SCANNER=builtin` detects EICAR only; ClamAV (`clamd`) path written but not exercised here. Download watermarking not built. |
| 12 | RBAC + ABAC tiers + PostgreSQL RLS, sealed categories, reveal-with-reason | Completed | migration `0001` (RLS functions/policies, grants), `policy/roles.py`, `case/views.py` | `test_access_tiers` (5 tests incl. raw-SQL RLS bypass attempt) | Role matrix covered by targeted tests, not the full 120-case matrix. Time-boxed access grants exist in the schema and RLS but have no UI/API to issue them yet. |
| 13 | Hash-chained audit, Ed25519-signed Merkle checkpoints, verifier, insert-only roles | Completed | `audit/chain.py`, `audit/router.py` | `test_audit_chain_verifies_and_detects_tampering` | Signing key from env; production should hold it in a KMS/HSM. RFC 3161 timestamping not built. |
| 14 | Accessibility and Hindi | In progress | `frontend/*`, `lib/i18n.ts`, `lib/session.tsx` | lint rules, Playwright journeys use role/label queries | Hindi for navigation, titles and common actions; status always icon + text; labelled fields with error messages; ARIA tabs with arrow keys; Radix dialogs manage focus; skip link; text-size and reduce-motion preferences; no page-level horizontal overflow at 375 px on the pages checked. axe-core and a screen-reader pass not run. |
| 15 | Bounded LLM agents, breach-risk model, complainant lookup | Not started | — | — | Optional by design; the core never depends on them. |

## Other work items

| Item | Status | Notes |
|---|---|---|
| Synthetic generator + benchmark harness + labels outside DB | Completed | `backend/app/ml/synthetic.py`, `benchmark.py`; results in `ml/benchmark/` |
| Demo seed with story cases and sample import files | Completed | `backend/app/ml/seed.py`, `samples/` |
| Frontend rebuild: logo-derived design system, grouped navigation, one page per workspace with tabs, Worklist / Transfers / Notifications / Settings pages, cockpit and reports split into sections | Completed | See docs/FRONTEND.md. Replaces the earlier pastel-tile style. |
| Frontend unit and browser tests | Completed | `frontend/tests/`, `frontend/e2e/`, `scripts/e2e_db.sh` |
| Docker images and Compose stack | In progress | Written and config-validated; not built (no Docker daemon) |
| CI (GitHub Actions: ruff, pytest with Postgres, benchmark, web lint/typecheck/build, gitleaks) | In progress | Written; not executed |
| OIDC / Parichay SSO | Not started | Local Argon2 accounts with revocable sessions today |
| Load, ZAP, axe-core, restore drills (blueprint §24) | Not started | |

## Known issues and limitations

- The benchmark is synthetic and generated by the same team; it proves the mechanism and the measurement, not real-world accuracy.
- Seeded cases resolve to the least-loaded officer, so the PGRC director (who also holds the case-officer role) receives some cases.
- Rate limiting is in-process; run one API replica or move it to Redis.
- Notification volume on a freshly seeded database is high (several hundred) because historical overlaps open cards at seed time.
- The project folder is not yet a git repository; the gitleaks CI job needs one.
- `TRANSFER_PROPOSED` rows from imports are mapped to `REGISTERED` (an imported register cannot carry a pending handshake).

## Continuation checklist (priority order)

1. Run CI on a remote and build the Docker images; fix anything environment-specific.
2. Mentor validation of statuses, categories, timelines, sealed categories and consequential actions (blueprint §4.4, Q1–Q12); update migration `0002` data accordingly.
3. Tune embedding-backend text bands on cross-lingual pairs (Hindi–English recall is the remaining gap to R ≥ 0.85).
4. API and UI for time-boxed access grants; "head approval to proceed" option in the guard.
5. axe-core in CI, a keyboard-only pass, and Hindi strings beyond navigation.
6. k6 load scenarios from blueprint §22.3; ZAP baseline; backup-restore drill.
7. OIDC login (Keycloak for the pilot, Parichay for production) behind the existing session model.
