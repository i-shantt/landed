// Case lifecycle. `markVerified` semantics live in `tryRelease` (internal). The
// only ways a bank account becomes `verified`: tryRelease (bound confirmation)
// or exceptionalRelease (two named humans). No action that calls an LLM imports
// or schedules either.
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { append, type Actor } from "./events";
import { canRelease, isAllowedTransition } from "./guard";
import { now } from "./clock";
import { createProbe } from "./probes";
import { getValidationProvider } from "./validation/provider";

export const TERMINAL = new Set(["CLOSED"]);
export const OPEN_STATES = ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "VERIFIED", "PAID", "NEEDS_HUMAN", "UNCONFIRMED", "RECOVERY"] as const;

export async function transition(
  ctx: MutationCtx,
  caseId: Id<"cases">,
  to: Doc<"cases">["state"],
  event: { actor: Actor; type: string; payload?: unknown },
  humanReason?: string
) {
  const c = await ctx.db.get(caseId);
  if (!c) throw new Error("case not found");
  if (!isAllowedTransition(c.state, to)) {
    throw new Error(`illegal transition ${c.state} -> ${to} for case ${caseId}`);
  }
  const t = await now(ctx);
  const patch: Partial<Doc<"cases">> = { state: to };
  if (humanReason !== undefined) patch.humanReason = humanReason;
  if (to === "CLOSED") patch.closedAt = t;
  await ctx.db.patch(caseId, patch);
  await append(ctx, { caseId, actor: event.actor, type: event.type, payload: { ...(event.payload as object ?? {}), from: c.state, to } });
}

export async function findOpenCaseForAccount(ctx: QueryCtx | MutationCtx, newAccountId: Id<"bankAccounts">) {
  const rows = await ctx.db.query("cases").withIndex("by_newAccount", (q) => q.eq("newAccountId", newAccountId)).collect();
  return rows.find((c) => !TERMINAL.has(c.state)) ?? null;
}

export async function openCase(
  ctx: MutationCtx,
  args: {
    vendorId: Id<"vendors">;
    newAccountId: Id<"bankAccounts">;
    oldAccountId?: Id<"bankAccounts">;
    triggerType: string;
    triggerMessageId?: Id<"messages">;
    contactAlsoChanged: boolean;
  }
): Promise<Id<"cases">> {
  const existing = await findOpenCaseForAccount(ctx, args.newAccountId);
  if (existing) return existing._id;
  const t = await now(ctx);
  const account = await ctx.db.get(args.newAccountId);
  if (!account) throw new Error("new account missing");
  if (account.status !== "unverified") {
    await ctx.db.patch(account._id, { status: "unverified" });
  }
  const oldAccount = args.oldAccountId ? await ctx.db.get(args.oldAccountId) : null;
  const caseId = await ctx.db.insert("cases", {
    vendorId: args.vendorId,
    triggerType: args.triggerType,
    triggerMessageId: args.triggerMessageId,
    oldAccountId: args.oldAccountId,
    newAccountId: args.newAccountId,
    state: "HELD",
    contactAlsoChanged: args.contactAlsoChanged,
    openedAt: t,
  });
  await append(ctx, {
    caseId,
    actor: "system",
    type: "case_opened",
    payload: {
      triggerType: args.triggerType,
      newAccount: { routing: account.routing, last4: account.accountLast4, version: account.version },
      oldAccount: oldAccount ? { routing: oldAccount.routing, last4: oldAccount.accountLast4, version: oldAccount.version } : null,
      contactAlsoChanged: args.contactAlsoChanged,
    },
  });
  // Open invoices that remit to the replaced account now follow the requested account, which is held until verified.
  if (oldAccount && oldAccount._id !== account._id) {
    const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", args.vendorId)).collect();
    const moved = [];
    for (const inv of invoices) {
      if (inv.status !== "paid" && inv.remitAccountId === oldAccount._id) {
        await ctx.db.patch(inv._id, { remitAccountId: account._id, status: "held" });
        moved.push(inv.number);
      }
    }
    if (moved.length) await append(ctx, { caseId, actor: "system", type: "invoices_held", payload: { invoices: moved, note: "open invoices now remit to the requested account and are held until it is verified" } });
  }
  if (args.contactAlsoChanged) {
    await transition(
      ctx,
      caseId,
      "NEEDS_HUMAN",
      { actor: "system", type: "escalated", payload: { reason: "contact_and_bank_changed_together" } },
      "contact_and_bank_changed_together"
    );
    return caseId;
  }
  // Known-bad account numbers never get another probe: a prior version of this identity that a human
  // rejected or disputed, or the same account requested by a different vendor (mule pattern).
  const versions = await ctx.db.query("bankAccounts").withIndex("by_identity", (q) => q.eq("identityKey", account.identityKey)).collect();
  const priorBad = versions.find((a) => a._id !== account._id && (a.status === "rejected" || a.status === "disputed"));
  if (priorBad) {
    await transition(ctx, caseId, "NEEDS_HUMAN", { actor: "system", type: "escalated", payload: { reason: "account_previously_rejected", priorVersion: priorBad.version, priorStatus: priorBad.status } }, "account_previously_rejected");
    return caseId;
  }
  const sameHash = await ctx.db.query("bankAccounts").withIndex("by_hash", (q) => q.eq("accountHash", account.accountHash)).collect();
  const otherVendors = new Set(sameHash.filter((a) => a.vendorId !== account.vendorId).map((a) => a.vendorId as string));
  if (otherVendors.size > 0) {
    await transition(ctx, caseId, "NEEDS_HUMAN", { actor: "system", type: "escalated", payload: { reason: "account_reused_across_vendors", otherVendors: otherVendors.size } }, "account_reused_across_vendors");
    return caseId;
  }
  const vendor = await ctx.db.get(args.vendorId);
  const result = await getValidationProvider().lookup({ routing: account.routing, accountHash: account.accountHash, vendorName: vendor?.name ?? "" });
  await ctx.db.patch(caseId, { validationProviderResult: result });
  await append(ctx, { caseId, actor: "system", type: "validation_result", payload: { provider: "stub", result, next: result === "no_coverage" ? "probe" : result } });
  if (result === "mismatch") {
    await transition(ctx, caseId, "NEEDS_HUMAN", { actor: "system", type: "escalated", payload: { reason: "validation_mismatch" } }, "validation_mismatch");
    return caseId;
  }
  await createProbe(ctx, caseId);
  return caseId;
}

/** After verification: the replaced account is superseded and held invoices reopen. */
export async function onAccountVerified(ctx: MutationCtx, caseDoc: Doc<"cases">, newAccountId: Id<"bankAccounts">) {
  if (caseDoc.oldAccountId && caseDoc.oldAccountId !== newAccountId) {
    const old = await ctx.db.get(caseDoc.oldAccountId);
    if (old && old.status === "verified") {
      await ctx.db.patch(old._id, { status: "superseded" });
      await append(ctx, { caseId: caseDoc._id, actor: "system", type: "old_account_superseded", payload: { accountId: old._id, last4: old.accountLast4, version: old.version } });
    }
  }
  const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", caseDoc.vendorId)).collect();
  for (const inv of invoices) {
    if (inv.status === "held" && inv.remitAccountId === newAccountId) await ctx.db.patch(inv._id, { status: "open" });
  }
}

/** Latest accepted, unused confirmation for a case (or null). */
async function latestUsable(ctx: MutationCtx, caseId: Id<"cases">) {
  const rows = await ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const usable = rows.filter((r) => r.accepted && r.usedAt === undefined);
  usable.sort((a, b) => b.receivedAt - a.receivedAt);
  return usable[0] ?? null;
}

/**
 * I3. Evaluate a confirmation against the case; on success flip the account to
 * verified, mark the confirmation used, transition the case, append the event,
 * all in this one mutation.
 */
export async function tryRelease(ctx: MutationCtx, caseId: Id<"cases">, confirmationId?: Id<"confirmations">) {
  const caseDoc = await ctx.db.get(caseId);
  if (!caseDoc) throw new Error("case not found");
  const account = await ctx.db.get(caseDoc.newAccountId);
  if (!account) throw new Error("account not found");
  const probe = caseDoc.probeId ? await ctx.db.get(caseDoc.probeId) : null;
  const confirmation = confirmationId ? await ctx.db.get(confirmationId) : await latestUsable(ctx, caseId);
  const contact = confirmation?.contactId ? await ctx.db.get(confirmation.contactId) : null;
  const t = await now(ctx);

  const decision = canRelease({ caseDoc, account, probe, confirmation, contact, now: t });

  if (!decision.ok) {
    await append(ctx, {
      caseId,
      actor: "system",
      type: "release_refused",
      payload: { reason: decision.reason, confirmationId: confirmation?._id ?? null, channel: confirmation?.channel ?? null },
    });
    if (decision.reason === "amount_mismatch" && confirmation?.accepted && caseDoc.state === "AWAITING_CONFIRMATION") {
      const nothing = confirmation.statedAmountCents === undefined;
      const reason = nothing ? "vendor_reports_nothing_arrived" : "stated_amount_mismatch";
      await transition(ctx, caseId, "NEEDS_HUMAN", { actor: "system", type: "escalated", payload: { reason } }, reason);
    }
    return decision;
  }

  if (caseDoc.state !== "AWAITING_CONFIRMATION") {
    await append(ctx, { caseId, actor: "system", type: "release_refused", payload: { reason: "case_not_awaiting", state: caseDoc.state } });
    return { ok: false as const, reason: "case_not_awaiting" as const };
  }

  // Success: atomic in this mutation.
  await ctx.db.patch(confirmation!._id, { usedAt: t });
  await ctx.db.patch(account._id, { status: "verified", verifiedByConfirmationId: confirmation!._id });
  await ctx.db.patch(caseId, { confirmationId: confirmation!._id });
  await onAccountVerified(ctx, caseDoc, account._id);
  await transition(ctx, caseId, "VERIFIED", {
    actor: "system",
    type: "account_verified",
    payload: { confirmationId: confirmation!._id, channel: confirmation!.channel, contactId: contact!._id, contactKind: contact!.kind, accountVersion: account.version },
  });
  return decision;
}

export const tryReleaseInternal = internalMutation({
  args: { caseId: v.id("cases"), confirmationId: v.optional(v.id("confirmations")) },
  handler: async (ctx, { caseId, confirmationId }) => tryRelease(ctx, caseId, confirmationId),
});

export const openInternal = internalMutation({
  args: {
    vendorId: v.id("vendors"),
    newAccountId: v.id("bankAccounts"),
    oldAccountId: v.optional(v.id("bankAccounts")),
    triggerType: v.string(),
    triggerMessageId: v.optional(v.id("messages")),
    contactAlsoChanged: v.boolean(),
  },
  handler: async (ctx, args) => openCase(ctx, args),
});

// ---- human actions ----

export const requestHumanReview = mutation({
  args: { caseId: v.id("cases"), reason: v.string() },
  handler: async (ctx, { caseId, reason }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new ConvexError("case_not_found");
    if (!isAllowedTransition(c.state, "NEEDS_HUMAN")) throw new ConvexError(`cannot_request_review_from_${c.state}`);
    await transition(ctx, caseId, "NEEDS_HUMAN", { actor: "human", type: "human_review_requested", payload: { reason } }, reason);
  },
});

export const markFraud = mutation({
  args: { caseId: v.id("cases"), reason: v.string() },
  handler: async (ctx, { caseId, reason }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new ConvexError("case_not_found");
    const ev = { actor: "human" as Actor, type: "fraud_reported", payload: { reason } };
    if (["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION"].includes(c.state)) {
      await transition(ctx, caseId, "NEEDS_HUMAN", ev, reason);
      await transition(ctx, caseId, "RECOVERY", { actor: "human", type: "recovery_started", payload: { reason } });
    } else if (c.state === "PAID") {
      const p = c.paymentId ? await ctx.db.get(c.paymentId) : null;
      if (p && p.landingState === "pending") await ctx.db.patch(p._id, { landingState: "unconfirmed" });
      await transition(ctx, caseId, "UNCONFIRMED", ev, reason);
      await transition(ctx, caseId, "RECOVERY", { actor: "human", type: "recovery_started", payload: { reason } });
    } else if (c.state === "NEEDS_HUMAN" || c.state === "UNCONFIRMED") {
      await transition(ctx, caseId, "RECOVERY", { ...ev, type: "recovery_started" }, reason);
    } else {
      throw new ConvexError(`cannot_mark_fraud_from_${c.state}`);
    }
    await ctx.db.patch(c.newAccountId, { status: "disputed" });
    await append(ctx, { caseId, actor: "human", type: "account_disputed", payload: { accountId: c.newAccountId } });
    await ctx.scheduler.runAfter(0, internal.package.generate, { caseId, thenRecovery: false });
  },
});

export const exceptionalRelease = mutation({
  args: { caseId: v.id("cases"), approverA: v.string(), approverB: v.string(), reason: v.string() },
  handler: async (ctx, { caseId, approverA, approverB, reason }) => {
    const a = approverA.trim();
    const b = approverB.trim();
    if (!a || !b) throw new ConvexError("two_approvers_required");
    if (a.toLowerCase() === b.toLowerCase()) throw new ConvexError("approvers_must_be_distinct");
    if (reason.trim().length < 20) throw new ConvexError("reason_too_short");
    const c = await ctx.db.get(caseId);
    if (!c) throw new ConvexError("case_not_found");
    if (c.state !== "NEEDS_HUMAN") throw new ConvexError(`exceptional_release_requires_NEEDS_HUMAN_not_${c.state}`);
    await ctx.db.patch(c.newAccountId, { status: "verified", verifiedByConfirmationId: undefined });
    await onAccountVerified(ctx, c, c.newAccountId);
    await transition(ctx, caseId, "VERIFIED", {
      actor: "human",
      type: "exceptional_release",
      payload: { approverA: a, approverB: b, reason },
    });
  },
});

/** Human: reject the requested account. Invoices return to the previous account if it is still usable. */
export const rejectChange = mutation({
  args: { caseId: v.id("cases"), reason: v.string() },
  handler: async (ctx, { caseId, reason }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new ConvexError("case_not_found");
    if (!["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "NEEDS_HUMAN"].includes(c.state)) throw new ConvexError(`cannot_reject_from_${c.state}`);
    await ctx.db.patch(c.newAccountId, { status: "rejected" });
    // Where do this account's invoices go? To the vendor's current verified account if one exists.
    // The previous account is restored from `superseded` only when nothing else is verified, i.e. it
    // was superseded by THIS change (manual edit) and not by another case that verified in the meantime.
    const vendorAccounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect();
    const currentVerified = vendorAccounts.filter((a) => a.status === "verified" && a._id !== c.newAccountId).sort((a, b) => (b.firstPaidAt ?? 0) - (a.firstPaidAt ?? 0))[0] ?? null;
    const old = c.oldAccountId ? await ctx.db.get(c.oldAccountId) : null;
    let target = currentVerified;
    let previousAccountRestored = false;
    if (!target && old && old.status === "superseded") {
      await ctx.db.patch(old._id, { status: "verified" });
      target = old;
      previousAccountRestored = true;
    }
    let restored = 0;
    if (target) {
      const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect();
      for (const inv of invoices) {
        if (inv.status !== "paid" && inv.remitAccountId === c.newAccountId) {
          await ctx.db.patch(inv._id, { remitAccountId: target._id, status: "open" });
          restored++;
        }
      }
    }
    await append(ctx, { caseId, actor: "human", type: "change_rejected", payload: { reason, restoredInvoices: restored, previousAccountRestored, invoicesNowRemitTo: target ? { routing: target.routing, last4: target.accountLast4, version: target.version } : null } });
    if (c.state !== "NEEDS_HUMAN") await transition(ctx, caseId, "NEEDS_HUMAN", { actor: "human", type: "human_review_requested", payload: { reason } }, reason);
    await transition(ctx, caseId, "CLOSED", { actor: "human", type: "case_closed", payload: { reason: "change_rejected" } });
  },
});

export const close = mutation({
  args: { caseId: v.id("cases"), reason: v.optional(v.string()) },
  handler: async (ctx, { caseId, reason }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new ConvexError("case_not_found");
    if (!isAllowedTransition(c.state, "CLOSED")) throw new ConvexError(`cannot_close_from_${c.state}`);
    await transition(ctx, caseId, "CLOSED", { actor: "human", type: "case_closed", payload: { reason: reason ?? null } });
  },
});

// ---- queries ----

function projectAccount(a: Doc<"bankAccounts"> | null) {
  if (!a) return null;
  return { _id: a._id, vendorId: a.vendorId, routing: a.routing, accountLast4: a.accountLast4, status: a.status, version: a.version, firstPaidAt: a.firstPaidAt, createdVia: a.createdVia, identityKey: a.identityKey };
}

export async function amountAtStake(ctx: QueryCtx, c: Doc<"cases">) {
  const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect();
  return invoices.filter((i) => i.status !== "paid" && i.remitAccountId === c.newAccountId).reduce((s, i) => s + i.amountCents, 0);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("cases").order("desc").collect();
    const out = [];
    for (const c of rows) {
      const vendor = await ctx.db.get(c.vendorId);
      const amount = await amountAtStake(ctx, c);
      out.push({ ...c, vendorName: vendor?.name ?? "?", amountAtStakeCents: amount });
    }
    return out;
  },
});

export const get = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const vendor = await ctx.db.get(c.vendorId);
    const newAccount = await ctx.db.get(c.newAccountId);
    const oldAccount = c.oldAccountId ? await ctx.db.get(c.oldAccountId) : null;
    const probe = c.probeId ? await ctx.db.get(c.probeId) : null;
    const payment = c.paymentId ? await ctx.db.get(c.paymentId) : null;
    const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect();
    const openInvoices = invoices.filter((i) => i.status !== "paid" && i.remitAccountId === c.newAccountId);
    return {
      ...c,
      vendor: vendor ? { _id: vendor._id, name: vendor.name, domain: vendor.domain, hasPortalLogin: vendor.hasPortalLogin } : null,
      newAccount: projectAccount(newAccount),
      oldAccount: projectAccount(oldAccount),
      // Probe projection: NO amount.
      probe: probe ? { state: probe.state, submittedAt: probe.submittedAt, settledAt: probe.settledAt, availableAt: probe.availableAt, railRef: probe.railRef } : null,
      payment: payment ? { _id: payment._id, amountCents: payment.amountCents, rail: payment.rail, railRef: payment.railRef, sentAt: payment.sentAt, landingState: payment.landingState, landingDeadlineAt: payment.landingDeadlineAt, initiatedBy: payment.initiatedBy } : null,
      openInvoices: openInvoices.map((i) => ({ _id: i._id, number: i.number, amountCents: i.amountCents, dueAt: i.dueAt, status: i.status })),
      amountAtStakeCents: openInvoices.reduce((s, i) => s + i.amountCents, 0),
    };
  },
});
