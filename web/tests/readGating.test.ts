// Reads behind the session. Every workspace query requires a signed-in operator; the short allowlist of public
// reads (operators.me, the two portal queries, health.status, evalRuns.list, settings.demoCases) is checked here
// and enforced statically in security.test.ts.
import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setup, actors, manualEdit, VENDOR_B_ACCOUNT } from "./harness";
import type { Id } from "../convex/_generated/dataModel";
import type { FunctionReference } from "convex/server";

describe("public reads: the allowlist exposes nothing beyond what the public pages need", () => {
  it("settings.demoCases returns only the demo-case list, signed out, and null before the demo is seeded", async () => {
    const { t } = await setup();
    expect(await t.query(api.settings.demoCases, {})).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", { key: "demoCases", value: JSON.stringify([{ caseId: "c1", label: "Fraud" }]) });
      await ctx.db.insert("settings", { key: "policy", value: "{}" });
    });
    const raw = await t.query(api.settings.demoCases, {});
    expect(JSON.parse(raw!)).toEqual([{ caseId: "c1", label: "Fraud" }]);
  });
});

describe("the public allowlist keeps working signed out", () => {
  it("health.status, evalRuns.list and operators.me (null) answer without a session; a workspace read next to them does not", async () => {
    const { t } = await setup();
    expect((await t.query(api.health.status, {})).cases.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(await t.query(api.evalRuns.list, {}))).toBe(true);
    expect(await t.query(api.controls.operators.me, {})).toBeNull();
    await expect(t.query(api.controls.operators.list, {})).rejects.toThrow(/unauthenticated/);
    await expect(t.query(api.settings.all, {})).rejects.toThrow(/unauthenticated/);
  });
});

describe("core reads require a session (SECURITY.md → Reads)", () => {
  it("the fourteen core queries refuse a signed-out caller with `unauthenticated` and serve a clerk", async () => {
    const { t, ids } = await setup();
    const { clerk } = await actors(t);
    const vendorId = ids.vendors.cleanco as Id<"vendors">;
    const accountId = ids.accounts.cleanco_main as Id<"bankAccounts">;
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    const { caseId } = await manualEdit(t, vendorId, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reads: [string, FunctionReference<"query", "public", any, any>, Record<string, unknown>][] = [
      ["bankAccounts.listForVendor", api.bankAccounts.listForVendor, { vendorId }],
      ["bankAccounts.get", api.bankAccounts.get, { accountId }],
      ["cases.list", api.cases.list, {}],
      ["cases.get", api.cases.get, { caseId }],
      ["clock.get", api.clock.get, {}],
      ["confirmations.listForCase", api.confirmations.listForCase, { caseId }],
      ["contacts.listForVendor", api.contacts.listForVendor, { vendorId }],
      ["events.listForCase", api.events.listForCase, { caseId }],
      ["events.recent", api.events.recent, {}],
      ["payments.listForInvoice", api.payments.listForInvoice, { invoiceId }],
      ["payments.list", api.payments.list, {}],
      ["probes.getPublic", api.probes.getPublic, { caseId }],
      ["timers.pendingForCase", api.timers.pendingForCase, { caseId }],
      ["timers.nextDue", api.timers.nextDue, {}],
    ];
    expect(reads.length).toBe(14);
    for (const [name, ref, args] of reads) {
      await expect(t.query(ref, args), `${name} signed out`).rejects.toThrow(/unauthenticated/);
      const served = await clerk.as.query(ref, args);
      expect(served, `${name} as clerk`).not.toBeUndefined();
    }
    const view = await clerk.as.query(api.cases.get, { caseId });
    expect(view?.vendor?.name).toMatch(/^CleanCo/);
    expect((await clerk.as.query(api.cases.list, {})).some((c) => c._id === caseId)).toBe(true);
  });

  it("the internal twins serve the REST layer and the demo seed without a session", async () => {
    const { t, ids } = await setup();
    const { caseId } = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    expect((await t.query(internal.cases.getInternal, { caseId }))?.state).toBe("PROBE_SENT");
    expect((await t.query(internal.cases.listInternal, {})).some((c) => c._id === caseId)).toBe(true);
    expect((await t.query(internal.events.listForCaseInternal, { caseId })).length).toBeGreaterThan(0);
    expect(Array.isArray(await t.query(internal.payments.listInternal, {}))).toBe(true);
    expect(typeof (await t.query(internal.clock.getInternal, {})).now).toBe("number");
  });
});
