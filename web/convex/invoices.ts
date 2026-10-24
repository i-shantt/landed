import { query } from "./_generated/server";
import { v } from "convex/values";

export const listForVendor = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect(),
});

export const listOpen = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("invoices").collect();
    const open = rows.filter((i) => i.status !== "paid");
    const out = [];
    for (const i of open) {
      const vendor = await ctx.db.get(i.vendorId);
      const acct = await ctx.db.get(i.remitAccountId);
      out.push({ ...i, vendorName: vendor?.name ?? "?", remitStatus: acct?.status ?? "missing", remitLast4: acct?.accountLast4 ?? "????" });
    }
    return out.sort((a, b) => a.dueAt - b.dueAt);
  },
});

export const get = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => ctx.db.get(invoiceId),
});

export const byNumber = query({
  args: { number: v.string() },
  handler: async (ctx, { number }) => ctx.db.query("invoices").withIndex("by_number", (q) => q.eq("number", number)).first(),
});
