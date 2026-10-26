// Checkpoint 1: the payment invariant holds end to end (section 9).
import { describe, it, expect } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { setup, manualEdit, pay, advanceToAvailability, vendorStatement, probeAmount, getCase, getAccount, VENDOR_B_ACCOUNT, VENDOR_C_ACCOUNT } from "./harness";

describe("checkpoint 1", () => {
  it("(a)-(h) full flow", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const northpeak = ids.vendors.northpeak as Id<"vendors">;
    const cleancoInvoice = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    const cleancoOld = ids.accounts.cleanco_main as Id<"bankAccounts">;

    // (a) manual edit -> new row unverified/probing, case held (probe already queued => PROBE_SENT)
    const a = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, cleancoOld);
    expect(a.reused).toBe(false);
    let acct = await getAccount(t, a.accountId);
    expect(["unverified", "probing"]).toContain(acct.status);
    expect(acct.version).toBe(1);
    let c = await getCase(t, a.caseId);
    expect(c.state).toBe("PROBE_SENT");
    expect((await getAccount(t, cleancoOld)).status).toBe("superseded");
    // the open invoice now remits to the held account
    const inv = await t.run(async (ctx) => ctx.db.get(cleancoInvoice));
    expect(inv!.remitAccountId).toBe(a.accountId);

    // (b) pay refused: destination not verified
    const r1 = await pay(t, cleancoInvoice);
    expect(r1).toEqual({ ok: false, reason: "destination_not_verified" });
    const payments0 = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments0.length).toBe(0);

    // (c) advance past ACH window + availability -> AWAITING_CONFIRMATION
    await advanceToAvailability(t, a.caseId);
    c = await getCase(t, a.caseId);
    expect(c.state).toBe("AWAITING_CONFIRMATION");

    // (d) correct statement from the contact of record -> VERIFIED
    const amount = await probeAmount(t, a.caseId);
    expect(amount).toBeGreaterThanOrEqual(11);
    expect(amount).toBeLessThanOrEqual(99);
    const vs = await vendorStatement(t, a.caseId, amount);
    expect(vs.delivered).toBe(true);
    c = await getCase(t, a.caseId);
    expect(c.state).toBe("VERIFIED");
    acct = await getAccount(t, a.accountId);
    expect(acct.status).toBe("verified");
    expect(acct.verifiedByConfirmationId).toBeDefined();

    // (e) pay -> payment row created, case PAID
    const r2 = await pay(t, cleancoInvoice);
    expect(r2.ok).toBe(true);
    const payments1 = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments1.length).toBe(1);
    expect(payments1[0].destinationAccountId).toBe(a.accountId);
    c = await getCase(t, a.caseId);
    expect(c.state).toBe("PAID");

    // (f) second pay -> same row, no second rail entry
    const r3 = await pay(t, cleancoInvoice);
    expect(r3.ok).toBe(true);
    expect((r3 as { paymentId: string }).paymentId).toBe((r2 as { paymentId: string }).paymentId);
    const payments2 = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments2.length).toBe(1);
    const ledger = await t.run(async (ctx) => ctx.db.query("simLedger").collect());
    const paymentEntries = ledger.flatMap((l) => l.entries).filter((e) => e.ref.includes("payment:"));
    expect(paymentEntries.length).toBe(1);

    // (g) wrong amount on a fresh case -> NEEDS_HUMAN
    const g = await manualEdit(t, northpeak, VENDOR_C_ACCOUNT.routing, VENDOR_C_ACCOUNT.accountNumber);
    await advanceToAvailability(t, g.caseId);
    expect((await getCase(t, g.caseId)).state).toBe("AWAITING_CONFIRMATION");
    const real = await probeAmount(t, g.caseId);
    const wrong = real === 99 ? 11 : real + 1;
    await vendorStatement(t, g.caseId, wrong);
    const gc = await getCase(t, g.caseId);
    expect(gc.state).toBe("NEEDS_HUMAN");
    expect(gc.humanReason).toBe("stated_amount_mismatch");
    expect((await getAccount(t, g.accountId)).status).not.toBe("verified");

    // (h) crafted invoice: cleanco invoice remitting to northpeak's verified account -> vendor mismatch
    const northpeakMain = ids.accounts.northpeak_main as Id<"bankAccounts">;
    const crafted = await t.run(async (ctx) =>
      ctx.db.insert("invoices", { vendorId: cleanco, number: "CRAFTED-1", amountCents: 100000, issuedAt: Date.now(), dueAt: Date.now() + 86400000, remitAccountId: northpeakMain, status: "open" })
    );
    const r4 = await pay(t, crafted);
    expect(r4).toEqual({ ok: false, reason: "destination_vendor_mismatch" });
    const payments3 = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments3.length).toBe(1);
  });
});
