import { expect, type Page } from "@playwright/test";

export type DemoUser = { id: string; full_name: string; unit_code: string; role_labels: string[] };

export async function demoUsers(page: Page): Promise<DemoUser[]> {
  const r = await page.request.get("/api/v1/auth/demo-users");
  expect(r.ok()).toBeTruthy();
  return r.json();
}

/** Signs in through the visible demo-account list (the same path a demo operator uses). */
export async function signInAs(page: Page, name: string): Promise<void> {
  await page.goto("/login");
  const btn = page.getByTestId(`demo-${name}`);
  await expect(btn).toBeVisible();
  await btn.click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await expect(page.getByTestId("profile-menu")).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByTestId("profile-menu").click();
  await page.getByTestId("sign-out").click();
  await page.waitForURL(/\/login\?signed_out=1/);
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const r = await page.request.get(`/api/v1${path}`);
  expect(r.ok(), `${path} → ${r.status()}`).toBeTruthy();
  return r.json() as Promise<T>;
}

export const STORY_CASES = new Set(["SMV-2026-000001", "SMV-2026-000002", "SMV-2026-000003", "SMV-2026-000004", "SMV-2026-000005"]);
