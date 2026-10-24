// Demo-state seeding (additive). After a full re-seed, creates the three pre-run cases
// the pitch needs, by driving the real engine (no shortcuts, no direct state writes):
//   1. NorthPeak: a legitimate change, probe confirmed by the contact of record, paid, landed, CLOSED
//   2. Granite Ridge: a fraudulent change, vendor of record saw nothing, marked fraud -> RECOVERY with a package
//   3. Bluewater: bank and phone changed in the same request -> NEEDS_HUMAN, no probe
// Case ids are recorded in settings.demoCases for the /cases "Demo cases" group.
// Opt-in: /eval/reset {demo:true} (Settings re-seed and scripts/prod-seed.mjs pass it); the eval
// runner and judge mode do not, so their timings are unaffected.
import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const vendorIdBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => (await ctx.db.query("vendors").withIndex("by_slug", (q) => q.eq("slug", slug)).unique())?._id ?? null,
});

export const caseTimers = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    const timers = await ctx.db.query("timers").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const payment = c?.paymentId ? await ctx.db.get(c.paymentId) : null;
    return { state: c?.state ?? null, timers: timers.filter((t) => !t.fired).map((t) => ({ kind: t.kind, dueAt: t.dueAt })), paymentAmount: payment?.amountCents ?? null };
  },
});

export const openInvoiceFor = internalQuery({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    const rows = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    return rows.filter((i) => i.status !== "paid").sort((a, b) => a.dueAt - b.dueAt)[0]?._id ?? null;
  },
});

export const createDemoCases = internalAction({
  args: {},
  handler: async (ctx): Promise<{ caseId: string; label: string }[]> => {
    const t0 = Date.now();
    const vid = async (slug: string) => {
      const id = await ctx.runQuery(internal.seedDemo.vendorIdBySlug, { slug });
      if (!id) throw new Error(`demo seed: vendor ${slug} missing`);
      return id;
    };
    const northpeak = await vid("northpeak");
    const granite = await vid("graniteridge");
    const bluewater = await vid("bluewatertextiles");

    // Give NorthPeak an open invoice so the legit case can be paid and land.
    const npInvoice = await ctx.runMutation(internal.evalQueries.craftInvoice, { vendorId: northpeak, remitAccountId: (await currentAccount(northpeak)) as Id<"bankAccounts">, number: "NP-2026-0310", amountCents: 1_825_000 });

    // Open invoices for the fraud and combo vendors, so the demo cases show an amount at stake (held).
    await ctx.runMutation(internal.evalQueries.craftInvoice, { vendorId: granite, remitAccountId: (await currentAccount(granite)) as Id<"bankAccounts">, number: "GR-2026-0144", amountCents: 2_340_000 });
    await ctx.runMutation(internal.evalQueries.craftInvoice, { vendorId: bluewater, remitAccountId: (await currentAccount(bluewater)) as Id<"bankAccounts">, number: "BT-2026-0177", amountCents: 985_000 });

    // 1. Legit change (NorthPeak), 2. fraud (Granite Ridge): both probes queue for the same ACH window.
    const legit = await ctx.runAction(internal.bankAccounts.createUnverified, { vendorId: northpeak, routing: "026009593", accountNumberPlain: "7712003456", createdVia: "intake" });
    const fraud = await ctx.runAction(internal.bankAccounts.createUnverified, { vendorId: granite, routing: "011000015", accountNumberPlain: "900012345678", createdVia: "intake" });
    // 3. Bank + phone changed together (Bluewater): straight to a human, no probe.
    const combo = await ctx.runAction(internal.bankAccounts.createUnverified, { vendorId: bluewater, routing: "031000503", accountNumberPlain: "4455667788", createdVia: "intake", contactAlsoChanged: true });
    if (combo.caseId) await ctx.runMutation(internal.contacts.addUntrustedContact, { vendorId: bluewater, kind: "phone", value: "+14155550199", caseId: combo.caseId });
    if (!legit.caseId || !fraud.caseId || !combo.caseId) throw new Error("demo seed: case not opened");
    await sleep(1500);

    // Script the vendor answers before the (simulated) calls are placed, then advance to availability once.
    await ctx.runMutation(internal.channels.simVoice.answerInternal, { caseId: fraud.caseId, statedAmountCents: null, outcome: "nothing_arrived" });
    const amt = await ctx.runQuery(internal.probes.amountForTest, { caseId: legit.caseId }); // server-side only
    if (amt !== null) await ctx.runMutation(internal.channels.simVoice.answerInternal, { caseId: legit.caseId, statedAmountCents: amt, outcome: "stated" });
    await advanceToTimer(legit.caseId, "probe_available");
    await sleep(2500);

    // Legit: pay, then the landing check, then the vendor confirms the full amount.
    const pay = await ctx.runMutation(api.payments.send, { invoiceId: npInvoice, initiatedBy: "demo-clerk", rail: "ach" });
    if (!pay.ok) throw new Error(`demo seed: pay refused ${pay.reason}`);
    await sleep(1000);
    await advanceToTimer(legit.caseId, "landing_check");
    await sleep(2000);
    const info = await ctx.runQuery(internal.seedDemo.caseTimers, { caseId: legit.caseId });
    await ctx.runMutation(internal.channels.simVoice.answerInternal, { caseId: legit.caseId, statedAmountCents: info.paymentAmount, outcome: "stated", mode: "landing" });

    // Fraud: human marks fraud -> RECOVERY + package.
    await ctx.runMutation(api.cases.markFraud, { caseId: fraud.caseId, reason: "Granite Ridge AR confirmed by phone that they never requested a change" });

    const demo = [
      { caseId: legit.caseId, label: "Legitimate change: verified, paid, landed" },
      { caseId: fraud.caseId, label: "Fraud: nothing arrived, recovery package" },
      { caseId: combo.caseId, label: "Bank and phone changed together: needs a human" },
    ];
    await ctx.runMutation(internal.settingsInternal.setInternal, { key: "demoCases", value: JSON.stringify(demo) });
    await ctx.runMutation(internal.settingsInternal.setInternal, { key: "demoSeededAt", value: String(Date.now()) });
    console.log(`[seedDemo] demo cases ready in ${Date.now() - t0} ms`);
    return demo;

    async function currentAccount(vendorId: Id<"vendors">) {
      const vi = await ctx.runQuery(internal.evalQueries.vendorView, { vendorId });
      return vi?.accounts.find((a) => a.status === "verified")?._id;
    }
    async function advanceToTimer(caseId: Id<"cases">, kind: string) {
      const info = await ctx.runQuery(internal.seedDemo.caseTimers, { caseId });
      const t = info.timers.find((x) => x.kind === kind);
      if (!t) throw new Error(`demo seed: no ${kind} timer`);
      await ctx.runMutation(api.clock.advanceTo, { at: t.dueAt + 1000 });
    }
  },
});
