// Model assessment of one candidate (or sent) payment, derived on read. Nothing here writes; the
// result informs people and the policy threshold and can never release money (tests/modelCannotRelease.test.ts).
import { query } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { v } from "convex/values";
import transactionWeights from "../weights/transaction_lr.json";
import { scoreLinear, type Contribution, type LinearWeights } from "./linear";
import { buildPaymentFeatures } from "./features";
import { loadHistory } from "./history";
import { getPolicy } from "../../controls/policy";

export const TRANSACTION_WEIGHTS = transactionWeights as LinearWeights;

export type ModelAssessment = {
  version: string;
  probability: number;      // raw model probability, the quantity the threshold was chosen on
  score: number;            // round(100 * probability)
  flagged: boolean;         // probability >= shipped threshold
  threshold: number;
  contributions: Contribution[]; // every feature, sorted by |contribution|
};

export async function assessPayment(
  ctx: QueryCtx | MutationCtx,
  args: { invoice: Doc<"invoices">; destination: Doc<"bankAccounts">; at: number; rail: "ach" | "wire" },
): Promise<ModelAssessment> {
  const [vendor, company, policy, vendorHistory, companyHistory] = await Promise.all([
    ctx.db.get(args.invoice.vendorId),
    ctx.db.query("company").first(),
    getPolicy(ctx),
    loadHistory(ctx, { vendorId: args.invoice.vendorId, before: args.at }),
    loadHistory(ctx, { before: args.at }),
  ]);
  const { vector } = buildPaymentFeatures({
    amountCents: args.invoice.amountCents,
    at: args.at,
    rail: args.rail,
    vendorId: args.invoice.vendorId,
    destinationAccountId: args.destination._id,
    destinationFirstPaidAt: args.destination.firstPaidAt,
    vendorOnboardedAt: vendor?.onboardedAt ?? args.at,
    vendorHistory,
    companyHistory,
    timezone: company?.timezone ?? "America/Los_Angeles",
    thresholdCents: policy.dualApprovalAboveCents,
  });
  const s = scoreLinear(TRANSACTION_WEIGHTS, vector);
  return {
    version: TRANSACTION_WEIGHTS.version,
    probability: s.probability,
    score: Math.round(100 * s.probability),
    flagged: s.probability >= TRANSACTION_WEIGHTS.threshold,
    threshold: TRANSACTION_WEIGHTS.threshold,
    contributions: s.contributions,
  };
}

/** Score a payment that was sent, with the history that existed strictly before it. */
export async function assessSentPayment(ctx: QueryCtx | MutationCtx, p: Doc<"payments">): Promise<ModelAssessment | null> {
  const [invoice, destination] = await Promise.all([ctx.db.get(p.invoiceId), ctx.db.get(p.destinationAccountId)]);
  if (!invoice || !destination) return null;
  // The destination's firstPaidAt may have been set by this very payment; history before sentAt decides "new".
  const dest = destination.firstPaidAt !== undefined && destination.firstPaidAt >= p.sentAt ? { ...destination, firstPaidAt: undefined } : destination;
  return assessPayment(ctx, { invoice: { ...invoice, amountCents: p.amountCents }, destination: dest, at: p.sentAt, rail: p.rail });
}

export const forPayment = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const p = await ctx.db.get(paymentId);
    if (!p) return null;
    return assessSentPayment(ctx, p);
  },
});
