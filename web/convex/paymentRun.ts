// Payment run (additive, read-only evaluation): every open invoice with its destination and the
// guard's decision, computed with the same pure `canPay` the payment mutation uses. Nothing here
// writes; "Run payable" on the page calls payments.send per line (human-initiated, sequential).
import { query } from "./_generated/server";
import { canPay } from "./guard";
import { evaluatePaymentPolicy, type PolicyDecision } from "./controls/policy";
import { now } from "./clock";

export const preview = query({
  args: {},
  handler: async (ctx) => {
    const invoices = (await ctx.db.query("invoices").collect()).filter((i) => i.status !== "paid");
    const t = await now(ctx);
    const lines = [];
    for (const inv of invoices) {
      const vendor = await ctx.db.get(inv.vendorId);
      const dest = await ctx.db.get(inv.remitAccountId);
      let current: number | null = null;
      if (dest) {
        const latest = await ctx.db.query("bankAccounts").withIndex("by_identity", (q) => q.eq("identityKey", dest.identityKey)).order("desc").first();
        current = latest ? latest.version : null;
      }
      const decision = canPay({ invoice: inv, destination: dest, currentVersionForIdentity: current });
      const cases = dest ? await ctx.db.query("cases").withIndex("by_newAccount", (q) => q.eq("newAccountId", dest._id)).collect() : [];
      const openCase = cases.find((c) => c.state !== "CLOSED") ?? null;
      // Policy is only meaningful once the guard passes; evaluated with the same function payments.send uses.
      let policy: PolicyDecision | null = null;
      if (decision.ok && dest) {
        try {
          policy = await evaluatePaymentPolicy(ctx, { invoice: inv, destination: dest, rail: "ach", now: t });
        } catch {
          policy = { ok: false, reason: "policy_approval_required" };
        }
        policy = policy.ok ? { ok: true } : { ok: false, reason: policy.reason };
      }
      lines.push({
        policy,
        invoiceId: inv._id, number: inv.number, vendorId: inv.vendorId, vendorName: vendor?.name ?? "?", amountCents: inv.amountCents, dueAt: inv.dueAt, status: inv.status,
        destination: dest ? { routing: dest.routing, last4: dest.accountLast4, version: dest.version, status: dest.status, currentVersion: current } : null,
        decision, caseId: openCase?._id ?? null, caseState: openCase?.state ?? null,
      });
    }
    lines.sort((a, b) => a.dueAt - b.dueAt);
    const payable = lines.filter((l) => l.decision.ok && (l.policy === null || l.policy.ok));
    const needsApproval = lines.filter((l) => l.decision.ok && l.policy !== null && !l.policy.ok);
    const blocked = lines.filter((l) => !l.decision.ok);
    return {
      lines,
      totals: {
        payableCents: payable.reduce((s, l) => s + l.amountCents, 0),
        blockedCents: blocked.reduce((s, l) => s + l.amountCents, 0),
        needsApprovalCents: needsApproval.reduce((s, l) => s + l.amountCents, 0),
        payable: payable.length,
        blocked: blocked.length,
        needsApproval: needsApproval.length,
      },
    };
  },
});
