# Implementation status

Last updated: 27 Oct 2026 (scope audit; Phase 0 verification and Phase 1 routing & assistance). Source of truth for scope: the *Samanvay Solution Blueprint* artifact (31 sections, 51 requirements).
Status values: **Completed**, **In progress**, **Not started**, **Blocked**. "Completed" means implemented, exercised by an
automated test or by the browser walkthrough below, and not a mock.

## Verification run (this session)

| Check | Result |
|---|---|
| Backend tests (`uv run pytest`, real PostgreSQL 17, fresh `samanvay_test` DB from migrations 0001–0003) | **55 passed**, 0 failed (27 Oct; +7 in `test_routing_assistance`) |
| Backend lint / format (`ruff check`, `ruff format --check`) | clean |
| Frontend `tsc --noEmit`, `eslint .` | 0 errors, 0 warnings |
| Frontend unit tests (`pnpm test`, Vitest) | **25 passed** (+2 for assistance and verification forms) |
| Frontend browser journeys (`pnpm e2e`, Playwright + Chrome, real API on a copy of the demo DB) | **13 passed** — sign-in per role, sign-out, search, filter persistence, overlap evidence, two-party decision, transfer handshake, **assistance request accepted and completed by another unit (access ends on completion)**, Action Conflict Guard, restricted roles, loading / empty / error / session-expiry |
| Frontend `next build` (production) | succeeds inside the `web` Docker image (27 Oct) |
| Demo seed (`app.ml.seed`) | 3,005 cases, 400 institutions, 802 overlap proposals, 198 coordination cards (13 undecided), 46 unread notifications, ~65 s |
| Browser walkthrough, 27 Oct (built-in browser) | RB routing check (keep, already coordinating with RO-W) → request assistance from AB (mandate hint) → AB inbox accept → AB reads the case while open → complete → AB back to metadata; RO-W routing check recommends transfer to RB with alternatives; "needs verification" on C-2026-00001 |
| Docker Compose (27 Oct) | images built; seed run in the `api` container (same numbers as above); stack up; `/health/ready` OK; web `/login` 200; demo sign-in and routing check through the web proxy. Found and fixed: missing `.dockerignore`, unpinned pnpm, seed racing a running worker (seed now refuses), worker inheriting the API healthcheck (now a heartbeat check) |
| Matching benchmark, n-gram backend (default) | Samanvay P 0.896 / R 0.807 / F1 0.849 vs B1 fuzzy-name F1 0.589, B0 0.452 |
| Matching benchmark, multilingual embeddings | P 0.904 / R 0.813 / F1 0.856; Hindi–English recall 0.35 (n-gram 0.29) |
| Institution resolution (benchmark) | auto-resolve precision 1.000, top-3 recall 0.999, 0 sibling-campus false merges, 34% routed to an officer |
| Browser walkthrough (built-in browser, dev server) | intake → resolver → P-type coordination card → guard on show-cause → coordinate first → propose / confirm decision → cockpit, 360, benchmark, reports pages; no page-level horizontal overflow at 672 px |
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
| 15 | Bounded LLM agents, breach-risk model, complainant lookup | Not started | — | — | Optional by design; the core never depends on them. Next: AI copilot (summary, match explanation, category suggestion) and an officer-facing regulations RAG (scope audit, 27 Oct). |
| 16 | Inter-bureau routing check and unit directory (ministry note pp. 13–15) | Completed (rules) | `routing/service.py`, migration `0003` (`unit_mandate`), `components/routing.tsx` | `test_routing_assistance` (directory, transfer recommendation, keep, jurisdiction recorded) | Rules-first, advisory: mandate (primary 3.0 / support 1.0), related cases held, transfer history, holder preference. Directory is proposed v0. No AI text classifier yet; recommendations are computed on demand, not stored (whether the officer followed one is recorded on the transfer / request). |
| 17 | Assistance requests — holding unit keeps the case (ministry routing action B) | Completed | `assistance/*`, migration `0003` (`assistance_request`, `smv_case_full` clause), `app/(app)/assistance`, `components/routing.tsx` | `test_routing_assistance` (lifecycle, access only while open, decline + suggestion, sealed refused, overdue escalates once), Playwright journey 7b | SENT → ACCEPTED → COMPLETED / DECLINED / CANCELLED; reminder at 2 working days, escalation after the due date. No head-approval step before sending. |
| 05b | "Needs verification" coordination outcome (ministry note p. 4) | Completed | `coordination/service.py` (`request_verification`), coordination page | `test_needs_verification_keeps_the_card_undecided` | Status `VERIFYING`; ≤ 10 working days; guard still warns; escalates if undecided. |

## Other work items

| Item | Status | Notes |
|---|---|---|
| Synthetic generator + benchmark harness + labels outside DB | Completed | `backend/app/ml/synthetic.py`, `benchmark.py`; results in `ml/benchmark/` |
| Demo seed with story cases and sample import files | Completed | `backend/app/ml/seed.py`, `samples/` |
| Frontend rebuild: logo-derived design system, grouped navigation, one page per workspace with tabs, Worklist / Transfers / Notifications / Settings pages, cockpit and reports split into sections | Completed | See docs/FRONTEND.md. Replaces the earlier pastel-tile style. |
| Frontend unit and browser tests | Completed | `frontend/tests/`, `frontend/e2e/`, `scripts/e2e_db.sh` |
| Docker images and Compose stack | Completed | Built 27 Oct after adding `.dockerignore` files and pinning `packageManager: pnpm@9.12.0` (a newer pnpm in the image refused the lockfile's build scripts). See verification table for the run. |
| Demo seed hygiene | Completed | Historical coordination cards are decided through the real workflow from the generator's hidden labels (back-dated as the schema owner); 12 newest stay open. Seeds 3 story documents, 2 frozen reports and one completed assistance request. Unread notifications after seeding: 42 (was 992). |
| CI (GitHub Actions: ruff, pytest with Postgres, benchmark, web lint/typecheck/build, gitleaks) | In progress | Written; not executed |
| OIDC / Parichay SSO | Not started | Local Argon2 accounts with revocable sessions today |
| Load, ZAP, axe-core, restore drills (blueprint §24) | Not started | |

## Known issues and limitations

- The benchmark is synthetic and generated by the same team; it proves the mechanism and the measurement, not real-world accuracy.
- Seeded cases resolve to the least-loaded officer, so the PGRC director (who also holds the case-officer role) receives some cases.
- Rate limiting is in-process; run one API replica or move it to Redis.
- The repository has no remote yet, so the CI workflow (incl. gitleaks) has not run.
- The routing directory and its weights are proposals; confidence is relative (softmax over the leading units), not a
  probability that a routing is legally correct.
- `TRANSFER_PROPOSED` rows from imports are mapped to `REGISTERED` (an imported register cannot carry a pending handshake).

## Continuation checklist (priority order)

Scope audit of 27 Oct (ministry solution note + AI proposal): Phase 0 (verification, demo hygiene) and Phase 1 (routing,
assistance, needs verification) are done. Next, in order:

1. Phase 2 — turn on multilingual embeddings for the demo (bundle the model), case tasks (owner, due, status,
   dependencies), Institution Case Graph view, recurring-issue clustering, category-wise and overlap-trend reports,
   per-officer workload.
2. Phase 3 — AI copilot behind a flag on synthetic data (case summary, coordination brief, match explanation, category
   suggestion, missing-information check; citations to event IDs; human approves), then an officer-facing RAG over a
   curated set of public regulations.
3. Run CI on a remote.
4. Mentor validation of statuses, categories, timelines, sealed categories and consequential actions (blueprint §4.4, Q1–Q12); update migration `0002` data accordingly.
5. Tune embedding-backend text bands on cross-lingual pairs (Hindi–English recall is the remaining gap to R ≥ 0.85).
6. API and UI for time-boxed access grants; "head approval to proceed" option in the guard.
7. axe-core in CI, a keyboard-only pass, and Hindi strings beyond navigation.
8. k6 load scenarios from blueprint §22.3; ZAP baseline; backup-restore drill.
9. OIDC login (Keycloak for the pilot, Parichay for production) behind the existing session model.
