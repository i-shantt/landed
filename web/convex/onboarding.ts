// Vendor onboarding (additive): create a vendor, establish the contact of record through an explicit
// human-attested step with a reason, add the first bank account (starts unverified and opens a case
// through the normal path), optionally issue a portal credential. Every step is an audited event.
import { action, internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import bcrypt from "bcryptjs";
import { append } from "./events";
import { now } from "./clock";
import { ensureScreened } from "./screening/screen";
import { requireActor } from "./controls/actor";

type Attribution = { name: string; operatorId?: Id<"operators"> };

async function createVendorAs(ctx: MutationCtx, { name, domain, by }: { name: string; domain: string; by: Attribution }) {
  const d = domain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]+$/.test(d)) throw new ConvexError("invalid_domain");
  if (await ctx.db.query("vendors").withIndex("by_domain", (q) => q.eq("domain", d)).unique()) throw new ConvexError("domain_exists");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || d.split(".")[0];
  const t = await now(ctx);
  const vendorId = await ctx.db.insert("vendors", { name: name.trim(), domain: d, slug, onboardedAt: t, hasPortalLogin: false, notes: `onboarded by ${by.name}` });
  await ctx.db.insert("contacts", { vendorId, kind: "email", value: `ap@${d}`, trustLevel: "discovered", establishedAt: t, establishedVia: "onboarding_form" });
  await append(ctx, { actor: "human", type: "vendor_onboarded", payload: { vendorId, name, domain: d, onboardedBy: by.name, operatorId: by.operatorId ?? null } });
  // Sanctions screening at onboarding (controls layer): records a `screenings` row; a potential match
  // blocks payment when policy `blockOnScreeningHit` is on, until an approver resolves it.
  await ensureScreened(ctx, vendorId);
  return vendorId;
}

async function attestRecordContactAs(ctx: MutationCtx, { vendorId, kind, value, reason, by }: { vendorId: Id<"vendors">; kind: "phone" | "portal"; value: string; reason: string; by: Attribution }) {
  if (reason.trim().length < 15) throw new ConvexError("reason_too_short");
  if (!(await ctx.db.get(vendorId))) throw new ConvexError("vendor_not_found");
  const t = await now(ctx);
  const contactId = await ctx.db.insert("contacts", { vendorId, kind, value: value.trim(), trustLevel: "record", establishedAt: t, establishedVia: "onboarding_form_and_verified_call" });
  await append(ctx, { actor: "human", type: "record_contact_added", payload: { contactId, vendorId, kind, value: value.trim(), attestedBy: by.name, operatorId: by.operatorId ?? null, reason, note: "contact of record established at onboarding; human-attested" } });
  return contactId;
}

const kindV = v.union(v.literal("phone"), v.literal("portal"));

/** Workspace: the signed-in operator is the attribution. */
export const createVendor = mutation({
  args: { name: v.string(), domain: v.string() },
  handler: async (ctx, { name, domain }) => {
    const op = await requireActor(ctx);
    return createVendorAs(ctx, { name, domain, by: { name: op.name, operatorId: op._id } });
  },
});

/** REST API (apiRoutes.ts): the key's name is the attribution; the route already checked the write:vendors scope. */
export const createVendorFromApi = internalMutation({
  args: { name: v.string(), domain: v.string(), onboardedBy: v.string() },
  handler: async (ctx, { name, domain, onboardedBy }) => createVendorAs(ctx, { name, domain, by: { name: onboardedBy } }),
});

/** The contact of record is established by a human who states how it was verified. */
export const attestRecordContact = mutation({
  args: { vendorId: v.id("vendors"), kind: kindV, value: v.string(), reason: v.string() },
  handler: async (ctx, { vendorId, kind, value, reason }) => {
    const op = await requireActor(ctx);
    return attestRecordContactAs(ctx, { vendorId, kind, value, reason, by: { name: op.name, operatorId: op._id } });
  },
});

export const attestRecordContactFromApi = internalMutation({
  args: { vendorId: v.id("vendors"), kind: kindV, value: v.string(), reason: v.string(), attestedBy: v.string() },
  handler: async (ctx, { vendorId, kind, value, reason, attestedBy }) => attestRecordContactAs(ctx, { vendorId, kind, value, reason, by: { name: attestedBy } }),
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
  args: { vendorId: v.id("vendors"), username: v.string(), password: v.string() },
  handler: async (ctx, { vendorId, username, password }): Promise<{ ok: true }> => {
    const op = await ctx.runQuery(internal.controls.actor.resolve, {});
    const issuedBy = op.name;
    if (password.length < 8) throw new ConvexError("password_too_short");
    const passwordHash = await bcrypt.hash(password, 8);
    await ctx.runMutation(internal.onboardingMutations.storeCredential, { vendorId, username: username.trim().toLowerCase(), passwordHash, issuedBy });
    return { ok: true };
  },
});
