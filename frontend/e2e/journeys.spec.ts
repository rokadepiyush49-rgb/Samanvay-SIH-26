import { expect, test } from "@playwright/test";
import { apiGet, demoUsers, signInAs, signOut, STORY_CASES } from "./helpers";

type Side = { unit: string; case_no: string; officer: string | null };
type Card = { code: string; status: string; can_decide: boolean; awaiting_me: boolean; a: Side; b: Side };
type Row = { case_no: string; full_access: boolean; status: string; holding_unit: { code: string } };

test.describe("1–2 · sign in, role workspace, sign out", () => {
  test("each role lands on its own workspace", async ({ page }) => {
    await signInAs(page, "Dr Neha Iyer");
    await expect(page).toHaveURL(/\/desk$/);
    await expect(page.getByRole("heading", { level: 1, name: "Bureau Desk" })).toBeVisible();
    await signOut(page);
    await signInAs(page, "Dr Suresh Rao");
    await expect(page).toHaveURL(/\/cockpit/);
    await expect(page.getByRole("heading", { level: 1, name: "Management Cockpit" })).toBeVisible();
    await signOut(page);
    await signInAs(page, "Internal Auditor (demo)");
    await expect(page).toHaveURL(/\/audit/);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Bureau Desk" })).toHaveCount(0);
  });

  test("sign-out revokes the server session and protects pages and APIs", async ({ page }) => {
    await signInAs(page, "Dr Neha Iyer");
    await signOut(page);
    await expect(page.getByText(/You have signed out/)).toBeVisible();
    expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
    expect((await page.request.get("/api/v1/cases?limit=1")).status()).toBe(401);
    await page.goto("/desk");
    await page.waitForURL(/\/login\?reason=signin&next=%2Fdesk/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });

  test("the sign-in form validates fields and reports bad credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter your official e-mail address.")).toBeVisible();
    await page.getByLabel("Official e-mail").fill("nobody@samanvay.example");
    await page.getByLabel(/^Password/).fill("wrong-password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByLabel(/^Password/)).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Sign-in failed" })).toBeVisible();
  });
});

test("3 · search for a case and open its workspace", async ({ page }) => {
  await signInAs(page, "Dr Neha Iyer");
  await page.getByTestId("global-search").click();
  await page.getByRole("combobox", { name: "Search" }).fill("SMV-2026-000001");
  const option = page.getByRole("option", { name: /^SMV-2026-000001/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/cases\/SMV-2026-000001/);
  await expect(page.getByTestId("case-no")).toHaveText("SMV-2026-000001");
  for (const name of ["Overview", "Timeline", "Documents", "Linked cases"]) await expect(page.getByRole("tab", { name: new RegExp(name) })).toBeVisible();
  await page.getByRole("tab", { name: /Timeline/ }).click();
  await expect(page).toHaveURL(/tab=timeline/);
  await expect(page.getByRole("group", { name: "Filter timeline" })).toBeVisible();
});

test("4 · register filters and page survive opening a case and coming back", async ({ page }) => {
  await signInAs(page, "Dr Neha Iyer");
  await page.goto("/cases");
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByLabel("Bureau / cell / RO").selectOption("RB");
  await page.getByRole("checkbox", { name: "Open only" }).check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/unit=RB/);
  await expect(page).toHaveURL(/open_only=true/);
  await expect(page.getByLabel("Active filters").getByText("Unit: RB")).toBeVisible();
  await page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Page 2")).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const first = page.getByTestId("case-row").first().getByRole("link").first();
  const caseNo = await first.textContent();
  await first.click();
  await expect(page.getByTestId("case-no")).toHaveText(caseNo!);
  await page.goBack();
  await expect(page).toHaveURL(/unit=RB/);
  await expect(page.getByLabel("Active filters").getByText("Unit: RB")).toBeVisible();
  await expect(page.getByText("Page 2")).toBeVisible();
});

test("5–6 · inspect overlap evidence, propose a decision, and confirm it as the other unit", async ({ page }) => {
  await signInAs(page, "Dr Neha Iyer");
  const users = await demoUsers(page);
  const { items } = await apiGet<{ items: Card[] }>(page, "/coordination?status=open&mine=true&limit=200");
  // The other unit confirms: its case holder, or its unit head.
  const confirmerFor = (c: Card) => {
    const side = c.a.unit === "RB" ? c.b : c.a;
    return users.find((u) => u.full_name === side.officer) ?? users.find((u) => u.unit_code === side.unit && u.role_labels.some((r) => /Unit head/.test(r)));
  };
  const card = items.find((c) => c.status === "OPEN" && c.can_decide && c.a.unit !== c.b.unit && !STORY_CASES.has(c.a.case_no) && !STORY_CASES.has(c.b.case_no) && confirmerFor(c));
  test.skip(!card, "no open card between RB and a unit with a demo officer");

  await page.goto("/coordination");
  await expect(page.getByTestId("coordination-row").first()).toBeVisible();
  await page.goto(`/coordination/${card!.code}`);
  await expect(page.getByRole("heading", { name: "Why these cases were matched" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Matching evidence" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Decision progress" })).toBeVisible();

  await page.getByRole("radio", { name: /Related — needs a lead unit/ }).check();
  await page.getByRole("button", { name: "Send proposal for confirmation" }).click();
  await expect(page.getByText("Choose which unit leads.")).toBeVisible();
  await page.getByRole("button", { name: "RB", exact: true }).click();
  await page.getByLabel("Rationale").fill("Same institution, same facts; RB leads the inspection.");
  await page.getByRole("button", { name: "Send proposal for confirmation" }).click();
  await expect(page.getByText(/Proposal sent/)).toBeVisible();
  await expect(page.getByTestId("proposal")).toContainText("RB proposed: Related, RB leads");

  await signOut(page);
  await signInAs(page, confirmerFor(card!)!.full_name);
  await page.goto(`/coordination/${card!.code}`);
  await page.getByRole("button", { name: "Confirm this decision" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.getByTestId("decision-final")).toContainText("Related · RB is the lead unit");
});

test("7 · propose a transfer and accept it in the receiving unit", async ({ page }) => {
  await signInAs(page, "Rohit Verma");
  const { items } = await apiGet<{ items: Row[] }>(page, "/cases?unit=RB&mine=true&status=REGISTERED&limit=20");
  let caseNo: string | undefined;
  for (const r of items.filter((x) => !STORY_CASES.has(x.case_no))) {
    const d = await apiGet<{ can_transfer: boolean }>(page, `/cases/${r.case_no}`);
    if (d.can_transfer) { caseNo = r.case_no; break; }
  }
  test.skip(!caseNo, "no transferable RB case for this officer");
  await page.goto(`/cases/${caseNo}`);
  await page.getByRole("toolbar", { name: "Case actions" }).getByRole("button", { name: "Transfer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Send for acceptance" }).click();
  await expect(dialog.getByText("Choose the receiving unit.")).toBeVisible();
  await dialog.getByLabel("Receiving unit").selectOption("PGRC");
  await dialog.getByLabel("Reason for transfer").fill("Student grievance; PGRC handles certificate complaints.");
  await dialog.getByRole("button", { name: "Send for acceptance" }).click();
  await expect(page.getByText(/Transfer to PGRC proposed/)).toBeVisible();
  await expect(page.getByTestId("transfer-panel")).toContainText("Custody stays with RB");
  await expect(page.getByTestId("case-holder")).toHaveText("RB");

  await signOut(page);
  await signInAs(page, "Prof. Sanjay Gupta");
  await page.goto("/transfers");
  const row = page.getByTestId("transfer-row").filter({ hasText: caseNo! });
  await expect(row.getByTestId("transfer-custodian")).toHaveText("RB");
  await row.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept transfer" }).click();
  await expect(page.getByText(new RegExp(`${caseNo} accepted`))).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("transfer-row").filter({ hasText: caseNo! }).getByTestId("transfer-custodian")).toHaveText("PGRC");
  await page.goto(`/cases/${caseNo}`);
  await expect(page.getByTestId("case-holder")).toHaveText("PGRC");
});

test("7b · ask another unit for assistance; it reads the case only while the request is open", async ({ page }) => {
  await signInAs(page, "Rohit Verma");
  const { items } = await apiGet<{ items: Row[] }>(page, "/cases?unit=RB&mine=true&status=REGISTERED&limit=20");
  let caseNo: string | undefined;
  for (const r of items.filter((x) => !STORY_CASES.has(x.case_no))) {
    const d = await apiGet<{ can_request_assistance: boolean }>(page, `/cases/${r.case_no}`);
    if (d.can_request_assistance) { caseNo = r.case_no; break; }
  }
  test.skip(!caseNo, "no RB case this officer can send for assistance");
  await page.goto(`/cases/${caseNo}`);
  await expect(page.getByTestId("routing-card")).toBeVisible();
  await page.getByRole("toolbar", { name: "Case actions" }).getByRole("button", { name: "Request assistance" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Unit to ask").selectOption("AB");
  await expect(dialog.getByTestId("mandate-hint")).toBeVisible();
  await dialog.getByRole("textbox", { name: /^Request/ }).fill("Please share the approval record for this institution.");
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/sent to AB\. RB keeps the case/)).toBeVisible();
  await expect(page.getByTestId("case-holder")).toHaveText("RB");

  await signOut(page);
  await signInAs(page, "Harpreet Gill");
  await page.goto("/assistance");
  const row = page.getByTestId("assistance-row").filter({ hasText: caseNo! });
  await row.getByRole("button", { name: "Accept", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept and start" }).click();
  await expect(page.getByText(/accepted\. You can read/)).toBeVisible();
  expect((await apiGet<{ tier: string }>(page, `/cases/${caseNo}`)).tier).toBe("full");
  await row.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("dialog").getByLabel("Response").fill("Approval record shared: approved intake 120 for 2025-26.");
  await page.getByRole("dialog").getByRole("button", { name: "Send response" }).click();
  await expect(page.getByText(/completed\. RB has your response/)).toBeVisible();
  expect((await apiGet<{ tier: string }>(page, `/cases/${caseNo}`)).tier).toBe("metadata");
});

test("8 · the Action Conflict Guard stops a conflicting action until a reason or coordination", async ({ page }) => {
  await signInAs(page, "Dr Neha Iyer");
  await page.goto("/cases/SMV-2026-000001");
  const before = (await apiGet<{ status: string; timeline: unknown[] }>(page, "/cases/SMV-2026-000001"));
  await page.getByRole("toolbar", { name: "Case actions" }).getByRole("button", { name: "Issue show-cause notice" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("guard-summary")).toHaveAttribute("data-level", "review");
  const proceed = dialog.getByRole("button", { name: "Proceed and notify units" });
  await dialog.getByLabel(/Remarks for the action/).fill("Show-cause for withheld certificates.");
  await proceed.click();
  await expect(dialog.getByText(/at least 10 characters/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel action" }).click();
  await expect(dialog).toBeHidden();
  const after = await apiGet<{ status: string; timeline: unknown[] }>(page, "/cases/SMV-2026-000001");
  expect(after.status).toBe(before.status);
  expect(after.timeline.length).toBe(before.timeline.length);

  // Another unit cannot act on RB's case at all; the API enforces the same rule.
  await signOut(page);
  await signInAs(page, "Arjun Sharma");
  await page.goto("/cases/SMV-2026-000001");
  await expect(page.getByTestId("case-no")).toHaveText("SMV-2026-000001");
  await expect(page.getByRole("button", { name: "Issue show-cause notice" })).toHaveCount(0);
  const r = await page.request.post("/api/v1/cases/SMV-2026-000001/actions", { data: { action: "SHOW_CAUSE_NOTICE", remarks: "x" }, headers: { "x-csrf-token": (await page.context().cookies()).find((c) => c.name === "smv_csrf")?.value ?? "" } });
  expect(r.status()).toBe(403);
});

test("9 · restricted roles do not see complaint content or other workspaces", async ({ page }) => {
  await signInAs(page, "Arjun Sharma");
  const { items } = await apiGet<{ items: Row[] }>(page, "/cases?unit=RB&limit=30");
  const hidden = items.find((c) => !c.full_access);
  expect(hidden, "an RB case without full access for PGRC").toBeTruthy();
  await page.goto(`/cases/${hidden!.case_no}`);
  await expect(page.getByTestId("metadata-only")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complaint as received" })).toHaveCount(0);
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expect(page.getByText("Documents are restricted")).toBeVisible();
  await signOut(page);

  await signInAs(page, "Deepa Kulkarni");
  await page.goto("/cases");
  await expect(page.getByTestId("permission-denied")).toBeVisible();
  expect((await page.request.get("/api/v1/cases?limit=1")).status()).toBe(403);
  await signOut(page);

  await signInAs(page, "Internal Auditor (demo)");
  await page.goto("/admin/users");
  await expect(page.getByTestId("permission-denied")).toBeVisible();
});

test.describe("10 · loading, empty, error and session-expiry states", () => {
  test("loading skeleton, then an empty result", async ({ page }) => {
    await signInAs(page, "Dr Neha Iyer");
    await page.route("**/api/v1/dashboard/desk", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.goto("/desk");
    await expect(page.getByRole("status").filter({ hasText: "Loading your desk" })).toBeAttached();
    await expect(page.getByRole("heading", { level: 1, name: "Bureau Desk" })).toBeVisible();
    await page.goto("/cases?q=zzqqxxnomatch");
    await expect(page.getByText("No cases match these filters")).toBeVisible();
  });

  test("a network failure shows an actionable error", async ({ page }) => {
    await signInAs(page, "Dr Neha Iyer");
    await page.route("**/api/v1/cases?**", (route) => route.abort());
    await page.goto("/cases");
    await expect(page.getByRole("alert").filter({ hasText: "Connection problem" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("an expired session returns the officer to sign-in, keeping the page", async ({ page, context }) => {
    await signInAs(page, "Dr Neha Iyer");
    await context.clearCookies();
    // Any API call from the open page now gets 401; navigating inside the app makes one immediately.
    await page.evaluate(() => document.querySelector<HTMLAnchorElement>('nav[aria-label="Main"] a[href="/worklist"]')?.click()).catch(() => undefined);
    await page.waitForURL(/\/login\?reason=expired/);
    await expect(page.getByText(/Your session expired/)).toBeVisible();
  });
});
