// Monitoring read API for the UI and REST layer. Queries only; computed on read, never cached.
import { query } from "../_generated/server";
import { v } from "convex/values";
import { now } from "../clock";
import { getPolicy } from "../controls/policy";
import { computeMonitoring, computeTrend, computeVendorTrust } from "./evaluate";

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

export const forPayment = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const policy = await getPolicy(ctx);
    const rows = await computeMonitoring(ctx, policy.dualApprovalAboveCents);
    return rows.find((r) => r.paymentId === paymentId) ?? null;
  },
});
