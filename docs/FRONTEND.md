# Frontend (web app)

Next.js 16 (App Router, client components), TypeScript, Tailwind 4, Motion. Added in this pass: `lucide-react` (icons),
`radix-ui` (dialogs, menus, popover, tooltip), `react-hook-form` + `zod` (forms), Vitest + Testing Library (unit),
Playwright (browser journeys). Charts are small SVG/HTML components in `components/charts.tsx` (no chart library):
the cockpit needs lines and bars only, and a table view of every chart.

## Look and feel

Colours come from the logo (`public/brand/`): wordmark navy for identity and the sidebar, the lotus blue petal for
actions, green / gold / red for state, saffron (the diya and linked rings) for coordination signals. The five-colour
stripe under the logo's tagline appears at the top of the sidebar and sign-in page. Tokens live in `app/globals.css`
(light and dark). Chart series are the lotus colours, validated for colour-blind separation in both modes.
Status is always icon + text. Inter for UI text, Poppins for the wordmark, Noto Sans Devanagari for Hindi.

## Navigation (each item is its own page; detail pages use tabs)

| Group | Page | Route | Who sees it |
|---|---|---|---|
| Workspace | Bureau Desk (KPIs, alerts, top-8 priorities, quick actions) | `/desk` | intake, case officer, unit head, RO |
| | My Worklist (views, mine/unit, search, urgency sort, paging) | `/worklist` | same |
| | All Cases register (search, filters, chips, sort, paging, CSV of page) | `/cases`, `/cases/new` | case-view roles |
| | Case workspace — Overview (routing check, assistance) · Timeline · Documents · Linked cases | `/cases/[caseNo]?tab=` | case-view roles |
| | Coordination Centre and review room — Review & decide · Discussion | `/coordination`, `/coordination/[code]` | coordination roles, senior mgmt, auditor |
| | Transfers — Incoming · Outgoing · History | `/transfers?view=` | case-view roles |
| | Assistance Requests — Asked of my unit · My unit asked · History | `/assistance?view=` | case-view roles |
| | Register Importer | `/imports` | intake roles |
| Institutions | Institution 360 — Identity & units · Cases · Related-case alerts · History | `/institutions`, `/institutions/[pid]` | case-view roles, data steward |
| Insights | Management Cockpit — Overview · Workload & ageing · SLA & timeliness · Coordination | `/cockpit/*` | unit head, RO, senior mgmt, CA |
| | Reports & Analytics — Live analytics · Report catalogue · Frozen snapshots | `/reports/*` | management, auditor |
| | Matching benchmark | `/benchmark` | as before |
| System | Notifications | `/notifications` | everyone |
| | Administration — Health · Users & roles · SLA policies · Reference data · Access review | `/admin/*` | system administrator |
| | Audit Trail — Event log · Integrity verification · Access review | `/audit?tab=` | auditor, system administrator |
| | Profile & Settings (identity, language, text size, reduce motion, session) | `/settings` | everyone |

Global search (⌘K / Ctrl K or `/`) jumps to pages, cases and institutions. Filters, tabs and views live in the URL;
the register remembers its page per query in `sessionStorage` (cleared on sign-out).

`lib/permissions.ts` mirrors the backend role sets and drives navigation and buttons. It is a usability layer: the API
and PostgreSQL row-level security enforce every rule, and pages show a permission-denied state on 403.

## Routing and assistance (components/routing.tsx)

- **Routing check** (case Overview, holding unit only): keep / transfer / assist with a relative confidence, an
  "ambiguous jurisdiction" flag, the reasons (same evidence list as overlap matching), units already coordinating, and
  alternatives. "Approve" opens the transfer or assistance form pre-filled; the officer can change anything.
- **Mandate hint** in the transfer and assistance forms: the unit directory's view of the chosen unit for this category
  (primary, supporting, or none — advisory).
- **Assistance panel** on the case and the **Assistance Requests** inbox: accept, complete (response), decline (reason,
  optional better-placed unit), withdraw. Sidebar badge = requests awaiting your unit's acknowledgement.
- **Needs verification** on the coordination card: what to verify and by when; shown as a banner until someone decides.

## Authentication

Existing server sessions: Argon2 password or (demo builds) one-click demo login, httpOnly session cookie, CSRF
double-submit, 30-minute sliding expiry refreshed every 10 minutes while a page is open. Sign-out calls
`POST /auth/logout` (revokes the session row), clears every cached API response and `smv:` session storage, and
returns to `/login?signed_out=1`; forms with unsaved edits ask first. A 401 anywhere returns to
`/login?reason=expired&next=…`. Pages restored from the back-forward cache re-check the session. There is no public
registration, no self-service password reset (the sign-in page says so) and no SSO yet (Parichay planned).

## API integration

Every page uses the real API through `lib/api.ts` (typed in `lib/types.ts`). No mock adapter was needed. Two read-only
endpoints were added for this UI, with tests in `backend/tests/test_frontend_feeds.py`:

- `GET /api/v1/transfers?direction=incoming|outgoing|all&state=open|closed|all` — custody handshakes for the caller's
  unit (oversight roles: all units; reason text only for the two units involved).
- `GET /api/v1/dashboard/analytics?unit=&region=&months=` — monthly received / disposed, and status by unit, region
  and category, scoped like the cockpit summary.

## Known gaps (backend capabilities not available yet)

- No "new assignment" notification family; assignments appear on the worklist only.
- Statuses, categories and units are read-only in Administration (they come from migrations); institution master
  editing is limited to adding verified aliases (data steward).
- Case-register export is the visible page as CSV; full exports go through frozen reports (XLSX / PDF / CSV).
- "Due in 7 days" on the desk counts within the 50 most urgent cases the desk endpoint returns (labelled as such).
- Guard "blocked" state appears only if the API offers no proceed choice; today it always allows "proceed and notify"
  with a recorded reason (head-approval option not built).
- Hindi covers navigation, page titles and common actions; page body copy is English.

## Tests

```bash
cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

```bash
cd frontend && pnpm e2e
```

`pnpm e2e` starts its own API (port 8001, `APP_ENV=test` so the login rate limiter does not throttle the suite) and
web server (port 3001, build folder `.next-e2e`) against `samanvay_e2e`, a fresh copy of the local demo database made
by `scripts/e2e_db.sh`. The demo database is not modified. It uses the installed Google Chrome
(`PW_CHANNEL` to change). `E2E_SKIP_DB_RESET=1` reuses the previous copy.
