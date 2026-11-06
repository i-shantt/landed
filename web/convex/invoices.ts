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
