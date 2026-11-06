import { internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireActor } from "./controls/actor";

export const listForVendor = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    await requireActor(ctx);
    return ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
  },
});

export async function listOpenRead(ctx: QueryCtx) {
    const rows = await ctx.db.query("invoices").collect();
    const open = rows.filter((i) => i.status !== "paid");
    const out = [];
    for (const i of open) {
      const vendor = await ctx.db.get(i.vendorId);
      const acct = await ctx.db.get(i.remitAccountId);
      out.push({ ...i, vendorName: vendor?.name ?? "?", remitStatus: acct?.status ?? "missing", remitLast4: acct?.accountLast4 ?? "????" });
    }
    return out.sort((a, b) => a.dueAt - b.dueAt);
}
export const listOpen = query({ args: {}, handler: async (ctx) => {
    await requireActor(ctx);
    return listOpenRead(ctx);
  },
});
export const listOpenInternal = internalQuery({ args: {}, handler: listOpenRead });

export async function getRead(ctx: QueryCtx, { invoiceId }: { invoiceId: Id<"invoices"> }) {
  return ctx.db.get(invoiceId);
}
export const get = query({ args: { invoiceId: v.id("invoices") }, handler: async (ctx, a) => {
    await requireActor(ctx);
    return getRead(ctx, a);
  },
});
export const getInternal = internalQuery({ args: { invoiceId: v.id("invoices") }, handler: getRead });

export const byNumber = query({
  args: { number: v.string() },
  handler: async (ctx, { number }) => {
    await requireActor(ctx);
    return ctx.db.query("invoices").withIndex("by_number", (q) => q.eq("number", number)).first();
  },
});

/**
 * Every invoice with the context the `/invoices` page needs: vendor name, the remit account's projection
 * (routing, last four, version, status; never ciphertext or hash), the open case on that account if any, and
 * the payment that settled it. Sorted by due date. Session required.
 */
export async function listAllRead(ctx: QueryCtx) {
  const rows = await ctx.db.query("invoices").collect();
  const out = [];
  for (const i of rows) {
    const vendor = await ctx.db.get(i.vendorId);
    const acct = await ctx.db.get(i.remitAccountId);
    const cases = acct ? await ctx.db.query("cases").withIndex("by_newAccount", (q) => q.eq("newAccountId", acct._id)).collect() : [];
    const openCase = cases.find((c) => c.state !== "CLOSED") ?? null;
    const payments = await ctx.db.query("payments").withIndex("by_invoice", (q) => q.eq("invoiceId", i._id)).collect();
    const paid = payments.sort((a, b) => b.sentAt - a.sentAt)[0] ?? null;
    out.push({
      _id: i._id,
      number: i.number,
      vendorId: i.vendorId,
      vendorName: vendor?.name ?? "?",
      amountCents: i.amountCents,
      issuedAt: i.issuedAt,
      dueAt: i.dueAt,
      status: i.status,
      remit: acct ? { routing: acct.routing, last4: acct.accountLast4, version: acct.version, status: acct.status } : null,
      caseId: openCase?._id ?? null,
      caseState: openCase?.state ?? null,
      payment: paid ? { _id: paid._id, sentAt: paid.sentAt, rail: paid.rail, landingState: paid.landingState } : null,
    });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt || a.number.localeCompare(b.number));
}
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx);
    return listAllRead(ctx);
  },
});
