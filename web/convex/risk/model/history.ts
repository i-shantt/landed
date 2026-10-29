// Shared payment history for model features and monitoring. Read-only.
// Landed's seed never writes `payments` (payments.send is the only writer), so seeded vendor history
// is `invoices` with status "paid" and no payment row. Those are merged in, anchored at `issuedAt`
// (documented approximation: the invoice date stands in for the unknown payment date) and tagged
// `source: "invoice_history"`, so baselines and velocity see the same past the dashboard shows.
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { HistoryRow } from "./features";

export async function loadHistory(ctx: QueryCtx | MutationCtx, opts: { vendorId?: Id<"vendors">; before?: number } = {}): Promise<HistoryRow[]> {
  const [payments, invoices] = await Promise.all([
    opts.vendorId ? ctx.db.query("payments").withIndex("by_vendor", (q) => q.eq("vendorId", opts.vendorId!)).collect() : ctx.db.query("payments").collect(),
    opts.vendorId ? ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", opts.vendorId!)).collect() : ctx.db.query("invoices").collect(),
  ]);
  const paidInvoiceIds = new Set(payments.map((p) => p.invoiceId as string));
  const rows: HistoryRow[] = [];
  for (const p of payments) rows.push({ vendorId: p.vendorId, destinationAccountId: p.destinationAccountId, amountCents: p.amountCents, at: p.sentAt, source: "payment" });
  for (const i of invoices) {
    if (i.status !== "paid" || paidInvoiceIds.has(i._id as string)) continue;
    rows.push({ vendorId: i.vendorId, destinationAccountId: i.remitAccountId, amountCents: i.amountCents, at: i.issuedAt, source: "invoice_history" });
  }
  const before = opts.before;
  const out = before === undefined ? rows : rows.filter((r) => r.at < before);
  out.sort((a, b) => a.at - b.at);
  return out;
}
