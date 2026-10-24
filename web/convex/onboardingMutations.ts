import { internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { append } from "./events";
import { now } from "./clock";

export const storeCredential = internalMutation({
  args: { vendorId: v.id("vendors"), username: v.string(), passwordHash: v.string(), issuedBy: v.string() },
  handler: async (ctx, { vendorId, username, passwordHash, issuedBy }) => {
    if (await ctx.db.query("portalCredentials").withIndex("by_username", (q) => q.eq("username", username)).unique()) throw new ConvexError("username_taken");
    const t = await now(ctx);
    const contactId = await ctx.db.insert("contacts", { vendorId, kind: "portal", value: username, trustLevel: "record", establishedAt: t, establishedVia: "onboarding_form_and_verified_call" });
    await ctx.db.insert("portalCredentials", { vendorId, username, passwordHash, contactId });
    await ctx.db.patch(vendorId, { hasPortalLogin: true });
    await append(ctx, { actor: "human", type: "portal_credential_issued", payload: { vendorId, username, contactId, issuedBy } });
  },
});
