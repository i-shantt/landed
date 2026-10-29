import { defineConfig, devices } from "@playwright/test";

// Browser smoke against a running app (default http://localhost:3000, started here when absent) whose
// Convex deployment has the fixtures and the two demo accounts (`npx convex run authSetup:ensureDemoAccounts`).
// Not part of scripts/verify.sh (needs a browser); run with `npm run e2e`. E2E_BASE_URL points it elsewhere.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure", viewport: { width: 1280, height: 800 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npx next dev --port 3000", url: "http://localhost:3000/signin", reuseExistingServer: true, timeout: 120_000 },
});
