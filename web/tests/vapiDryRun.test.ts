import { describe, it, expect, afterEach } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, manualEdit, advanceToAvailability, events, VENDOR_B_ACCOUNT } from "./harness";

describe("VapiVoice dry run", () => {
  afterEach(() => { delete process.env.VAPI_DRY_RUN; delete process.env.TEST_PHONE_NUMBERS; });

  it("with VOICE=vapi and VAPI_DRY_RUN=1, builds the request, logs voice_dry_run, dials nothing, and the assistant config has no amount", async () => {
    const { t, ids } = await setup();
    process.env.VAPI_DRY_RUN = "1";
    process.env.TEST_PHONE_NUMBERS = "+15550100001";
    await t.mutation(internal.settingsInternal.setInternal, { key: "voice", value: "vapi" });
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    await advanceToAvailability(t, r.caseId);
    const ev = await events(t, r.caseId);
    const dry = ev.find((e) => e.type === "voice_dry_run");
    expect(dry, ev.map((e) => e.type).join(",")).toBeDefined();
    const payload = dry!.payload as { assistantContainsAmount: boolean; request: { customer: { number: string } } };
    expect(payload.assistantContainsAmount).toBe(false);
    expect(payload.request.customer.number).toMatch(/\*+\d{4}$/);
    expect(ev.some((e) => e.type === "voice_call_placed")).toBe(false);
  });

  it("refuses numbers outside TEST_PHONE_NUMBERS even in dry run", async () => {
    const { t, ids } = await setup();
    process.env.VAPI_DRY_RUN = "1";
    process.env.TEST_PHONE_NUMBERS = "+15559999999";
    await t.mutation(internal.settingsInternal.setInternal, { key: "voice", value: "vapi" });
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    await advanceToAvailability(t, r.caseId);
    const ev = await events(t, r.caseId);
    expect(ev.some((e) => e.type === "voice_call_refused")).toBe(true);
    expect(ev.some((e) => e.type === "voice_dry_run")).toBe(false);
  });
});
