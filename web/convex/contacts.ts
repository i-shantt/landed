import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { append } from "./events";
import { now } from "./clock";

export async function recordPhoneContact(ctx: QueryCtx | MutationCtx, vendorId: Id<"vendors">) {
  const rows = await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
  return rows.find((c) => c.kind === "phone" && c.trustLevel === "record" && c.supersededAt === undefined) ?? null;
}

export async function recordPortalContact(ctx: QueryCtx | MutationCtx, vendorId: Id<"vendors">) {
  const rows = await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
  return rows.find((c) => c.kind === "portal" && c.trustLevel === "record" && c.supersededAt === undefined) ?? null;
}

export const supersede = mutation({
  args: { contactId: v.id("contacts"), reason: v.string() },
  handler: async (ctx, { contactId, reason }) => {
    const c = await ctx.db.get(contactId);
    if (!c) throw new ConvexError("contact_not_found");
    if (c.supersededAt !== undefined) return;
    const t = await now(ctx);
    await ctx.db.patch(contactId, { supersededAt: t });
    await append(ctx, { actor: "human", type: "contact_superseded", payload: { contactId, vendorId: c.vendorId, kind: c.kind, value: c.value, reason } });
  },
});

export const addRecordContact = mutation({
  args: { vendorId: v.id("vendors"), kind: v.union(v.literal("phone"), v.literal("portal"), v.literal("email")), value: v.string(), attestedBy: v.string() },
  handler: async (ctx, { vendorId, kind, value, attestedBy }) => {
    const t = await now(ctx);
    const id = await ctx.db.insert("contacts", { vendorId, kind, value, trustLevel: "record", establishedAt: t, establishedVia: "manual" });
    await append(ctx, { actor: "human", type: "record_contact_added", payload: { contactId: id, vendorId, kind, value, attestedBy, note: "prototype: human-attested; production requires a separate verification process" } });
    return id;
  },
});

export const addDiscoveredContact = internalMutation({
  args: { vendorId: v.id("vendors"), kind: v.union(v.literal("phone"), v.literal("portal"), v.literal("email")), value: v.string(), source: v.string() },
  handler: async (ctx, { vendorId, kind, value, source }) => {
    const t = await now(ctx);
    const id = await ctx.db.insert("contacts", { vendorId, kind, value, trustLevel: "discovered", establishedAt: t, establishedVia: "website_crawl" });
    await append(ctx, { actor: "agent", type: "discovered_contact_added", payload: { contactId: id, vendorId, kind, value, source } });
    return id;
  },
});

export const addUntrustedContact = internalMutation({
  args: { vendorId: v.id("vendors"), kind: v.union(v.literal("phone"), v.literal("portal"), v.literal("email")), value: v.string(), messageId: v.optional(v.id("messages")), caseId: v.optional(v.id("cases")) },
  handler: async (ctx, { vendorId, kind, value, messageId, caseId }) => {
    const t = await now(ctx);
    const id = await ctx.db.insert("contacts", { vendorId, kind, value, trustLevel: "untrusted", establishedAt: t, establishedVia: "request_message" });
    await append(ctx, { caseId, actor: "agent", type: "untrusted_contact_recorded", payload: { contactId: id, vendorId, kind, value, messageId } });
    return id;
  },
});

export const listForVendor = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect(),
});
