// Read-only projections of payments for the ledger page (additive).
import { query } from "./_generated/server";

export const listDetailed = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("payments").order("desc").take(200);
    const out = [];
    for (const p of rows) {
      const [vendor, invoice, dest, c] = await Promise.all([ctx.db.get(p.vendorId), ctx.db.get(p.invoiceId), ctx.db.get(p.destinationAccountId), p.caseId ? ctx.db.get(p.caseId) : null]);
      out.push({
        _id: p._id,
        sentAt: p.sentAt,
        vendorId: p.vendorId,
        vendorName: vendor?.name ?? "?",
        invoiceNumber: invoice?.number ?? "?",
        amountCents: p.amountCents,
        rail: p.rail,
        railRef: p.railRef ?? null,
        destination: dest ? { routing: dest.routing, last4: dest.accountLast4, version: dest.version } : null,
        landingState: p.landingState,
        landingDeadlineAt: p.landingDeadlineAt,
        caseId: p.caseId ?? null,
        caseState: c?.state ?? null,
        initiatedBy: p.initiatedBy,
      });
    }
    return out;
  },
});
