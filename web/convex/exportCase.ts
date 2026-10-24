// Case audit export (read-only): JSON for the timeline, confirmations (no amounts),
// accounts (last four), payment, and the package if present. The page renders a
// printable HTML view from the same object. Additive; no core file touched.
import { query } from "./_generated/server";
import { v } from "convex/values";

export const caseExport = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const vendor = await ctx.db.get(c.vendorId);
    const company = await ctx.db.query("company").first();
    const newAccount = await ctx.db.get(c.newAccountId);
    const oldAccount = c.oldAccountId ? await ctx.db.get(c.oldAccountId) : null;
    const probe = c.probeId ? await ctx.db.get(c.probeId) : null;
    const payment = c.paymentId ? await ctx.db.get(c.paymentId) : null;
    const events = (await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect()).sort((a, b) => a.at - b.at);
    const confirmations = (await ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect()).sort((a, b) => a.receivedAt - b.receivedAt);
    const pkg = await ctx.db.query("packages").withIndex("by_case", (q) => q.eq("caseId", caseId)).first();
    const acct = (a: typeof newAccount) => (a ? { routing: a.routing, last4: a.accountLast4, version: a.version, status: a.status, createdVia: a.createdVia } : null);
    const contacts: Record<string, { kind: string; trustLevel: string }> = {};
    for (const x of confirmations) {
      if (x.contactId && !contacts[x.contactId]) {
        const k = await ctx.db.get(x.contactId);
        if (k) contacts[x.contactId] = { kind: k.kind, trustLevel: k.trustLevel };
      }
    }
    return {
      exportedAt: Date.now(),
      company: company?.name ?? null,
      vendor: vendor ? { name: vendor.name, domain: vendor.domain } : null,
      case: { id: c._id, state: c.state, triggerType: c.triggerType, openedAt: c.openedAt, closedAt: c.closedAt ?? null, humanReason: c.humanReason ?? null, validationProviderResult: c.validationProviderResult ?? null },
      accounts: { requested: acct(newAccount), prior: acct(oldAccount) },
      probe: probe ? { state: probe.state, submittedAt: probe.submittedAt, settledAt: probe.settledAt ?? null, availableAt: probe.availableAt ?? null, railRef: probe.railRef ?? null, note: "amount withheld" } : null,
      confirmations: confirmations.map((x) => ({ channel: x.channel, accepted: x.accepted, rejectReason: x.rejectReason ?? null, receivedAt: x.receivedAt, usedAt: x.usedAt ?? null, mode: x.mode ?? "probe", contact: x.contactId ? contacts[x.contactId] ?? null : null, statedAmountCents: x.mode === "landing" ? x.statedAmountCents ?? null : undefined })),
      payment: payment ? { amountCents: payment.amountCents, rail: payment.rail, railRef: payment.railRef ?? null, sentAt: payment.sentAt, landingState: payment.landingState, landingDeadlineAt: payment.landingDeadlineAt, initiatedBy: payment.initiatedBy } : null,
      timeline: events.map((e) => ({ at: e.at, actor: e.actor, type: e.type, payload: e.payload })),
      package: pkg ? { generatedAt: pkg.generatedAt, fields: pkg.fields, markdown: pkg.markdown } : null,
    };
  },
});
