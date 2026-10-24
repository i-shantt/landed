// Stated-amount confirmations from channels. Acceptance is decided here (I4);
// release is decided by cases.tryRelease (I3). Public projections never include
// the stated amount (a correct statement would reveal the probe amount).
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { append } from "./events";
import { now, HOUR } from "./clock";
import { tryRelease } from "./cases";
import { recordLanding } from "./payments";

export type Channel = Doc<"confirmations">["channel"];
const TRUSTED_CHANNELS: Channel[] = ["voice", "portal", "sim_voice"];

export async function recordFromChannel(
  ctx: MutationCtx,
  args: {
    caseId: Id<"cases">;
    channel: Channel;
    contactId?: Id<"contacts">;
    statedAmountCents?: number | null;
    transcript?: string;
    /** "no_answer" means the vendor could not be reached: recorded, not accepted, not escalated. */
    outcome?: "stated" | "nothing_arrived" | "no_answer";
    mode?: "probe" | "landing";
  }
) {
  const c = await ctx.db.get(args.caseId);
  if (!c) throw new Error("case not found");
  const account = await ctx.db.get(c.newAccountId);
  if (!account) throw new Error("account not found");
  const contact = args.contactId ? await ctx.db.get(args.contactId) : null;
  const t = await now(ctx);
  const outcome = args.outcome ?? (args.statedAmountCents === null || args.statedAmountCents === undefined ? "nothing_arrived" : "stated");

  let accepted = true;
  let rejectReason: string | undefined;
  if (!TRUSTED_CHANNELS.includes(args.channel)) {
    accepted = false;
    rejectReason = "untrusted_channel";
  } else if (!contact) {
    accepted = false;
    rejectReason = "contact_missing";
  } else if (contact.vendorId !== c.vendorId) {
    accepted = false;
    rejectReason = "contact_wrong_vendor";
  } else if (contact.trustLevel !== "record") {
    accepted = false;
    rejectReason = "contact_not_record";
  } else if (contact.supersededAt !== undefined) {
    accepted = false;
    rejectReason = "contact_superseded";
  } else if (outcome === "no_answer") {
    accepted = false;
    rejectReason = "no_answer";
  }

  const mode = args.mode ?? "probe";
  const confirmationId = await ctx.db.insert("confirmations", {
    caseId: c._id,
    vendorId: c.vendorId,
    accountHash: account.accountHash,
    accountVersion: account.version,
    probeId: c.probeId,
    channel: args.channel,
    contactId: args.contactId,
    statedAmountCents: outcome === "stated" && args.statedAmountCents != null ? args.statedAmountCents : undefined,
    transcript: args.transcript,
    receivedAt: t,
    expiresAt: t + 2 * HOUR,
    accepted,
    rejectReason,
    mode,
  });
  await append(ctx, {
    caseId: c._id,
    actor: "vendor",
    type: mode === "landing" ? "landing_statement_received" : "confirmation_received",
    payload: { confirmationId, channel: args.channel, accepted, rejectReason: rejectReason ?? null, outcome, contactTrust: contact?.trustLevel ?? null, contactKind: contact?.kind ?? null },
  });

  if (mode === "landing") {
    if (accepted && c.paymentId) {
      await recordLanding(ctx, { paymentId: c.paymentId, statedAmountCents: outcome === "stated" ? (args.statedAmountCents ?? null) : null, contactId: args.contactId! });
    }
    return { confirmationId, accepted, rejectReason };
  }

  if (outcome === "no_answer") {
    // Not a statement; SLA timer will escalate if nothing else arrives.
    return { confirmationId, accepted, rejectReason };
  }
  const decision = await tryRelease(ctx, c._id, confirmationId);
  return { confirmationId, accepted, rejectReason, decision };
}

export const recordFromChannelInternal = internalMutation({
  args: {
    caseId: v.id("cases"),
    channel: v.union(v.literal("voice"), v.literal("portal"), v.literal("email"), v.literal("sim_voice")),
    contactId: v.optional(v.id("contacts")),
    statedAmountCents: v.optional(v.union(v.number(), v.null())),
    transcript: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal("stated"), v.literal("nothing_arrived"), v.literal("no_answer"))),
    mode: v.optional(v.union(v.literal("probe"), v.literal("landing"))),
  },
  handler: async (ctx, args) => recordFromChannel(ctx, args),
});

/** Email can never confirm. Stored as rejected so the timeline shows it was seen and ignored. */
export async function recordFromEmail(
  ctx: MutationCtx,
  args: { caseId: Id<"cases">; messageId: Id<"messages">; statedAmountCents?: number; transcript: string; from: string }
) {
  const c = await ctx.db.get(args.caseId);
  if (!c) return null;
  const account = await ctx.db.get(c.newAccountId);
  if (!account) return null;
  const t = await now(ctx);
  const confirmationId = await ctx.db.insert("confirmations", {
    caseId: c._id,
    vendorId: c.vendorId,
    accountHash: account.accountHash,
    accountVersion: account.version,
    probeId: c.probeId,
    channel: "email",
    statedAmountCents: args.statedAmountCents,
    transcript: args.transcript,
    receivedAt: t,
    expiresAt: t + 2 * HOUR,
    accepted: false,
    rejectReason: "untrusted_channel",
    mode: "probe",
  });
  await append(ctx, {
    caseId: c._id,
    actor: "vendor",
    type: "confirmation_received",
    payload: { confirmationId, channel: "email", accepted: false, rejectReason: "untrusted_channel", from: args.from, messageId: args.messageId },
  });
  // Never considered by markVerified. We still log a refusal so the audit shows it was evaluated and rejected.
  await append(ctx, { caseId: c._id, actor: "system", type: "release_refused", payload: { reason: "confirmation_not_accepted", confirmationId, channel: "email" } });
  return confirmationId;
}

export const listForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const rows = await ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const out = [];
    for (const r of rows) {
      const contact = r.contactId ? await ctx.db.get(r.contactId) : null;
      out.push({
        _id: r._id,
        channel: r.channel,
        accepted: r.accepted,
        rejectReason: r.rejectReason ?? null,
        receivedAt: r.receivedAt,
        expiresAt: r.expiresAt,
        usedAt: r.usedAt ?? null,
        mode: r.mode ?? "probe",
        hasStatedAmount: r.statedAmountCents !== undefined,
        // Landing statements are about the (non-secret) payment amount; probe statements are never shown.
        statedAmountCents: r.mode === "landing" ? r.statedAmountCents : undefined,
        transcript: r.transcript ?? null,
        contact: contact ? { _id: contact._id, kind: contact.kind, value: contact.value, trustLevel: contact.trustLevel, supersededAt: contact.supersededAt ?? null } : null,
      });
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt);
  },
});
