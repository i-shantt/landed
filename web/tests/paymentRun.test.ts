import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, manualEdit, VENDOR_B_ACCOUNT } from "./harness";

describe("paymentRun.preview", () => {
  it("classifies open invoices with the same guard as payments.send and never writes", async () => {
    const { t, ids } = await setup();
    const before = await t.query(api.paymentRun.preview, {});
    expect(before.totals.payable).toBe(2);
    expect(before.totals.blocked).toBe(0);
    await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    const after = await t.query(api.paymentRun.preview, {});
    const cc = after.lines.find((l) => l.number === "CC-2026-0412")!;
    expect(cc.decision).toEqual({ ok: false, reason: "destination_not_verified" });
    expect(after.totals.blocked).toBe(1);
    expect(after.totals.blockedCents).toBe(4_200_000);
    expect(after.totals.payable).toBe(1);
    const payments = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments.length).toBe(0);
  });
});
