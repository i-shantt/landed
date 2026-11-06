import { internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { projectAccount } from "./bankAccounts";
import { requireActor } from "./controls/actor";

// Each read is a plain function (`<name>Read`) exposed twice: the public query for the signed-in workspace and an
// internal twin for the REST and eval handlers, which authenticate with their own keys and carry no session.
export async function listRead(ctx: QueryCtx) {
    const vendors = await ctx.db.query("vendors").collect();
    const out = [];
    for (const vnd of vendors) {
      const accounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", vnd._id)).collect();
      const cases = await ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", vnd._id)).collect();
      out.push({
        ...vnd,
        accountCount: accounts.length,
        verifiedCount: accounts.filter((a) => a.status === "verified").length,
        openCases: cases.filter((c) => c.state !== "CLOSED").length,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
export const list = query({ args: {}, handler: async (ctx) => {
    await requireActor(ctx);
    return listRead(ctx);
  },
});
export const listInternal = internalQuery({ args: {}, handler: listRead });

export async function getRead(ctx: QueryCtx, { vendorId }: { vendorId: Id<"vendors"> }) {
    const vnd = await ctx.db.get(vendorId);
    if (!vnd) return null;
    const contacts = await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const accounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const cases = await ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    return {
      ...vnd,
      contacts,
      accounts: accounts.map(projectAccount).sort((a, b) => b._creationTime - a._creationTime),
      invoices: invoices.sort((a, b) => b.issuedAt - a.issuedAt),
      cases: cases.sort((a, b) => b.openedAt - a.openedAt),
    };
}
export const get = query({ args: { vendorId: v.id("vendors") }, handler: async (ctx, a) => {
    await requireActor(ctx);
    return getRead(ctx, a);
  },
});
export const getInternal = internalQuery({ args: { vendorId: v.id("vendors") }, handler: getRead });

export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    await requireActor(ctx);
    return ctx.db.query("vendors").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
  },
});
