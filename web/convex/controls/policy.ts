// Payment policy: configurable controls evaluated inside `payments.send` after the structural guard
// (I1). The guard answers "is this destination verified for this vendor?"; policy answers "does the
// company allow this payment right now?" Every control is off by default so the verification engine's
// behaviour is unchanged until an admin turns a control on. Refusals are returned, never thrown, so the
// audit event survives (same contract as the guard).
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { getSetting, setSetting } from "../settings";
import { append } from "../events";
import { requireActor } from "./actor";
import { assessCase } from "../risk/assess";
import { now as clockNow } from "../clock";
import { evaluateCandidateFor, destinationVerifiedAt } from "../monitoring/evaluate";

export type Policy = {
  /** Payments at or above this amount need a second, distinct approver. null = off. */
  dualApprovalAboveCents: number | null;
  /** Payments whose destination's case scored at or above this need an approval. null = off. */
  riskReviewAbove: number | null;
  /** Hours after verification before the first payment may go out. 0 = off. */
  coolingOffHours: number;
  /** Max total sent to one vendor in a rolling 24 hours. null = off. */
  maxPerVendorPerDayCents: number | null;
  /** First payment to a never-paid account must be ACH (recallable), not wire. */
  blockWireForFirstPayment: boolean;
  /** Refuse payments to vendors with an unresolved sanctions-screening match. */
  blockOnScreeningHit: boolean;
  /** Payments whose transaction-monitoring flag score is at or above this need an approval. null = off. */
  monitoringReviewAbove: number | null;
};

export const DEFAULT_POLICY: Policy = {
  dualApprovalAboveCents: null,
  riskReviewAbove: null,
  coolingOffHours: 0,
  maxPerVendorPerDayCents: null,
  blockWireForFirstPayment: false,
  blockOnScreeningHit: false,
  monitoringReviewAbove: null,
};

/** A sensible starting point for a mid-market AP team; applied by the "Recommended" button. */
export const RECOMMENDED_POLICY: Policy = {
  dualApprovalAboveCents: 2_500_000,
  riskReviewAbove: 45,
  coolingOffHours: 24,
  maxPerVendorPerDayCents: 25_000_000,
  blockWireForFirstPayment: true,
  blockOnScreeningHit: true,
  monitoringReviewAbove: null,
};

export type PolicyRefusal =
  | "policy_approval_required"
  | "policy_risk_review_required"
  | "policy_monitoring_review_required"
  | "policy_cooling_off"
  | "policy_velocity_exceeded"
  | "policy_wire_blocked_for_new_account"
  | "policy_screening_hit";

export type PolicyDecision = { ok: true; approvalId?: Id<"approvals"> } | { ok: false; reason: PolicyRefusal; detail?: Record<string, unknown> };

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export async function getPolicy(ctx: QueryCtx | MutationCtx): Promise<Policy> {
  const raw = await getSetting(ctx, "policy");
  if (!raw) return DEFAULT_POLICY;
  try {
    return { ...DEFAULT_POLICY, ...(JSON.parse(raw) as Partial<Policy>) };
  } catch {
    return DEFAULT_POLICY;
  }
}

function validate(p: Policy) {
  const nonNeg = (x: number | null, name: string) => {
    if (x !== null && (!Number.isFinite(x) || x < 0 || !Number.isInteger(x))) throw new ConvexError(`policy_${name}_must_be_a_non_negative_integer_or_null`);
  };
  nonNeg(p.dualApprovalAboveCents, "dualApprovalAboveCents");
  nonNeg(p.maxPerVendorPerDayCents, "maxPerVendorPerDayCents");
  if (p.riskReviewAbove !== null && (p.riskReviewAbove < 0 || p.riskReviewAbove > 100)) throw new ConvexError("policy_riskReviewAbove_must_be_0_to_100_or_null");
  if (p.monitoringReviewAbove !== null && (p.monitoringReviewAbove < 0 || p.monitoringReviewAbove > 100)) throw new ConvexError("policy_monitoringReviewAbove_must_be_0_to_100_or_null");
  if (!Number.isFinite(p.coolingOffHours) || p.coolingOffHours < 0 || p.coolingOffHours > 24 * 30) throw new ConvexError("policy_coolingOffHours_must_be_0_to_720");
}

/** When was this destination verified (bound confirmation or exceptional release)? */
async function verifiedAt(ctx: QueryCtx | MutationCtx, destination: Doc<"bankAccounts">): Promise<number | null> {
  return destinationVerifiedAt(ctx, destination._id);
}

async function approvedApproval(ctx: QueryCtx | MutationCtx, invoiceId: Id<"invoices">, destinationAccountId: Id<"bankAccounts">) {
  const rows = await ctx.db.query("approvals").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect();
  return rows.find((a) => a.status === "approved" && a.destinationAccountId === destinationAccountId) ?? null;
}

/** Which policy reasons currently require an approval for this invoice/destination (ignoring existing approvals). */
export async function approvalReasons(ctx: QueryCtx | MutationCtx, policy: Policy, invoice: Doc<"invoices">, destination: Doc<"bankAccounts">, at?: number): Promise<{ reasons: PolicyRefusal[]; riskScore: number | null; monitoringScore: number | null }> {
  const reasons: PolicyRefusal[] = [];
  let riskScore: number | null = null;
  let monitoringScore: number | null = null;
  if (policy.dualApprovalAboveCents !== null && invoice.amountCents >= policy.dualApprovalAboveCents) reasons.push("policy_approval_required");
  if (policy.riskReviewAbove !== null) {
    const cases = await ctx.db.query("cases").withIndex("by_newAccount", (q) => q.eq("newAccountId", destination._id)).collect();
    const latest = cases.sort((a, b) => b.openedAt - a.openedAt)[0];
    if (latest) {
      riskScore = (await assessCase(ctx, latest)).score;
      if (riskScore >= policy.riskReviewAbove) reasons.push("policy_risk_review_required");
    }
  }
  if (policy.monitoringReviewAbove !== null) {
    const t = at ?? (await clockNow(ctx));
    const m = await evaluateCandidateFor(ctx, { invoice, destination, at: t, rail: "ach", thresholdCents: policy.dualApprovalAboveCents });
    monitoringScore = m.flagScore;
    if (monitoringScore >= policy.monitoringReviewAbove) reasons.push("policy_monitoring_review_required");
  }
  return { reasons, riskScore, monitoringScore };
}

/**
 * Evaluate policy for a payment that already passed the structural guard. Order: screening,
 * wire-on-new-account, cooling-off, velocity, approvals. Fail closed on internal error.
 */
export async function evaluatePaymentPolicy(
  ctx: QueryCtx | MutationCtx,
  args: { invoice: Doc<"invoices">; destination: Doc<"bankAccounts">; rail: "ach" | "wire"; now: number }
): Promise<PolicyDecision> {
  const { invoice, destination, rail, now } = args;
  const policy = await getPolicy(ctx);

  if (policy.blockOnScreeningHit) {
    const hits = (await ctx.db.query("screenings").withIndex("by_vendor", (q) => q.eq("vendorId", invoice.vendorId)).collect()).filter((s) => s.status === "potential_match" || s.status === "confirmed_match");
    if (hits.length) return { ok: false, reason: "policy_screening_hit", detail: { screenings: hits.map((h) => h._id) } };
  }

  if (policy.blockWireForFirstPayment && rail === "wire" && destination.firstPaidAt === undefined) {
    return { ok: false, reason: "policy_wire_blocked_for_new_account", detail: { hint: "first payment to a new account must be ACH so it can be recalled" } };
  }

  if (policy.coolingOffHours > 0 && destination.firstPaidAt === undefined) {
    const at = await verifiedAt(ctx, destination);
    if (at !== null) {
      const until = at + policy.coolingOffHours * HOUR;
      if (now < until) return { ok: false, reason: "policy_cooling_off", detail: { verifiedAt: at, payableAt: until } };
    }
  }

  if (policy.maxPerVendorPerDayCents !== null) {
    const recent = (await ctx.db.query("payments").withIndex("by_vendor", (q) => q.eq("vendorId", invoice.vendorId)).collect()).filter((p) => p.sentAt > now - DAY);
    const sent = recent.reduce((s, p) => s + p.amountCents, 0);
    if (sent + invoice.amountCents > policy.maxPerVendorPerDayCents) return { ok: false, reason: "policy_velocity_exceeded", detail: { sentLast24hCents: sent, limitCents: policy.maxPerVendorPerDayCents } };
  }

  const { reasons } = await approvalReasons(ctx, policy, invoice, destination, now);
  if (reasons.length) {
    const approval = await approvedApproval(ctx, invoice._id, destination._id);
    if (!approval) return { ok: false, reason: reasons[0], detail: { required: reasons } };
    return { ok: true, approvalId: approval._id };
  }
  return { ok: true };
}

export const get = query({
  args: {},
  handler: async (ctx) => getPolicy(ctx),
});

export const set = mutation({
  args: {
    operatorId: v.optional(v.id("operators")),
    patch: v.object({
      dualApprovalAboveCents: v.optional(v.union(v.number(), v.null())),
      riskReviewAbove: v.optional(v.union(v.number(), v.null())),
      coolingOffHours: v.optional(v.number()),
      maxPerVendorPerDayCents: v.optional(v.union(v.number(), v.null())),
      blockWireForFirstPayment: v.optional(v.boolean()),
      blockOnScreeningHit: v.optional(v.boolean()),
      monitoringReviewAbove: v.optional(v.union(v.number(), v.null())),
    }),
  },
  handler: async (ctx, { operatorId, patch }) => {
    const op = await requireActor(ctx, ["admin"], operatorId);
    const before = await getPolicy(ctx);
    const next: Policy = { ...before };
    for (const [k, val] of Object.entries(patch)) if (val !== undefined) (next as unknown as Record<string, unknown>)[k] = val;
    validate(next);
    await setSetting(ctx, "policy", JSON.stringify(next));
    await append(ctx, { actor: "human", type: "policy_changed", payload: { by: op.name, operatorId: op._id, before, after: next } });
    return next;
  },
});

export const applyRecommended = mutation({
  args: { operatorId: v.optional(v.id("operators")) },
  handler: async (ctx, { operatorId }) => {
    const op = await requireActor(ctx, ["admin"], operatorId);
    const before = await getPolicy(ctx);
    await setSetting(ctx, "policy", JSON.stringify(RECOMMENDED_POLICY));
    await append(ctx, { actor: "human", type: "policy_changed", payload: { by: op.name, operatorId: op._id, before, after: RECOMMENDED_POLICY, preset: "recommended" } });
    return RECOMMENDED_POLICY;
  },
});
