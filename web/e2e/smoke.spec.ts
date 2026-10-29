import { test, expect, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../convex/demoAccounts";

// The public demo approver (convex/demoAccounts.ts). Public by design; see SECURITY.md.
const approver = DEMO_ACCOUNTS.find((a) => a.role === "approver")!;

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByLabel(/^email/i).fill(approver.email);
  await page.getByLabel(/^password/i).fill(approver.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

test("the workspace is behind sign-in; marketing pages are not", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin\?next=%2Fdashboard/);
  const res = await page.goto("/about");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/about$/);
});

test("the demo approver signs in and sees the dashboard with their name and role", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(/held, awaiting verification/i)).toBeVisible();
  await expect(page.getByText(approver.name.split(" ")[0], { exact: false }).first()).toBeVisible();
});

test("a case shows the deterministic risk panel", async ({ page }) => {
  await signIn(page);
  await page.goto("/cases");
  const first = page.locator('a[href^="/cases/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/cases\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { name: /^risk assessment/i })).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toHaveAttribute("aria-valuemax", "100");
  await expect(page.getByRole("heading", { name: /^learned model/i })).toBeVisible();
});

test("transaction monitoring renders", async ({ page }) => {
  await signIn(page);
  await page.goto("/monitoring");
  await expect(page.getByRole("heading", { name: /transaction monitoring/i })).toBeVisible();
});

test("sign out returns to /signin and the session is gone", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: new RegExp(approver.name.split(" ")[0], "i") }).first().click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/signin/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin\?next=/);
});

test("the OpenAPI document is public on the Convex site", async ({ request }) => {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  test.skip(!site, "NEXT_PUBLIC_CONVEX_SITE_URL not set");
  const res = await request.get(`${site}/api/v1/openapi.json`);
  expect(res.status()).toBe(200);
  expect((await res.json()).openapi).toMatch(/^3\./);
});
