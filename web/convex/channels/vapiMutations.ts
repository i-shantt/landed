import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { append } from "../events";

export const note = internalMutation({
  args: { caseId: v.id("cases"), type: v.string(), payload: v.any() },
  handler: async (ctx, { caseId, type, payload }) => {
    await append(ctx, { caseId, actor: "agent", type, payload });
  },
});

/** A call we placed. The webhook can only bind to cases through this table. */
export const recordCall = internalMutation({
  args: { caseId: v.id("cases"), contactId: v.id("contacts"), mode: v.union(v.literal("probe"), v.literal("landing")), paymentId: v.optional(v.id("payments")), vapiCallId: v.string() },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("voiceCalls").withIndex("by_callId", (q) => q.eq("vapiCallId", a.vapiCallId)).unique();
    if (existing) return existing._id;
    return ctx.db.insert("voiceCalls", { ...a, placedAt: Date.now(), status: "placed" });
  },
});

export const resolveCall = internalQuery({
  args: { vapiCallId: v.string() },
  handler: async (ctx, { vapiCallId }) => {
    const call = await ctx.db.query("voiceCalls").withIndex("by_callId", (q) => q.eq("vapiCallId", vapiCallId)).unique();
    const voice = (await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "voice")).unique())?.value ?? "sim";
    return { call, voice };
  },
});

export const noteUnbound = internalMutation({
  args: { claimedCaseId: v.optional(v.string()), callId: v.optional(v.string()), type: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { claimedCaseId, callId, type, detail }) => {
    let caseId: import("../_generated/dataModel").Id<"cases"> | undefined;
    if (claimedCaseId) {
      try {
        const c = await ctx.db.get(ctx.db.normalizeId("cases", claimedCaseId) ?? (claimedCaseId as never));
        if (c) caseId = c._id;
      } catch {
        caseId = undefined;
      }
    }
    await append(ctx, { caseId, actor: "system", type, payload: { claimedCaseId: claimedCaseId ?? null, callId: callId ?? null, detail: detail ?? null, note: "ignored: the webhook only binds through calls Landed placed" } });
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
