import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Browser journeys run against the real API and PostgreSQL, on ports 8001 / 3001, using `samanvay_e2e` — a fresh copy
 * of the demo database made by scripts/e2e_db.sh before the API starts. The demo database itself is never modified.
 * Set E2E_SKIP_DB_RESET=1 to keep the previous copy.
 */
const E2E_DB = process.env.E2E_DB ?? "samanvay_e2e";

function e2eEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+_DATABASE_URL|DATABASE_URL)=(\S+)/);
    if (m) env[m[1]] = m[2].replace(/\/[^/?#]+$/, `/${E2E_DB}`);
  }
  // APP_ENV=test only turns off the in-process rate limiter and log setup, so the suite's repeated sign-ins are not throttled.
  return { ...env, DEMO_MODE: "true", APP_ENV: "test" };
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: process.env.PW_CHANNEL ?? "chrome",
    viewport: { width: 1366, height: 900 },
  },
  webServer: [
    {
      command: `${process.env.E2E_SKIP_DB_RESET === "1" ? "" : "../scripts/e2e_db.sh && "}uv --directory ../backend run uvicorn app.main:app --host 127.0.0.1 --port 8001`,
      url: "http://127.0.0.1:8001/api/v1/auth/csrf",
      env: e2eEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm exec next dev -p 3001",
      url: "http://localhost:3001/login",
      env: { API_ORIGIN: "http://127.0.0.1:8001", NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
