import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, manualEdit, VENDOR_B_ACCOUNT } from "./harness";

describe("timerQueries", () => {
  it("nextOfKind / nextByKind return the pending probe timers for a new case", async () => {
    const { t, ids } = await setup();
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    const settle = await t.query(api.timerQueries.nextOfKind, { kind: "probe_settle" });
    const avail = await t.query(api.timerQueries.nextOfKind, { kind: "probe_available" });
    expect(settle?.caseId).toBe(r.caseId);
    expect(avail?.caseId).toBe(r.caseId);
    expect(avail!.dueAt).toBeGreaterThan(settle!.dueAt);
    const byKind = await t.query(api.timerQueries.nextByKind, {});
    expect(byKind.probe_settle.dueAt).toBe(settle!.dueAt);
    expect(await t.query(api.timerQueries.nextOfKind, { kind: "landing_check" })).toBeNull();
  });
});
