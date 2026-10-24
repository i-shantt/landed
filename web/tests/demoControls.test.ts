import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, manualEdit, getCase, drain, VENDOR_B_ACCOUNT } from "./harness";

describe("demoControls.fastForward", () => {
  it("one click takes a PROBE_SENT case to AWAITING_CONFIRMATION (settle fires on the way)", async () => {
    const { t, ids } = await setup();
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    const next = await t.query(api.demoControls.nextStep, { caseId: r.caseId });
    expect(next?.kind).toBe("probe_available");
    const res = await t.mutation(api.demoControls.fastForward, { caseId: r.caseId });
    await drain(t);
    expect(res.advanced).toBe(true);
    expect(res.fired).toBeGreaterThanOrEqual(2);
    expect((await getCase(t, r.caseId)).state).toBe("AWAITING_CONFIRMATION");
    const after = await t.query(api.demoControls.nextStep, { caseId: r.caseId });
    expect(after?.kind).toBe("confirmation_sla");
  });
});
