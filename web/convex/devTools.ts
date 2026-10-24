// Dev-only helpers for the demo. Additive; no core file touched.
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { append } from "./events";
import { now } from "./clock";

/**
 * "Simulate discovery": inserts a `discovered` phone contact for a vendor, equal to the
 * phone of record or a different number, standing in for the Apify website crawl when no
 * token is present. Discovered contacts are cross-check only and can never confirm (I4).
 */
export const simulateDiscovery = mutation({
  args: { vendorId: v.id("vendors"), matchesRecord: v.boolean() },
  handler: async (ctx, { vendorId, matchesRecord }) => {
    const contacts = await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const record = contacts.find((c) => c.kind === "phone" && c.trustLevel === "record" && c.supersededAt === undefined);
    const t = await now(ctx);
    const value = matchesRecord && record ? record.value : "+15550199123";
    const id = await ctx.db.insert("contacts", { vendorId, kind: "phone", value, trustLevel: "discovered", establishedAt: t, establishedVia: "website_crawl" });
    await append(ctx, { actor: "agent", type: "discovered_contact_added", payload: { contactId: id, vendorId, kind: "phone", value, source: "simulated discovery (no APIFY_TOKEN)" } });
    const mismatch = !!record && record.value !== value;
    if (mismatch) {
      await append(ctx, { actor: "system", type: "contact_crosscheck_mismatch", payload: { vendorId, discovered: value, recordLast4: record!.value.slice(-4), note: "a discovered phone differs from the phone of record; cross-check only, nothing changes about release" } });
    }
    return { contactId: id, mismatch };
  },
});
