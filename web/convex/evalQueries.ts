// Internal projections for the eval HTTP endpoints. No probe amounts (except the
// documented test-only amountForTest in probes.ts).
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { projectAccount } from "./bankAccounts";

export const caseView = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const newAccount = await ctx.db.get(c.newAccountId);
    const oldAccount = c.oldAccountId ? await ctx.db.get(c.oldAccountId) : null;
    const probe = c.probeId ? await ctx.db.get(c.probeId) : null;
    const confirmations = await ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const events = await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const payments = await ctx.db.query("payments").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const pkg = await ctx.db.query("packages").withIndex("by_case", (q) => q.eq("caseId", caseId)).first();
    const timers = await ctx.db.query("timers").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    return {
      case: c,
      newAccount: newAccount ? projectAccount(newAccount) : null,
      oldAccount: oldAccount ? projectAccount(oldAccount) : null,
      probe: probe ? { state: probe.state, submittedAt: probe.submittedAt, settledAt: probe.settledAt, availableAt: probe.availableAt, railRef: probe.railRef ?? null } : null,
      confirmations: confirmations.map((x) => ({ _id: x._id, channel: x.channel, accepted: x.accepted, rejectReason: x.rejectReason ?? null, receivedAt: x.receivedAt, usedAt: x.usedAt ?? null, mode: x.mode ?? "probe", hasStatedAmount: x.statedAmountCents !== undefined })),
      events: events.sort((a, b) => a.at - b.at).map((e) => ({ at: e.at, actor: e.actor, type: e.type, payload: e.payload })),
      payments: payments.map((p) => ({ _id: p._id, amountCents: p.amountCents, rail: p.rail, landingState: p.landingState, sentAt: p.sentAt, railRef: p.railRef ?? null })),
      package: pkg ? { generatedAt: pkg.generatedAt, eligibility: pkg.fields?.eligibility ?? null } : null,
      timers: timers.map((t) => ({ kind: t.kind, dueAt: t.dueAt, fired: t.fired })),
    };
  },
});

export const vendorView = internalQuery({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    const vnd = await ctx.db.get(vendorId);
    if (!vnd) return null;
    const contacts = await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const accounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const cases = await ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    return { vendor: vnd, contacts, accounts: accounts.map(projectAccount), invoices, cases: cases.sort((a, b) => b.openedAt - a.openedAt) };
  },
});

export const vendorBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const byslug = await ctx.db.query("vendors").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (byslug) return byslug;
    const all = await ctx.db.query("vendors").collect();
    return all.find((x) => x.domain.split(".")[0] === slug) ?? null;
  },
});

export const invoiceByNumber = internalQuery({
  args: { number: v.string() },
  handler: async (ctx, { number }) => ctx.db.query("invoices").withIndex("by_number", (q) => q.eq("number", number)).first(),
});

export const overview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cases = await ctx.db.query("cases").collect();
    const payments = await ctx.db.query("payments").collect();
    const clock = await ctx.db.query("clock").first();
    const settings = await ctx.db.query("settings").collect();
    return {
      cases: cases.sort((a, b) => b.openedAt - a.openedAt).map((c) => ({ _id: c._id, vendorId: c.vendorId, state: c.state, triggerType: c.triggerType, newAccountId: c.newAccountId, openedAt: c.openedAt, humanReason: c.humanReason ?? null })),
      payments: payments.map((p) => ({ _id: p._id, invoiceId: p.invoiceId, destinationAccountId: p.destinationAccountId, amountCents: p.amountCents, landingState: p.landingState, initiatedBy: p.initiatedBy })),
      clock: clock ? { mode: clock.mode, offsetMs: clock.offsetMs, now: Date.now() + (clock.mode === "demo" ? clock.offsetMs : 0) } : null,
      settings: Object.fromEntries(settings.filter((s) => !s.key.startsWith("simVendorStatement:")).map((s) => [s.key, s.value])),
    };
  },
});

export const reportRun = internalMutation({
  args: { results: v.array(v.any()) },
  handler: async (ctx, { results }) => {
    for (const r of results as { scenarioId: string; startedAt: number; finishedAt?: number; expected: unknown; actual: unknown; passed?: boolean; metrics?: unknown }[]) {
      const existing = await ctx.db.query("evalRuns").withIndex("by_scenario", (q) => q.eq("scenarioId", r.scenarioId)).first();
      const row = { scenarioId: r.scenarioId, startedAt: r.startedAt, finishedAt: r.finishedAt, expected: r.expected, actual: r.actual, passed: r.passed, metrics: r.metrics };
      if (existing) await ctx.db.replace(existing._id, row);
      else await ctx.db.insert("evalRuns", row);
    }
    return results.length;
  },
});

export const listRuns = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("evalRuns").collect(),
});
