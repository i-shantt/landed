import { query } from "./_generated/server";
import { v } from "convex/values";
import { projectAccount } from "./bankAccounts";

export const list = query({
  args: {},
  handler: async (ctx) => {
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
  },
});

export const get = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
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
  },
});

export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => ctx.db.query("vendors").withIndex("by_slug", (q) => q.eq("slug", slug)).unique(),
});
