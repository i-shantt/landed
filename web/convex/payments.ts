// The payment boundary (I1). `send` is the ONLY function that inserts a payment.
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { append } from "./events";
import { canPay } from "./guard";
import { now, HOUR, endOfBusinessDay } from "./clock";
import { createTimer } from "./timers";
import { transition } from "./cases";
import { decryptAccount } from "./crypto";
import { selectRail } from "./rails/select";
import { evaluatePaymentPolicy, type PolicyRefusal } from "./controls/policy";

export async function currentVersionForIdentity(ctx: MutationCtx, identityKey: string): Promise<number | null> {
  const latest = await ctx.db
    .query("bankAccounts")
    .withIndex("by_identity", (q) => q.eq("identityKey", identityKey))
    .order("desc")
    .first();
  return latest ? latest.version : null;
}

export const send = mutation({
  args: {
    invoiceId: v.id("invoices"),
    initiatedBy: v.string(),
    rail: v.optional(v.union(v.literal("ach"), v.literal("wire"))),
  },
  handler: async (ctx, { invoiceId, initiatedBy, rail }) => {
    const railKind = rail ?? "ach";
    const invoice = await ctx.db.get(invoiceId);
    // I6: a repeat call for the same invoice+destination returns the existing row and never touches the rail.
    if (invoice) {
      const prior = await ctx.db.query("payments").withIndex("by_key", (q) => q.eq("idempotencyKey", `payment:${invoiceId}:${invoice.remitAccountId}`)).unique();
      if (prior) return { ok: true as const, paymentId: prior._id, duplicate: true };
    }
    const destination = invoice ? await ctx.db.get(invoice.remitAccountId) : null;
    const currentVersion = destination ? await currentVersionForIdentity(ctx, destination.identityKey) : null;

    // Fail closed: any thrown error inside the guard is a refusal.
    let decision: ReturnType<typeof canPay>;
    try {
      decision = canPay({ invoice, destination, currentVersionForIdentity: currentVersion });
    } catch {
      decision = { ok: false, reason: "destination_missing" };
    }

    // Find the case for this destination (if any) for the audit trail.
    const relatedCases = destination
      ? await ctx.db.query("cases").withIndex("by_newAccount", (q) => q.eq("newAccountId", destination._id)).collect()
      : [];
    const openCase = relatedCases.find((c) => c.state !== "CLOSED") ?? null;

    if (!decision.ok) {
      await append(ctx, {
        caseId: openCase?._id,
        actor: "human",
        type: "payment_refused",
        payload: {
          reason: decision.reason,
          invoiceId,
          invoiceNumber: invoice?.number ?? null,
          amountCents: invoice?.amountCents ?? null,
          destination: destination ? { routing: destination.routing, last4: destination.accountLast4, status: destination.status, version: destination.version, vendorId: destination.vendorId } : null,
          initiatedBy,
        },
      });
      // Deliberately NOT a throw: a thrown ConvexError would roll back this transaction and erase the
      // `payment_refused` audit event. The refusal is returned as a machine-readable value instead;
      // callers (UI, HTTP, tests) treat ok:false as the refusal.
      return { ok: false as const, code: "payment_refused" as const, reason: decision.reason };
    }

    const inv = invoice!;
    const dest = destination!;
    const idempotencyKey = `payment:${invoiceId}:${dest._id}`;
    const existing = await ctx.db.query("payments").withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey)).unique();
    if (existing) return { ok: true as const, paymentId: existing._id, duplicate: true };

    const t = await now(ctx);

    // Policy layer (controls/policy.ts): company rules on top of the structural guard. Off by default.
    // Fail closed: an internal error inside policy evaluation is a refusal, logged like any other.
    let policy: Awaited<ReturnType<typeof evaluatePaymentPolicy>>;
    try {
      policy = await evaluatePaymentPolicy(ctx, { invoice: inv, destination: dest, rail: railKind, now: t });
    } catch (e) {
      policy = { ok: false, reason: "policy_approval_required", detail: { error: String((e as Error)?.message ?? e) } };
    }
    if (!policy.ok) {
      await append(ctx, {
        caseId: openCase?._id,
        actor: "human",
        type: "payment_refused",
        payload: { reason: policy.reason, layer: "policy", detail: policy.detail ?? null, invoiceId, invoiceNumber: inv.number, amountCents: inv.amountCents, rail: railKind, destination: { routing: dest.routing, last4: dest.accountLast4, status: dest.status, version: dest.version, vendorId: dest.vendorId }, initiatedBy },
      });
      return { ok: false as const, code: "payment_refused" as const, reason: policy.reason as PolicyRefusal | ReturnType<typeof canPay> extends { ok: false; reason: infer R } ? R : never };
    }
    const landingCheckAt = railKind === "ach" ? t + 2 * HOUR : t + 1 * HOUR;
    const landingDeadlineAt = railKind === "ach" ? Math.max(endOfBusinessDay(t), landingCheckAt + HOUR) : t + 4 * HOUR;

    const paymentId = await ctx.db.insert("payments", {
      caseId: openCase?._id,
      invoiceId,
      vendorId: inv.vendorId,
      destinationAccountId: dest._id,
      amountCents: inv.amountCents,
      rail: railKind,
      idempotencyKey,
      sentAt: t,
      landingState: "pending",
      landingDeadlineAt,
      initiatedBy,
    });
    await ctx.db.patch(invoiceId, { status: "paid" });
    if (dest.firstPaidAt === undefined) await ctx.db.patch(dest._id, { firstPaidAt: t });
    if (policy.approvalId) {
      await ctx.db.patch(policy.approvalId, { status: "consumed" });
      await append(ctx, { caseId: openCase?._id, actor: "system", type: "approval_consumed", payload: { approvalId: policy.approvalId, paymentId } });
    }
    await append(ctx, {
      caseId: openCase?._id,
      actor: "human",
      type: "payment_sent",
      payload: { paymentId, invoiceNumber: inv.number, amountCents: inv.amountCents, rail: railKind, destination: { routing: dest.routing, last4: dest.accountLast4, version: dest.version }, initiatedBy, landingDeadlineAt },
    });
    if (openCase && openCase.state === "VERIFIED") {
      await ctx.db.patch(openCase._id, { paymentId });
      await transition(ctx, openCase._id, "PAID", { actor: "human", type: "case_paid", payload: { paymentId } });
    }
    // Every payment is landing-tracked, with or without a case (the case, when present, drives the vendor call).
    const timerCase = openCase && openCase.state === "PAID" ? openCase._id : undefined;
    await createTimer(ctx, { caseId: timerCase, kind: "landing_check", dueAt: landingCheckAt, payload: { paymentId } });
    await createTimer(ctx, { caseId: timerCase, kind: "landing_deadline", dueAt: landingDeadlineAt, payload: { paymentId } });
    await ctx.scheduler.runAfter(0, internal.payments.submitToRail, { paymentId });
    return { ok: true as const, paymentId, duplicate: false };
  },
});

export const getForRail = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const p = await ctx.db.get(paymentId);
    if (!p) return null;
    const a = await ctx.db.get(p.destinationAccountId);
    if (!a) return null;
    return { payment: p, routing: a.routing, accountCiphertext: a.accountCiphertext };
  },
});

export const setRailRef = internalMutation({
  args: { paymentId: v.id("payments"), railRef: v.string(), railName: v.string() },
  handler: async (ctx, { paymentId, railRef, railName }) => {
    const p = await ctx.db.get(paymentId);
    if (!p || p.railRef) return;
    await ctx.db.patch(paymentId, { railRef });
    await append(ctx, { caseId: p.caseId, actor: "rail", type: "payment_accepted_by_rail", payload: { paymentId, rail: railName, railRef } });
  },
});

export const recordRailError = internalMutation({
  args: { paymentId: v.id("payments"), error: v.string() },
  handler: async (ctx, { paymentId, error }) => {
    const p = await ctx.db.get(paymentId);
    if (!p) return;
    await append(ctx, { caseId: p.caseId, actor: "rail", type: "payment_rail_error", payload: { paymentId, error } });
  },
});

export const submitToRail = internalAction({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const data = await ctx.runQuery(internal.payments.getForRail, { paymentId });
    if (!data || data.payment.railRef) return;
    try {
      const accountNumber = await decryptAccount(data.accountCiphertext);
      const rail = await selectRail(ctx);
      const { railRef } = await rail.sendCredit({
        routing: data.routing,
        accountNumber,
        amountCents: data.payment.amountCents,
        memo: `INV ${data.payment.invoiceId}`,
        idempotencyKey: data.payment.idempotencyKey,
      });
      await ctx.runMutation(internal.payments.setRailRef, { paymentId, railRef, railName: rail.name });
    } catch (e) {
      await ctx.runMutation(internal.payments.recordRailError, { paymentId, error: String((e as Error)?.message ?? e) });
    }
  },
});

/** Landing: the contact of record states the full payment amount that arrived. */
export async function recordLanding(
  ctx: MutationCtx,
  args: { paymentId: Id<"payments">; statedAmountCents: number | null; contactId: Id<"contacts"> }
) {
  const p = await ctx.db.get(args.paymentId);
  if (!p || p.landingState !== "pending") return { ok: false, reason: "payment_not_pending" };
  const contact = await ctx.db.get(args.contactId);
  if (!contact || contact.trustLevel !== "record" || contact.supersededAt !== undefined || contact.vendorId !== p.vendorId) {
    await append(ctx, { caseId: p.caseId, actor: "system", type: "landing_statement_ignored", payload: { reason: "contact_not_record" } });
    return { ok: false, reason: "contact_not_record" };
  }
  if (args.statedAmountCents !== p.amountCents) {
    await append(ctx, { caseId: p.caseId, actor: "system", type: "landing_mismatch", payload: { expectedCents: p.amountCents, statedCents: args.statedAmountCents } });
    return { ok: false, reason: "landing_amount_mismatch" };
  }
  const t = await now(ctx);
  await ctx.db.patch(p._id, { landingState: "landed" });
  await append(ctx, { caseId: p.caseId, actor: "vendor", type: "payment_landed", payload: { paymentId: p._id, amountCents: p.amountCents, confirmedAt: t } });
  if (p.caseId) {
    const c = await ctx.db.get(p.caseId);
    if (c && c.state === "PAID") {
      await transition(ctx, c._id, "LANDED", { actor: "system", type: "case_landed", payload: { paymentId: p._id } });
      await transition(ctx, c._id, "CLOSED", { actor: "system", type: "case_closed", payload: { reason: "landed" } });
    }
  }
  return { ok: true };
}

export const recordLandingInternal = internalMutation({
  args: { paymentId: v.id("payments"), statedAmountCents: v.union(v.number(), v.null()), contactId: v.id("contacts") },
  handler: async (ctx, args) => recordLanding(ctx, args),
});

/**
 * Human attestation that a payment landed (e.g. the vendor's AR confirmed receipt on the number of
 * record, or a remittance acknowledgement arrived). Used for payments that have no verification case
 * driving an automated landing call. Logged with the operator's name; cannot re-attest a decided payment.
 */
export const attestLanded = mutation({
  args: { paymentId: v.id("payments"), operatorId: v.id("operators"), note: v.string() },
  handler: async (ctx, { paymentId, operatorId, note }) => {
    const op = await ctx.db.get(operatorId);
    if (!op || !op.active) throw new ConvexError("operator_unknown_or_inactive");
    if (note.trim().length < 3) throw new ConvexError("note_required");
    const p = await ctx.db.get(paymentId);
    if (!p) throw new ConvexError("payment_not_found");
    if (p.landingState === "landed") throw new ConvexError("already_landed");
    const t = await now(ctx);
    await ctx.db.patch(p._id, { landingState: "landed" });
    await append(ctx, { caseId: p.caseId, actor: "human", type: "payment_landed", payload: { paymentId: p._id, amountCents: p.amountCents, confirmedAt: t, attestedBy: op.name, operatorId, note: note.trim(), method: "operator_attestation" } });
    if (p.caseId) {
      const c = await ctx.db.get(p.caseId);
      if (c && (c.state === "PAID" || c.state === "UNCONFIRMED")) {
        if (c.state === "UNCONFIRMED") {
          // Money turned up after the deadline: close through RECOVERY → CLOSED with the attestation on record.
          await transition(ctx, c._id, "RECOVERY", { actor: "human", type: "recovery_started", payload: { reason: "late_landing_attested" } });
          await transition(ctx, c._id, "CLOSED", { actor: "human", type: "case_closed", payload: { reason: "landed_late_attested" } });
        } else {
          await transition(ctx, c._id, "LANDED", { actor: "human", type: "case_landed", payload: { paymentId: p._id, method: "operator_attestation" } });
          await transition(ctx, c._id, "CLOSED", { actor: "system", type: "case_closed", payload: { reason: "landed" } });
        }
      }
    }
    return { ok: true };
  },
});

export const listForInvoice = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => ctx.db.query("payments").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
});

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("payments").order("desc").take(100),
});
