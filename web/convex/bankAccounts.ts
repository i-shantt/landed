// Bank accounts are versioned and start unverified (I2). Editing never mutates a
// row; it creates version+1 and supersedes the old row.
import { action, internalAction, internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { append } from "./events";
import { openCase } from "./cases";
import { hashAndEncrypt } from "./crypto";

export function projectAccount(a: Doc<"bankAccounts">) {
  return {
    _id: a._id,
    vendorId: a.vendorId,
    identityKey: a.identityKey,
    routing: a.routing,
    accountLast4: a.accountLast4,
    status: a.status,
    version: a.version,
    firstPaidAt: a.firstPaidAt,
    createdVia: a.createdVia,
    verifiedByConfirmationId: a.verifiedByConfirmationId,
    hashPrefix: a.accountHash.slice(0, 8),
    _creationTime: a._creationTime,
  };
}

export async function createUnverifiedWithHash(
  ctx: MutationCtx,
  args: {
    vendorId: Id<"vendors">;
    routing: string;
    accountLast4: string;
    accountHash: string;
    accountCiphertext: string;
    createdVia: string; // "seed" | "intake" | "manual_edit"
    triggerMessageId?: Id<"messages">;
    contactAlsoChanged?: boolean;
    /** seed only: mark verified with firstPaidAt, no case */
    seedVerifiedAt?: number;
    /** which account this replaces (for the case's oldAccountId) */
    replacesAccountId?: Id<"bankAccounts">;
  }
): Promise<{ accountId: Id<"bankAccounts">; caseId: Id<"cases"> | null; reused: boolean }> {
  const identityKey = `${args.vendorId}:${args.accountHash}`;
  const latest = await ctx.db
    .query("bankAccounts")
    .withIndex("by_identity", (q) => q.eq("identityKey", identityKey))
    .order("desc")
    .first();

  // Same account identity, already verified for this vendor -> nothing to do.
  if (latest && latest.status === "verified") {
    return { accountId: latest._id, caseId: null, reused: true };
  }
  // Same identity, currently being verified -> reuse the row and its case.
  if (latest && (latest.status === "unverified" || latest.status === "probing")) {
    const open = await ctx.db.query("cases").withIndex("by_newAccount", (q) => q.eq("newAccountId", latest._id)).collect();
    const c = open.find((x) => x.state !== "CLOSED");
    if (c) return { accountId: latest._id, caseId: c._id, reused: true };
  }

  const version = latest ? latest.version + 1 : 1;
  // A rejected or disputed prior version keeps its status (it is part of the fraud record).
  if (latest && !["superseded", "disputed", "rejected"].includes(latest.status)) await ctx.db.patch(latest._id, { status: "superseded" });

  const accountId = await ctx.db.insert("bankAccounts", {
    vendorId: args.vendorId,
    identityKey,
    version,
    routing: args.routing,
    accountLast4: args.accountLast4,
    accountHash: args.accountHash,
    accountCiphertext: args.accountCiphertext,
    status: args.seedVerifiedAt !== undefined ? "verified" : "unverified",
    firstPaidAt: args.seedVerifiedAt,
    createdVia: args.createdVia,
  });

  if (args.seedVerifiedAt !== undefined) return { accountId, caseId: null, reused: false };

  // Which account did this one replace? The row being edited (manual edit) or the vendor's current verified account.
  let oldAccountId = args.replacesAccountId;
  if (oldAccountId && args.createdVia === "manual_edit") {
    const old = await ctx.db.get(oldAccountId);
    if (old && old.vendorId === args.vendorId && old._id !== accountId && (old.status === "verified" || old.status === "unverified" || old.status === "probing")) {
      await ctx.db.patch(old._id, { status: "superseded" });
    }
  }
  if (!oldAccountId) {
    const vendorAccounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", args.vendorId)).collect();
    const current = vendorAccounts.filter((a) => a.status === "verified" && a._id !== accountId).sort((a, b) => (b.firstPaidAt ?? 0) - (a.firstPaidAt ?? 0))[0];
    oldAccountId = current?._id ?? latest?._id;
  }

  await append(ctx, {
    actor: args.createdVia === "manual_edit" ? "human" : args.createdVia === "intake" ? "agent" : "system",
    type: "bank_account_created",
    payload: { accountId, vendorId: args.vendorId, routing: args.routing, last4: args.accountLast4, version, createdVia: args.createdVia, status: "unverified" },
  });

  const triggerType = args.createdVia === "manual_edit" ? "manual_edit" : args.createdVia === "intake" ? "instruction_change" : "never_verified_account";
  const caseId = await openCase(ctx, {
    vendorId: args.vendorId,
    newAccountId: accountId,
    oldAccountId,
    triggerType,
    triggerMessageId: args.triggerMessageId,
    contactAlsoChanged: args.contactAlsoChanged ?? false,
  });
  return { accountId, caseId, reused: false };
}

export const createUnverifiedMutation = internalMutation({
  args: {
    vendorId: v.id("vendors"),
    routing: v.string(),
    accountLast4: v.string(),
    accountHash: v.string(),
    accountCiphertext: v.string(),
    createdVia: v.string(),
    triggerMessageId: v.optional(v.id("messages")),
    contactAlsoChanged: v.optional(v.boolean()),
    replacesAccountId: v.optional(v.id("bankAccounts")),
  },
  handler: async (ctx, args) => createUnverifiedWithHash(ctx, args),
});

/** Internal: hash + encrypt (action), then the mutation above. */
export type CreateResult = { accountId: Id<"bankAccounts">; caseId: Id<"cases"> | null; reused: boolean };

export const createUnverified = internalAction({
  args: {
    vendorId: v.id("vendors"),
    routing: v.string(),
    accountNumberPlain: v.string(),
    createdVia: v.string(),
    triggerMessageId: v.optional(v.id("messages")),
    contactAlsoChanged: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CreateResult> => {
    const enc = await hashAndEncrypt(args.routing, args.accountNumberPlain);
    return ctx.runMutation(internal.bankAccounts.createUnverifiedMutation, {
      vendorId: args.vendorId,
      routing: enc.routing,
      accountLast4: enc.accountLast4,
      accountHash: enc.accountHash,
      accountCiphertext: enc.accountCiphertext,
      createdVia: args.createdVia,
      triggerMessageId: args.triggerMessageId,
      contactAlsoChanged: args.contactAlsoChanged,
    });
  },
});

/** Human: the vendor page's "Edit bank account" form. Always a new unverified row + case. */
export const manualEdit = action({
  args: { vendorId: v.id("vendors"), routing: v.string(), accountNumber: v.string(), replacesAccountId: v.optional(v.id("bankAccounts")) },
  handler: async (ctx, args): Promise<CreateResult> => {
    const routing = args.routing.replace(/\D/g, "");
    const account = args.accountNumber.replace(/\D/g, "");
    if (routing.length !== 9) throw new Error("routing number must be 9 digits");
    if (account.length < 4 || account.length > 17) throw new Error("account number must be 4-17 digits");
    const enc = await hashAndEncrypt(routing, account);
    return ctx.runMutation(internal.bankAccounts.createUnverifiedMutation, {
      vendorId: args.vendorId,
      routing: enc.routing,
      accountLast4: enc.accountLast4,
      accountHash: enc.accountHash,
      accountCiphertext: enc.accountCiphertext,
      createdVia: "manual_edit",
      replacesAccountId: args.replacesAccountId,
    });
  },
});

export const listForVendor = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    const rows = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    return rows.map(projectAccount).sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const get = query({
  args: { accountId: v.id("bankAccounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    return a ? projectAccount(a) : null;
  },
});
