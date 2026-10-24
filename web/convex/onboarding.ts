// Vendor onboarding (additive): create a vendor, establish the contact of record through an explicit
// human-attested step with a reason, add the first bank account (starts unverified and opens a case
// through the normal path), optionally issue a portal credential. Every step is an audited event.
import { action, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import bcrypt from "bcryptjs";
import { append } from "./events";
import { now } from "./clock";

export const createVendor = mutation({
  args: { name: v.string(), domain: v.string(), onboardedBy: v.string() },
  handler: async (ctx, { name, domain, onboardedBy }) => {
    const d = domain.trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]+$/.test(d)) throw new ConvexError("invalid_domain");
    if (await ctx.db.query("vendors").withIndex("by_domain", (q) => q.eq("domain", d)).unique()) throw new ConvexError("domain_exists");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || d.split(".")[0];
    const t = await now(ctx);
    const vendorId = await ctx.db.insert("vendors", { name: name.trim(), domain: d, slug, onboardedAt: t, hasPortalLogin: false, notes: `onboarded by ${onboardedBy}` });
    await ctx.db.insert("contacts", { vendorId, kind: "email", value: `ap@${d}`, trustLevel: "discovered", establishedAt: t, establishedVia: "onboarding_form" });
    await append(ctx, { actor: "human", type: "vendor_onboarded", payload: { vendorId, name, domain: d, onboardedBy } });
    return vendorId;
  },
});

/** The contact of record is established by a human who states how it was verified. */
export const attestRecordContact = mutation({
  args: { vendorId: v.id("vendors"), kind: v.union(v.literal("phone"), v.literal("portal")), value: v.string(), attestedBy: v.string(), reason: v.string() },
  handler: async (ctx, { vendorId, kind, value, attestedBy, reason }) => {
    if (reason.trim().length < 15) throw new ConvexError("reason_too_short");
    if (!(await ctx.db.get(vendorId))) throw new ConvexError("vendor_not_found");
    const t = await now(ctx);
    const contactId = await ctx.db.insert("contacts", { vendorId, kind, value: value.trim(), trustLevel: "record", establishedAt: t, establishedVia: "onboarding_form_and_verified_call" });
    await append(ctx, { actor: "human", type: "record_contact_added", payload: { contactId, vendorId, kind, value: value.trim(), attestedBy, reason, note: "contact of record established at onboarding; human-attested" } });
    return contactId;
  },
});

/** First bank account: starts unverified and opens a case like any other new destination. */
export const addFirstAccount = action({
  args: { vendorId: v.id("vendors"), routing: v.string(), accountNumber: v.string() },
  handler: async (ctx, { vendorId, routing, accountNumber }): Promise<{ accountId: Id<"bankAccounts">; caseId: Id<"cases"> | null }> => {
    const r = routing.replace(/\D/g, ""); const a = accountNumber.replace(/\D/g, "");
    if (r.length !== 9) throw new ConvexError("routing_must_be_9_digits");
    if (a.length < 4 || a.length > 17) throw new ConvexError("account_4_to_17_digits");
    const res = await ctx.runAction(internal.bankAccounts.createUnverified, { vendorId, routing: r, accountNumberPlain: a, createdVia: "onboarding" });
    return { accountId: res.accountId, caseId: res.caseId };
  },
});

export const issuePortalCredential = action({
  args: { vendorId: v.id("vendors"), username: v.string(), password: v.string(), issuedBy: v.string() },
  handler: async (ctx, { vendorId, username, password, issuedBy }): Promise<{ ok: true }> => {
    if (password.length < 8) throw new ConvexError("password_too_short");
    const passwordHash = await bcrypt.hash(password, 8);
    await ctx.runMutation(internal.onboardingMutations.storeCredential, { vendorId, username: username.trim().toLowerCase(), passwordHash, issuedBy });
    return { ok: true };
  },
});
