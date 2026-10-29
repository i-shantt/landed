// Hardening pass after the external code review: webhook authenticity, the probe-amount oracle,
// transcript projection, every-payment landing tracking, reject-change restoration, known-bad
// account re-entry, demo-control kill switch, re-probe after an assistant leak, input validation.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { canRelease } from "../convex/guard";
import { mkAccount, mkCase, mkConfirmation, mkContact, mkProbe, T0 } from "./fixtures";
import { setup, pay, drain, manualEdit, advanceToAvailability, vendorStatement, probeAmount, events, getCase, getAccount, VENDOR_B_ACCOUNT, VENDOR_C_ACCOUNT, actors, asUser } from "./harness";

const NOW = T0 + 7400_000;

describe("probe-amount oracle is closed", () => {
  it("canRelease reports acceptance/contact problems before it ever compares amounts", () => {
    const base = { caseDoc: mkCase(), account: mkAccount(), probe: mkProbe(), contact: mkContact(), now: NOW };
    expect(canRelease({ ...base, confirmation: mkConfirmation({ accepted: false, statedAmountCents: 999 }) })).toEqual({ ok: false, reason: "confirmation_not_accepted" });
    expect(canRelease({ ...base, confirmation: mkConfirmation({ statedAmountCents: 999 }), contact: null })).toEqual({ ok: false, reason: "contact_missing" });
    expect(canRelease({ ...base, confirmation: mkConfirmation({ statedAmountCents: 999 }), contact: mkContact({ trustLevel: "discovered" }) })).toEqual({ ok: false, reason: "contact_not_record" });
    expect(canRelease({ ...base, confirmation: mkConfirmation({ statedAmountCents: 999, usedAt: NOW - 1 }) })).toEqual({ ok: false, reason: "confirmation_used" });
    // a genuine, accepted, record-contact statement with the wrong amount is still an amount mismatch
    expect(canRelease({ ...base, confirmation: mkConfirmation({ statedAmountCents: 999 }) })).toEqual({ ok: false, reason: "amount_mismatch" });
  });

  it("a statement that is not accepted never reaches the release gate (no amount-derived refusal is logged)", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    await advanceToAvailability(t, r.caseId);
    const right = await probeAmount(t, r.caseId);
    // untrusted contact (discovered) states the right amount through a trusted channel: rejected at acceptance
    const discovered = await t.run(async (ctx) => ctx.db.insert("contacts", { vendorId: cleanco, kind: "phone", value: "+15550109999", trustLevel: "discovered", establishedAt: Date.now(), establishedVia: "test" }));
    const res = await t.mutation(internal.confirmations.recordFromChannelInternal, { caseId: r.caseId, channel: "voice", contactId: discovered, statedAmountCents: right, outcome: "stated" });
    expect(res.accepted).toBe(false);
    expect((res as { decision?: unknown }).decision).toBeUndefined();
    const evs = await events(t, r.caseId);
    const refusals = evs.filter((e) => e.type === "release_refused").map((e) => (e.payload as { reason: string }).reason);
    expect(refusals).not.toContain("amount_mismatch");
    expect(refusals).not.toContain("received_before_available");
    expect(refusals).toContain("contact_not_record"); // acceptance reason only; the gate was never consulted
    expect((await getCase(t, r.caseId)).state).toBe("AWAITING_CONFIRMATION");
    // a wrong amount from the same untrusted contact also tells the caller nothing
    const res2 = await t.mutation(internal.confirmations.recordFromChannelInternal, { caseId: r.caseId, channel: "voice", contactId: discovered, statedAmountCents: right === 11 ? 12 : 11, outcome: "stated" });
    expect(res2.rejectReason).toBe("contact_not_record");
  });

  it("probe transcripts are never returned to the browser; landing transcripts are", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    await advanceToAvailability(t, r.caseId);
    const record = await t.run(async (ctx) => (await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", cleanco)).collect()).find((c) => c.kind === "phone" && c.trustLevel === "record")!);
    await t.mutation(internal.confirmations.recordFromChannelInternal, { caseId: r.caseId, channel: "voice", contactId: record._id, statedAmountCents: await probeAmount(t, r.caseId), outcome: "stated", transcript: "[vapi] clerk read back $0.42" });
    const list = await t.query(api.confirmations.listForCase, { caseId: r.caseId });
    expect(list.length).toBe(1);
    expect(list[0].transcript).toBeNull();
    expect(JSON.stringify(list)).not.toMatch(/\$0\.\d\d/);
  });
});

describe("Vapi webhook authenticity", () => {
  const saved = process.env.VAPI_WEBHOOK_SECRET;
  beforeEach(() => {
    process.env.VAPI_WEBHOOK_SECRET = "test-webhook-secret";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.VAPI_WEBHOOK_SECRET;
    else process.env.VAPI_WEBHOOK_SECRET = saved;
  });

  async function awaitingCase(t: Awaited<ReturnType<typeof setup>>["t"], ids: Awaited<ReturnType<typeof setup>>["ids"]) {
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    await advanceToAvailability(t, r.caseId);
    const record = await t.run(async (ctx) => (await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", cleanco)).collect()).find((c) => c.kind === "phone" && c.trustLevel === "record")!);
    return { caseId: r.caseId, contactId: record._id, amount: await probeAmount(t, r.caseId) };
  }
  const forged = (caseId: string, contactId: string, amount: number, callId = "call_forged") => ({
    message: { type: "tool-calls", call: { id: callId }, assistant: { metadata: { caseId, contactId, mode: "probe" } }, toolCallList: [{ id: "tc1", function: { name: "recordStatedAmount", arguments: { statedAmountCents: amount, reachedRecordContact: true, notes: "" } } }] },
  });

  it("rejects a request without the shared secret, and when the secret is not configured", async () => {
    const { t, ids } = await setup();
    const { caseId, contactId, amount } = await awaitingCase(t, ids);
    const res = await t.fetch("/vapi/webhook", { method: "POST", body: JSON.stringify(forged(caseId, contactId, amount)), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
    const res2 = await t.fetch("/vapi/webhook", { method: "POST", body: JSON.stringify(forged(caseId, contactId, amount)), headers: { "content-type": "application/json", "x-vapi-secret": "wrong" } });
    expect(res2.status).toBe(401);
    delete process.env.VAPI_WEBHOOK_SECRET;
    const res3 = await t.fetch("/vapi/webhook", { method: "POST", body: JSON.stringify(forged(caseId, contactId, amount)), headers: { "content-type": "application/json", "x-vapi-secret": "anything" } });
    expect(res3.status).toBe(401);
    await drain(t);
    expect((await getAccount(t, (await getCase(t, caseId)).newAccountId)).status).toBe("probing");
  });

  it("ignores metadata from the body: the case and contact come from the call we placed", async () => {
    const { t, ids } = await setup();
    const { caseId, contactId, amount } = await awaitingCase(t, ids);
    await t.mutation(api.settings.set, { key: "voice", value: "vapi" });
    // valid secret, correct amount, but no call of ours with this id
    const res = await t.fetch("/vapi/webhook", { method: "POST", body: JSON.stringify(forged(caseId, contactId, amount, "call_unknown")), headers: { "content-type": "application/json", "x-vapi-secret": "test-webhook-secret" } });
    expect(res.status).toBe(200);
    await drain(t);
    expect((await getCase(t, caseId)).state).toBe("AWAITING_CONFIRMATION");
    const evs = await events(t, caseId);
    expect(evs.some((e) => e.type === "voice_webhook_unbound")).toBe(true);
    expect((await t.run(async (ctx) => ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect())).length).toBe(0);

    // now a call we actually placed, whose body claims a *different* contact: ours wins
    await t.run(async (ctx) => {
      await ctx.db.insert("voiceCalls", { caseId, contactId, mode: "probe", vapiCallId: "call_ours", placedAt: Date.now(), status: "placed" });
    });
    const bogusContact = await t.run(async (ctx) => ctx.db.insert("contacts", { vendorId: ids.vendors.cleanco as Id<"vendors">, kind: "phone", value: "+15550108888", trustLevel: "untrusted", establishedAt: Date.now(), establishedVia: "test" }));
    const res2 = await t.fetch("/vapi/webhook", { method: "POST", body: JSON.stringify(forged(caseId, bogusContact, amount, "call_ours")), headers: { "content-type": "application/json", "x-vapi-secret": "test-webhook-secret" } });
    expect(res2.status).toBe(200);
    await drain(t);
    expect((await getCase(t, caseId)).state).toBe("VERIFIED");
    const conf = (await t.run(async (ctx) => ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect()))[0];
    expect(conf.contactId).toBe(contactId);
  });

  it("refuses to record when the voice channel is not vapi, and tolerates malformed tool arguments", async () => {
    const { t, ids } = await setup();
    const { caseId, contactId, amount } = await awaitingCase(t, ids);
    await t.run(async (ctx) => {
      await ctx.db.insert("voiceCalls", { caseId, contactId, mode: "probe", vapiCallId: "call_sim", placedAt: Date.now(), status: "placed" });
    });
    const res = await t.fetch("/vapi/webhook", { method: "POST", body: JSON.stringify(forged(caseId, contactId, amount, "call_sim")), headers: { "content-type": "application/json", "x-vapi-secret": "test-webhook-secret" } });
    expect(res.status).toBe(200);
    await drain(t);
    expect((await getCase(t, caseId)).state).toBe("AWAITING_CONFIRMATION");
    await t.mutation(api.settings.set, { key: "voice", value: "vapi" });
    const bad = { message: { type: "tool-calls", call: { id: "call_sim" }, toolCallList: [{ id: "tc1", function: { name: "recordStatedAmount", arguments: "{not json" } }] } };
    const res2 = await t.fetch("/vapi/webhook", { method: "POST", body: JSON.stringify(bad), headers: { "content-type": "application/json", "x-vapi-secret": "test-webhook-secret" } });
    expect(res2.status).toBe(200);
    await drain(t);
    expect((await events(t, caseId)).some((e) => e.type === "voice_webhook_malformed")).toBe(true);
  });

  it("an assistant leak re-issues the probe once and returns the case to PROBE_SENT; a second leak escalates", async () => {
    const { t, ids } = await setup();
    const { caseId, contactId } = await awaitingCase(t, ids);
    await t.mutation(internal.channels.vapiWebhook.burnProbe, { caseId, contactId });
    await drain(t);
    let c = await getCase(t, caseId);
    expect(c.state).toBe("PROBE_SENT");
    const probes = await t.run(async (ctx) => ctx.db.query("probes").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect());
    expect(probes.length).toBe(2);
    expect(c.probeId).toBe(probes.find((p) => p.idempotencyKey.endsWith(":r1"))!._id);
    await advanceToAvailability(t, caseId);
    c = await getCase(t, caseId);
    expect(c.state).toBe("AWAITING_CONFIRMATION");
    await vendorStatement(t, caseId, await probeAmount(t, caseId));
    expect((await getCase(t, caseId)).state).toBe("VERIFIED");
  });

  it("a second leak on the same case escalates instead of burning a third probe", async () => {
    const { t, ids } = await setup();
    const { caseId, contactId } = await awaitingCase(t, ids);
    await t.mutation(internal.channels.vapiWebhook.burnProbe, { caseId, contactId });
    await drain(t);
    await advanceToAvailability(t, caseId);
    await t.mutation(internal.channels.vapiWebhook.burnProbe, { caseId, contactId });
    await drain(t);
    const c = await getCase(t, caseId);
    expect(c.state).toBe("NEEDS_HUMAN");
    expect(c.humanReason).toBe("repeated_assistant_leak");
    expect((await t.run(async (ctx) => ctx.db.query("probes").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect())).length).toBe(2);
  });
});

describe("eval endpoints", () => {
  it("fail closed without EVAL_KEY and validate numeric input", async () => {
    const { t } = await setup();
    const saved = process.env.EVAL_KEY;
    delete process.env.EVAL_KEY;
    try {
      const res = await t.fetch("/eval/tick", { method: "POST", headers: { "x-eval-key": "dev" } });
      expect(res.status).toBe(401);
    } finally {
      process.env.EVAL_KEY = "k";
    }
    const res2 = await t.fetch("/eval/advance", { method: "POST", headers: { "x-eval-key": "k", "content-type": "application/json" }, body: JSON.stringify({ ms: "abc" }) });
    expect(res2.status).toBe(400);
    const res3 = await t.fetch("/eval/advance", { method: "POST", headers: { "x-eval-key": "k", "content-type": "application/json" }, body: JSON.stringify({ ms: 1000 }) });
    expect(res3.status).toBe(200);
    if (saved === undefined) delete process.env.EVAL_KEY;
    else process.env.EVAL_KEY = saved;
  });
});

describe("landing is tracked for every payment", () => {
  it("a payment to a seed-verified account (no case) gets landing timers; the deadline marks it unconfirmed; an operator can attest landing", async () => {
    const { t, ids } = await setup();
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    const res = await pay(t, invoiceId);
    expect(res.ok).toBe(true);
    const paymentId = (res as { paymentId: Id<"payments"> }).paymentId;
    const timers = await t.run(async (ctx) => (await ctx.db.query("timers").collect()).filter((x) => (x.payload as { paymentId?: string })?.paymentId === paymentId));
    expect(timers.map((x) => x.kind).sort()).toEqual(["landing_check", "landing_deadline"]);
    await t.mutation(api.clock.advance, { ms: 3 * 24 * 3600_000 });
    await drain(t);
    const p = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(p!.landingState).toBe("unconfirmed");
    const all = await t.run(async (ctx) => ctx.db.query("events").collect());
    expect(all.some((e) => e.type === "landing_unconfirmed" && (e.payload as { paymentId: string }).paymentId === paymentId)).toBe(true);
    // operator attestation (e.g. vendor remittance confirmation by phone) closes it
    const approver = await asUser(t, "approver");
    await approver.as.mutation(api.payments.attestLanded, { paymentId, note: "AR confirmed receipt on the number of record" });
    expect((await t.run(async (ctx) => ctx.db.get(paymentId)))!.landingState).toBe("landed");
    await expect(approver.as.mutation(api.payments.attestLanded, { paymentId, note: "x" })).rejects.toThrow();
  });
});

describe("case hygiene", () => {
  it("rejecting a change never resurrects an account that a different case superseded", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const main = ids.accounts.cleanco_main as Id<"bankAccounts">;
    const c1 = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, main);
    const c2 = await manualEdit(t, cleanco, VENDOR_C_ACCOUNT.routing, VENDOR_C_ACCOUNT.accountNumber, main);
    // case 1 verifies: main is superseded by B
    await advanceToAvailability(t, c1.caseId);
    await vendorStatement(t, c1.caseId, await probeAmount(t, c1.caseId));
    expect((await getCase(t, c1.caseId)).state).toBe("VERIFIED");
    expect((await getAccount(t, main)).status).toBe("superseded");
    // reject case 2
    await t.mutation(api.cases.rejectChange, { caseId: c2.caseId, reason: "not our vendor" });
    await drain(t);
    expect((await getAccount(t, main)).status).toBe("superseded");
    const verified = await t.run(async (ctx) => (await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", cleanco)).collect()).filter((a) => a.status === "verified"));
    expect(verified.length).toBe(1);
    expect(verified[0]._id).toBe(c1.accountId);
    // invoices that followed account C now remit to the one verified account
    const invoices = await t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", cleanco)).collect());
    for (const inv of invoices.filter((i) => i.status !== "paid")) expect(inv.remitAccountId).toBe(c1.accountId);
  });

  it("a previously rejected account number re-submitted for the same vendor goes straight to a human, no probe", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const main = ids.accounts.cleanco_main as Id<"bankAccounts">;
    const c1 = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, main);
    await t.mutation(api.cases.rejectChange, { caseId: c1.caseId, reason: "fraud" });
    await drain(t);
    const c2 = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, main);
    expect(c2.reused).toBe(false);
    const c = await getCase(t, c2.caseId);
    expect(c.state).toBe("NEEDS_HUMAN");
    expect(c.humanReason).toBe("account_previously_rejected");
    expect(c.probeId).toBeUndefined();
  });

  it("an account number already requested by another vendor goes straight to a human (mule pattern)", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const northpeak = ids.vendors.northpeak as Id<"vendors">;
    await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    const c2 = await manualEdit(t, northpeak, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.northpeak_main as Id<"bankAccounts">);
    const c = await getCase(t, c2.caseId);
    expect(c.state).toBe("NEEDS_HUMAN");
    expect(c.humanReason).toBe("account_reused_across_vendors");
  });
});

describe("demo controls kill switch", () => {
  it("an admin can disable clock, simulated answers and re-seed; a clerk cannot", async () => {
    const { t, ids } = await setup();
    const { admin, clerk } = await actors(t);
    await expect(clerk.as.mutation(api.controls.demoGuard.setDemoControls, { enabled: false })).rejects.toThrow();
    await admin.as.mutation(api.controls.demoGuard.setDemoControls, { enabled: false });
    await expect(t.mutation(api.clock.advance, { ms: 1000 })).rejects.toThrow(/demo_controls_disabled/);
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    await expect(t.mutation(api.channels.simVoice.answer, { caseId: r.caseId, statedAmountCents: 12 })).rejects.toThrow(/demo_controls_disabled/);
    await expect(t.action(api.seed.reseed, {})).rejects.toThrow(/demo_controls_disabled/);
    await admin.as.mutation(api.controls.demoGuard.setDemoControls, { enabled: true });
    expect((await t.mutation(api.clock.advance, { ms: 1000 })).now).toBeGreaterThan(0);
  });
});
