// The learned layer reads Landed's own history correctly and rides along on the existing read models.
import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, setupFull, pay, manualEdit, VENDOR_B_ACCOUNT } from "./harness";
import { loadHistory } from "../convex/risk/model/history";
import { buildPaymentFeatures } from "../convex/risk/model/features";
import { assessPayment } from "../convex/risk/model/assessPayment";

const CC = "CC-2026-0412"; // cleanco, open, $42,000

async function admin(t: Awaited<ReturnType<typeof setup>>["t"]) {
  const ops = await t.query(api.controls.operators.list, {});
  return ops.find((o) => o.role === "admin")!;
}

describe("payment history (payments + paid invoices without a payment row)", () => {
  it("seeded paid invoices appear as invoice_history; a live payment replaces its invoice and is tagged payment", async () => {
    const { t, ids } = await setupFull();
    const vendorId = ids.vendors.cleanco as Id<"vendors">;
    const before = await t.run(async (ctx) => loadHistory(ctx, { vendorId }));
    expect(before.length).toBe(3);
    expect(before.every((r) => r.source === "invoice_history")).toBe(true);
    expect(before.map((r) => r.at)).toEqual([...before.map((r) => r.at)].sort((a, b) => a - b));
    const res = await pay(t, ids.invoices[CC] as Id<"invoices">);
    expect(res.ok).toBe(true);
    const after = await t.run(async (ctx) => loadHistory(ctx, { vendorId }));
    expect(after.length).toBe(4);
    expect(after.filter((r) => r.source === "payment").length).toBe(1);
    expect(after.find((r) => r.source === "payment")!.amountCents).toBe(4_200_000);
    // `before` cuts strictly
    const sentAt = after.find((r) => r.source === "payment")!.at;
    const cut = await t.run(async (ctx) => loadHistory(ctx, { vendorId, before: sentAt }));
    expect(cut.length).toBe(3);
    // company-wide history covers every vendor
    const company = await t.run(async (ctx) => loadHistory(ctx));
    expect(company.length).toBeGreaterThan(after.length);
  });
});

describe("Landed feature mapping", () => {
  it("counts the vendor's payments in the last 24 h after a payment, and treats a verified never-paid account as a new beneficiary", async () => {
    const { t, ids } = await setupFull();
    const vendorId = ids.vendors.cleanco as Id<"vendors">;
    const dest = await t.run(async (ctx) => ctx.db.get(ids.accounts.cleanco_main as Id<"bankAccounts">));
    const clock = await t.query(api.clock.get, {});
    const now = clock.now;
    const build = async (firstPaidAt: number | undefined, at: number) =>
      t.run(async (ctx) => {
        const vendorHistory = await loadHistory(ctx, { vendorId, before: at });
        const companyHistory = await loadHistory(ctx, { before: at });
        return buildPaymentFeatures({ amountCents: 4_200_000, at, rail: "wire", vendorId, destinationAccountId: dest!._id, destinationFirstPaidAt: firstPaidAt, vendorOnboardedAt: 0, vendorHistory, companyHistory, timezone: "America/Los_Angeles", thresholdCents: null });
      });
    const f0 = (await build(dest!.firstPaidAt, now)).features;
    expect(f0.is_new_beneficiary).toBe(0);
    expect(f0.type_transfer).toBe(1);
    expect(f0.bene_count_24h).toBe(0);
    expect(f0.bene_amount_ratio_missing).toBe(0); // three paid invoices make a baseline
    expect(f0.bene_amount_ratio_median).toBeCloseTo(42_000 / 20_143, 6);
    expect(f0.is_weekend_missing).toBe(0);
    // even without firstPaidAt, seeded paid invoices to this account count as having paid it before
    expect((await build(undefined, now)).features.is_new_beneficiary).toBe(0);
    await pay(t, ids.invoices[CC] as Id<"invoices">);
    const f1 = (await build(dest!.firstPaidAt, now + 60_000)).features;
    expect(f1.bene_count_24h).toBe(1);
    expect(f1.bene_count_7d).toBe(1);
    expect(f1.payer_count_24h).toBe(1);
  });

  it("a manual bank edit creates an unverified destination that scores as a first payment to the account", async () => {
    const { t, ids } = await setup();
    const vendorId = ids.vendors.cleanco as Id<"vendors">;
    const { caseId } = await manualEdit(t, vendorId, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    const c = (await t.run(async (ctx) => ctx.db.get(caseId)))!;
    const risk = await t.query(api.risk.assess.forCase, { caseId });
    expect(risk!.model).toBeDefined();
    expect(risk!.model!.text).toBeNull(); // no trigger email on a manual edit
    expect(risk!.model!.payment).not.toBeNull();
    const p = risk!.model!.payment!;
    const newBene = p.contributions.find((k) => k.feature === "is_new_beneficiary")!;
    expect(newBene.value).toBe(1);
    expect(p.version).toMatch(/^transaction_lr-/);
    expect(risk!.model!.combinedScore).toBeGreaterThanOrEqual(risk!.score);
    expect(risk!.model!.combinedScore).toBe(Math.max(risk!.score, Math.round(100 * p.probability)));
    // rules score is unchanged by the model (policy input, scenario suite)
    expect(risk!.score).toBe(risk!.signals.reduce((s, x) => s + x.weight, 0) > 100 ? 100 : risk!.signals.reduce((s, x) => s + x.weight, 0));
    expect(c.newAccountId).toBeDefined();
  });

  it("just_under_threshold follows the company policy's dual-approval amount", async () => {
    const { t, ids } = await setup();
    const inv = (await t.run(async (ctx) => ctx.db.get(ids.invoices[CC] as Id<"invoices">)))!;
    const dest = (await t.run(async (ctx) => ctx.db.get(inv.remitAccountId)))!;
    const clock = await t.query(api.clock.get, {});
    const a0 = await t.run(async (ctx) => assessPayment(ctx, { invoice: inv, destination: dest, at: clock.now, rail: "ach" }));
    expect(a0.contributions.find((k) => k.feature === "just_under_threshold")!.value).toBe(0);
    const adm = await admin(t);
    await t.mutation(api.controls.policy.set, { operatorId: adm._id, patch: { dualApprovalAboveCents: 4_400_000 } }); // $42,000 is within 90% of $44,000
    const a1 = await t.run(async (ctx) => assessPayment(ctx, { invoice: inv, destination: dest, at: clock.now, rail: "ach" }));
    expect(a1.contributions.find((k) => k.feature === "just_under_threshold")!.value).toBe(1);
    expect(a1.probability).not.toBe(a0.probability); // the feature carries weight (negative on the public data: structuring is an AP pattern the rules/monitoring layer owns)
    expect(a1.contributions.find((k) => k.feature === "just_under_threshold")!.contribution).not.toBe(a0.contributions.find((k) => k.feature === "just_under_threshold")!.contribution);
    const writes = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(writes.length).toBe(0);
  });
});

describe("read models carry the model", () => {
  it("payment run lines that the guard would pay carry a model assessment; blocked lines do not", async () => {
    const { t, ids } = await setup();
    const run = await t.query(api.paymentRun.preview, {});
    const cc = run.lines.find((l) => l.number === CC)!;
    expect(cc.decision.ok).toBe(true);
    expect(cc.risk).not.toBeNull();
    expect(cc.risk!.probability).toBeGreaterThanOrEqual(0);
    expect(cc.risk!.contributions.length).toBe(20);
    await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    const after = await t.query(api.paymentRun.preview, {});
    expect(after.lines.find((l) => l.number === CC)!.risk).toBeNull();
  });

  it("forPayment scores a sent payment with the history that existed before it", async () => {
    const { t, ids } = await setup();
    const res = await pay(t, ids.invoices[CC] as Id<"invoices">);
    expect(res.ok).toBe(true);
    const r = await t.query(api.risk.model.assessPayment.forPayment, { paymentId: (res as { paymentId: Id<"payments"> }).paymentId });
    expect(r).not.toBeNull();
    expect(r!.contributions.find((k) => k.feature === "bene_count_24h")!.value).toBe(0); // itself excluded
    expect(r!.contributions.find((k) => k.feature === "is_new_beneficiary")!.value).toBe(0); // account had firstPaidAt before
    expect(r!.score).toBe(Math.round(100 * r!.probability));
  });
});
