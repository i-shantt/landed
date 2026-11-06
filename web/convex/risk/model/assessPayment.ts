// Model assessment of one candidate (or sent) payment, derived on read. Nothing here writes; the
// result informs people and the policy threshold and can never release money (tests/modelCannotRelease.test.ts).
import { internalQuery, query } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import transactionWeights from "../weights/transaction_lr.json";
import treeWeights from "../weights/transaction_gbm.json";
import { scoreLinear, type Contribution, type LinearWeights } from "./linear";
import { scoreTrees, type TreeWeights } from "./trees";
import { buildPaymentFeatures } from "./features";
import { loadHistory } from "./history";
import { getPolicy } from "../../controls/policy";

/** Glass-box baseline: logistic regression on the same features, reported next to the shipped score. */
export const TRANSACTION_WEIGHTS = transactionWeights as LinearWeights;
/** Shipped payment model: gradient-boosted trees (ml/trees.py), scored by scoreTrees with path attributions. */
export const TRANSACTION_TREES = treeWeights as TreeWeights;

export type ModelAssessment = {
  version: string;          // version of the shipped (tree) model
  family: string;           // "transaction_gbm"
  probability: number;      // raw model probability, the quantity the threshold was chosen on
  score: number;            // round(100 * probability)
  flagged: boolean;         // probability >= shipped threshold
  threshold: number;
  contributions: Contribution[]; // every feature's path attribution, sorted by |contribution|; sums to logit - bias
  linear: { version: string; probability: number; contributions: Contribution[] }; // the logistic-regression baseline on the same vector
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
  const s = scoreTrees(TRANSACTION_TREES, vector);
  const lin = scoreLinear(TRANSACTION_WEIGHTS, vector);
  return {
    version: TRANSACTION_TREES.version,
    family: TRANSACTION_TREES.family,
    probability: s.probability,
    score: Math.round(100 * s.probability),
    flagged: s.probability >= TRANSACTION_TREES.threshold,
    threshold: TRANSACTION_TREES.threshold,
    contributions: s.contributions,
    linear: { version: TRANSACTION_WEIGHTS.version, probability: lin.probability, contributions: lin.contributions },
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

export async function forPaymentRead(ctx: QueryCtx, { paymentId }: { paymentId: Id<"payments"> }) {
    const p = await ctx.db.get(paymentId);
    if (!p) return null;
    return assessSentPayment(ctx, p);
}
export const forPayment = query({ args: { paymentId: v.id("payments") }, handler: forPaymentRead });
export const forPaymentInternal = internalQuery({ args: { paymentId: v.id("payments") }, handler: forPaymentRead });
