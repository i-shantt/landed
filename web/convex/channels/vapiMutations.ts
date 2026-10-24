import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { append } from "../events";

export const note = internalMutation({
  args: { caseId: v.id("cases"), type: v.string(), payload: v.any() },
  handler: async (ctx, { caseId, type, payload }) => {
    await append(ctx, { caseId, actor: "agent", type, payload });
  },
});

export const names = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const vendor = await ctx.db.get(c.vendorId);
    const company = await ctx.db.query("company").first();
    return { companyName: company?.name ?? "the company", vendorName: vendor?.name ?? "the vendor" };
  },
});
