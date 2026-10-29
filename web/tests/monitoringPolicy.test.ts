// Monitoring read model over Landed's tables, and the policy wiring that can turn a flag into a required approval.
import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, setupFull, pay, drain } from "./harness";
import { evaluateCandidateFor, computeMonitoring, computeVendorTrust } from "../convex/monitoring/evaluate";

const CC = "CC-2026-0412"; // cleanco, $42,000 open, cleanco_main verified
const NP = "NP-77102"; // northpeak, $18,250 open

async function roles(t: Awaited<ReturnType<typeof setup>>["t"]) {
  const ops = await t.query(api.controls.operators.list, {});
  return { admin: ops.find((o) => o.role === "admin")!, approver: ops.find((o) => o.role === "approver")!, clerk: ops.find((o) => o.role === "clerk")! };
}

describe("monitoring read model", () => {
  it("a sent payment is scored with the history before it and shows up in the overview; every monitoring query writes nothing", async () => {
    const { t, ids } = await setupFull();
    const before = await t.run(async (ctx) => (await ctx.db.query("payments").collect()).length);
    expect(before).toBe(0);
    const res = await pay(t, ids.invoices[CC] as Id<"invoices">);
    expect(res.ok).toBe(true);
    const o = await t.query(api.monitoring.queries.overview, {});
    expect(o.stats.scored).toBe(1);
    const row = o.recent[0];
    expect(row.invoiceNumber).toBe(CC);
    expect(row.monitoring.checked.length).toBe(9);
    expect(row.monitoring.signals.map((s) => s.id)).not.toContain("velocity_24h");
    expect(row.modelProbability).not.toBeNull();
    expect(o.trend30.length).toBe(30);
    expect(o.trend30.reduce((s, d) => s + d.payments, 0)).toBe(1);
    expect(o.trust.length).toBeGreaterThan(0);
    const tr = await t.query(api.monitoring.queries.trend, { window: "7d" });
    expect(tr.data.length).toBe(7);
    expect(tr.data[6].payments).toBe(1);
    const fp = await t.query(api.monitoring.queries.forPayment, { paymentId: (res as { paymentId: Id<"payments"> }).paymentId });
    expect(fp!.monitoring.flagScore).toBe(row.monitoring.flagScore);
    // no monitoring query wrote anything: payments, approvals and events are exactly what the one payment produced
    const counts = await t.run(async (ctx) => ({ payments: (await ctx.db.query("payments").collect()).length, approvals: (await ctx.db.query("approvals").collect()).length }));
    expect(counts).toEqual({ payments: 1, approvals: 0 });
  });

  it("history is cut strictly before the candidate: a live payment changes the vendor baseline only for later candidates", async () => {
    const { t, ids } = await setupFull();
    const inv = (await t.run(async (ctx) => ctx.db.get(ids.invoices[CC] as Id<"invoices">)))!;
    const dest = (await t.run(async (ctx) => ctx.db.get(inv.remitAccountId)))!;
    const res = await pay(t, inv._id);
    expect(res.ok).toBe(true);
    const sentAt = (await t.run(async (ctx) => ctx.db.get((res as { paymentId: Id<"payments"> }).paymentId)))!.sentAt;
    const big = { ...inv, amountCents: 7_000_000 }; // ~3.5x the seeded median
    const atSend = await t.run(async (ctx) => evaluateCandidateFor(ctx, { invoice: big, destination: dest, at: sentAt, rail: "ach", thresholdCents: null }));
    const after = await t.run(async (ctx) => evaluateCandidateFor(ctx, { invoice: big, destination: dest, at: sentAt + 1, rail: "ach", thresholdCents: null }));
    const ev = (r: typeof atSend) => r.signals.find((s) => s.id === "amount_ratio_median")?.evidence ?? null;
    expect(ev(atSend)).toMatch(/median of \$20,143/); // three seeded paid invoices only
    expect(ev(after)).not.toBeNull();
    expect(ev(after)).not.toBe(ev(atSend)); // the $42,000 payment is now part of the baseline
    const rows = await t.run(async (ctx) => computeMonitoring(ctx, null));
    expect(rows.length).toBe(1);
    expect(rows[0].monitoring.signals.map((s) => s.id)).not.toContain("first_payment_recently_verified");
  });

  it("vendor trust reflects tenure, seeded history and open cases", async () => {
    const { t, ids } = await setupFull();
    const clock = await t.query(api.clock.get, {});
    const cleanco = (await t.run(async (ctx) => ctx.db.get(ids.vendors.cleanco as Id<"vendors">)))!;
    const tr = await t.run(async (ctx) => computeVendorTrust(ctx, cleanco, clock.now));
    expect(tr.score).toBeGreaterThan(30);
    expect(tr.components.find((c) => c.id === "landed_payments")!.evidence).toMatch(/^3 payment/);
    const viaApi = await t.query(api.monitoring.queries.vendorTrust, { vendorId: cleanco._id });
    expect(viaApi!.score).toBe(tr.score);
  });
});

describe("policy.monitoringReviewAbove", () => {
  it("defaults to null and leaves a normal payment payable", async () => {
    const { t, ids } = await setup();
    const policy = await t.query(api.controls.policy.get, {});
    expect(policy.monitoringReviewAbove).toBeNull();
    expect((await pay(t, ids.invoices[CC] as Id<"invoices">)).ok).toBe(true);
  });

  it("set to 0 (every payment flags) refuses with policy_monitoring_review_required, an approval consumes, 101 is rejected", async () => {
    const { t, ids } = await setup();
    const { admin, approver, clerk } = await roles(t);
    await expect(t.mutation(api.controls.policy.set, { operatorId: admin._id, patch: { monitoringReviewAbove: 101 } })).rejects.toThrow(/monitoringReviewAbove/);
    await t.mutation(api.controls.policy.set, { operatorId: admin._id, patch: { monitoringReviewAbove: 0 } });
    const invoiceId = ids.invoices[NP] as Id<"invoices">;
    const refused = await pay(t, invoiceId);
    expect(refused).toEqual({ ok: false, reason: "policy_monitoring_review_required" });
    const run = await t.query(api.paymentRun.preview, {});
    const line = run.lines.find((l) => l.number === NP)!;
    expect(line.policy.ok).toBe(false);
    expect(line.policy.ok === false && line.policy.reason).toBe("policy_monitoring_review_required");
    const approvalId = await t.mutation(api.controls.approvals.request, { invoiceId, operatorId: clerk._id });
    const a = await t.run(async (ctx) => ctx.db.get(approvalId));
    expect(a!.requiredBy).toContain("policy_monitoring_review_required");
    await t.mutation(api.controls.approvals.decide, { approvalId, operatorId: approver._id, decision: "approved" });
    await drain(t);
    expect((await pay(t, invoiceId)).ok).toBe(true);
  });

  it("a threshold above the candidate's score does not interfere", async () => {
    const { t, ids } = await setup();
    const { admin } = await roles(t);
    await t.mutation(api.controls.policy.set, { operatorId: admin._id, patch: { monitoringReviewAbove: 100 } });
    expect((await pay(t, ids.invoices[CC] as Id<"invoices">)).ok).toBe(true);
  });
});
