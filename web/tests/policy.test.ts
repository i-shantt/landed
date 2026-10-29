import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, pay, drain, manualEdit, advanceToAvailability, vendorStatement, probeAmount, VENDOR_B_ACCOUNT, actors } from "./harness";
import { DEFAULT_POLICY } from "../convex/controls/policy";

const operators = actors; // signed-in clerk / approver / admin

describe("payment policy (controls layer, enforced inside payments.send)", () => {
  it("defaults are off: a verified destination pays exactly as before", async () => {
    const { t, ids } = await setup();
    const p = await t.query(api.controls.policy.get, {});
    expect(p).toEqual(DEFAULT_POLICY);
    const res = await pay(t, ids.invoices["CC-2026-0412"] as Id<"invoices">);
    expect(res.ok).toBe(true);
  });

  it("dual approval: above the threshold, send refuses until an approver (not the requester) approves; the approval is consumed", async () => {
    const { t, ids } = await setup();
    const { clerk, approver, admin } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { dualApprovalAboveCents: 100_000 } });
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;

    const refused = await pay(t, invoiceId);
    expect(refused).toEqual({ ok: false, reason: "policy_approval_required" });
    const ev = await t.run(async (ctx) => ctx.db.query("events").collect());
    expect(ev.some((e) => e.type === "payment_refused" && (e.payload as { reason: string }).reason === "policy_approval_required")).toBe(true);

    // the approver raises the request themselves; they cannot then approve it (segregation of duties)
    const approvalId = await approver.as.mutation(api.controls.approvals.request, { invoiceId });
    const again = await clerk.as.mutation(api.controls.approvals.request, { invoiceId });
    expect(again).toBe(approvalId); // idempotent: one pending approval per invoice+destination
    await expect(approver.as.mutation(api.controls.approvals.decide, { approvalId, decision: "approved" })).rejects.toThrow(/own/);
    // a clerk has no approval role
    await expect(clerk.as.mutation(api.controls.approvals.decide, { approvalId, decision: "approved" })).rejects.toThrow(/role/);

    // still refused while pending
    expect(await pay(t, invoiceId)).toEqual({ ok: false, reason: "policy_approval_required" });

    // a different approver (the admin) approves
    await admin.as.mutation(api.controls.approvals.decide, { approvalId, decision: "approved", note: "Invoice matches PO 4471" });
    const ok = await pay(t, invoiceId);
    expect(ok.ok).toBe(true);
    const a = await t.run(async (ctx) => ctx.db.get(approvalId));
    expect(a!.status).toBe("consumed");
  });

  it("a rejected approval keeps the payment blocked", async () => {
    const { t, ids } = await setup();
    const { clerk, approver, admin } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { dualApprovalAboveCents: 1 } });
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    const approvalId = await clerk.as.mutation(api.controls.approvals.request, { invoiceId });
    await approver.as.mutation(api.controls.approvals.decide, { approvalId, decision: "rejected", note: "No PO on file" });
    expect(await pay(t, invoiceId)).toEqual({ ok: false, reason: "policy_approval_required" });
  });

  it("only an admin can change policy; values are validated", async () => {
    const { t } = await setup();
    const { clerk, admin } = await operators(t);
    await expect(clerk.as.mutation(api.controls.policy.set, { patch: { dualApprovalAboveCents: 5 } })).rejects.toThrow();
    await expect(admin.as.mutation(api.controls.policy.set, { patch: { coolingOffHours: -1 } })).rejects.toThrow();
    await admin.as.mutation(api.controls.policy.set, { patch: { blockWireForFirstPayment: true } });
    expect((await t.query(api.controls.policy.get, {})).blockWireForFirstPayment).toBe(true);
  });

  it("wire to a never-paid account is refused when the control is on; ACH still passes", async () => {
    const { t, ids } = await setup();
    const { admin } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { blockWireForFirstPayment: true } });
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    await advanceToAvailability(t, r.caseId);
    await vendorStatement(t, r.caseId, await probeAmount(t, r.caseId));
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    expect(await pay(t, invoiceId, "wire")).toEqual({ ok: false, reason: "policy_wire_blocked_for_new_account" });
    expect((await pay(t, invoiceId, "ach")).ok).toBe(true);
  });

  it("cooling-off: a freshly verified account cannot be paid until the window passes", async () => {
    const { t, ids } = await setup();
    const { admin } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { coolingOffHours: 24 } });
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    await advanceToAvailability(t, r.caseId);
    await vendorStatement(t, r.caseId, await probeAmount(t, r.caseId));
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    expect(await pay(t, invoiceId)).toEqual({ ok: false, reason: "policy_cooling_off" });
    await t.mutation(api.clock.advance, { ms: 25 * 3600_000 });
    await drain(t);
    expect((await pay(t, invoiceId)).ok).toBe(true);
  });

  it("velocity: the daily per-vendor limit counts payments already sent", async () => {
    const { t, ids } = await setup();
    const { admin } = await operators(t);
    const inv = await t.run(async (ctx) => ctx.db.get(ids.invoices["CC-2026-0412"] as Id<"invoices">));
    await admin.as.mutation(api.controls.policy.set, { patch: { maxPerVendorPerDayCents: inv!.amountCents + 1 } });
    expect((await pay(t, inv!._id)).ok).toBe(true);
    // a second invoice for the same vendor, same destination, today
    const second = await t.run(async (ctx) => ctx.db.insert("invoices", { vendorId: inv!.vendorId, number: "CC-2026-0413", amountCents: 500, issuedAt: Date.now(), dueAt: Date.now(), remitAccountId: inv!.remitAccountId, status: "open" }));
    expect(await pay(t, second)).toEqual({ ok: false, reason: "policy_velocity_exceeded" });
  });

  it("risk review: a high-risk case needs an approval even below the amount threshold", async () => {
    const { t, ids } = await setup();
    const { admin, clerk, approver } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { riskReviewAbove: 1 } });
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    await advanceToAvailability(t, r.caseId);
    await vendorStatement(t, r.caseId, await probeAmount(t, r.caseId));
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    expect(await pay(t, invoiceId)).toEqual({ ok: false, reason: "policy_risk_review_required" });
    const approvalId = await clerk.as.mutation(api.controls.approvals.request, { invoiceId });
    const a = await t.run(async (ctx) => ctx.db.get(approvalId));
    expect(a!.requiredBy).toContain("policy_risk_review_required");
    expect(a!.riskScore).toBeGreaterThan(0);
    await approver.as.mutation(api.controls.approvals.decide, { approvalId, decision: "approved" });
    expect((await pay(t, invoiceId)).ok).toBe(true);
  });

  it("the payment run preview reports the policy decision per line", async () => {
    const { t, ids } = await setup();
    const { admin } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { dualApprovalAboveCents: 1 } });
    const run = await t.query(api.paymentRun.preview, {});
    const line = run.lines.find((l) => l.invoiceId === ids.invoices["CC-2026-0412"])!;
    expect(line.decision.ok).toBe(true);
    expect(line.policy).toEqual({ ok: false, reason: "policy_approval_required" });
    expect(run.totals.needsApproval).toBeGreaterThanOrEqual(1);
  });

  it("internal: policy is evaluated with the same code the guard uses; a refused policy never inserts a payment", async () => {
    const { t, ids } = await setup();
    const { admin } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { dualApprovalAboveCents: 1 } });
    await pay(t, ids.invoices["CC-2026-0412"] as Id<"invoices">);
    const payments = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments.length).toBe(0);
    // sanity: internal seed still works with the new tables
    await t.action(internal.seed.reseedInternal, { which: "minimal" });
  });
});
