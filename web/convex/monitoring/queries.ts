// Monitoring read API for the UI and REST layer. Queries only; computed on read, never cached.
import { query } from "../_generated/server";
import { v } from "convex/values";
import { now } from "../clock";
import { getPolicy } from "../controls/policy";
import { computeMonitoring, computeTrend, computeVendorTrust } from "./evaluate";
import { modelHealth, type Reference } from "./drift";
import type { Doc } from "../_generated/dataModel";
import { dispositionFor, summariseLabels } from "./labels";
import { FEATURE_NAMES } from "../risk/model/features";
import reference from "../risk/weights/transaction_reference.json";
import { TRANSACTION_TREES, TRANSACTION_WEIGHTS } from "../risk/model/assessPayment";

const REFERENCE = reference as Reference;

const DAY = 86_400_000;

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const t = await now(ctx);
    const policy = await getPolicy(ctx);
    const rows = await computeMonitoring(ctx, policy.dualApprovalAboveCents);
    const last7 = rows.filter((r) => r.sentAt >= t - 7 * DAY);
    const flagged = rows.filter((r) => r.monitoring.flagged);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const vendors = await ctx.db.query("vendors").collect();
    const trust = [] as Awaited<ReturnType<typeof computeVendorTrust>>[];
    for (const vnd of vendors) trust.push(await computeVendorTrust(ctx, vnd, t));
    trust.sort((a, b) => a.score - b.score);
    return {
      now: t,
      thresholdCents: policy.dualApprovalAboveCents,
      reviewAbove: policy.monitoringReviewAbove,
      stats: {
        scored: rows.length,
        flagged: flagged.length,
        flagged7d: last7.filter((r) => r.monitoring.flagged).length,
        avgFlagScore7d: avg(last7.map((r) => r.monitoring.flagScore)),
        sent7dCents: last7.reduce((s, r) => s + r.amountCents, 0),
        modelFlagged: rows.filter((r) => (r.modelProbability ?? 0) >= 0.5).length,
      },
      flagged: flagged.slice(0, 50),
      recent: rows.slice(0, 20),
      trend30: await computeTrend(ctx, { now: t, days: 30, rows }),
      trust,
    };
  },
});

export const trend = query({
  args: { window: v.union(v.literal("7d"), v.literal("30d")) },
  handler: async (ctx, { window }) => {
    const t = await now(ctx);
    const policy = await getPolicy(ctx);
    const rows = await computeMonitoring(ctx, policy.dualApprovalAboveCents);
    return { window, now: t, data: await computeTrend(ctx, { now: t, days: window === "7d" ? 7 : 30, rows }) };
  },
});

export const vendorTrust = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    const vnd = await ctx.db.get(vendorId);
    if (!vnd) return null;
    return computeVendorTrust(ctx, vnd, await now(ctx));
  },
});

/** Health of the shipped model on read: score stability, drift against the training reference, agreement with the baseline. */
export const health = query({
  args: {},
  handler: async (ctx) => {
    const t = await now(ctx);
    const policy = await getPolicy(ctx);
    const rows = await computeMonitoring(ctx, policy.dualApprovalAboveCents);
    const scored = rows.filter((r) => r.modelProbability !== null);
    return {
      now: t,
      ...modelHealth({
        rows: scored.map((r) => ({ sentAt: r.sentAt, probability: r.modelProbability as number, linearProbability: r.modelLinearProbability, flagged: r.modelFlagged ?? false, linearFlagged: r.modelLinearFlagged, vector: r.modelFeatures })),
        reference: REFERENCE,
        version: TRANSACTION_TREES.version,
        linearVersion: TRANSACTION_WEIGHTS.version,
      }),
      threshold: TRANSACTION_TREES.threshold,
      windowLimit: 500,
    };
  },
});

/**
 * Operator dispositions joined with the feature vector at send time: the retraining export (ml/feedback.py).
 * Labels come from landing state, case outcome and fraud reports, never from the model. Pending payments are counted, not exported.
 */
export const labels = query({
  args: {},
  handler: async (ctx) => {
    const t = await now(ctx);
    const policy = await getPolicy(ctx);
    const rows = await computeMonitoring(ctx, policy.dualApprovalAboveCents);
    const out: {
      paymentId: string; vendorId: string; sentAt: number; amountCents: number; rail: "ach" | "wire";
      label: 0 | 1; source: string; decidedAt: number | null;
      modelVersion: string | null; probability: number | null; flagged: boolean | null; linearProbability: number | null; features: number[] | null;
      rulesFlagScore: number; rulesFlagged: boolean;
    }[] = [];
    const dispositions = [];
    let noCaseEvents: Doc<"events">[] | null = null; // events of payments that had no case (seed-verified destinations), fetched once
    for (const r of rows) {
      const caseDoc = r.caseId ? await ctx.db.get(r.caseId) : null;
      let caseEvents: Doc<"events">[] = [];
      if (r.caseId) caseEvents = await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", r.caseId!)).collect();
      else noCaseEvents ??= await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", undefined)).collect();
      const pool = r.caseId ? caseEvents : (noCaseEvents ?? []);
      const paymentEvents = pool.filter((e) => (e.payload as { paymentId?: string } | null)?.paymentId === r.paymentId);
      const d = dispositionFor({ landingState: r.landingState, caseState: caseDoc?.state ?? null, caseEvents, paymentEvents });
      dispositions.push(d);
      if (!d) continue;
      out.push({
        paymentId: r.paymentId, vendorId: r.vendorId, sentAt: r.sentAt, amountCents: r.amountCents, rail: r.rail,
        label: d.label, source: d.source, decidedAt: d.decidedAt,
        modelVersion: r.modelVersion, probability: r.modelProbability, flagged: r.modelFlagged, linearProbability: r.modelLinearProbability, features: r.modelFeatures,
        rulesFlagScore: r.monitoring.flagScore, rulesFlagged: r.monitoring.flagged,
      });
    }
    return { now: t, featureNames: [...FEATURE_NAMES], summary: summariseLabels(dispositions), rows: out };
  },
});

export const forPayment = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const policy = await getPolicy(ctx);
    const rows = await computeMonitoring(ctx, policy.dualApprovalAboveCents);
    return rows.find((r) => r.paymentId === paymentId) ?? null;
  },
});
