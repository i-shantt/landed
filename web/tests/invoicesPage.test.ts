import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import { setup, actors, manualEdit, drain, VENDOR_B_ACCOUNT, advanceToAvailability, vendorStatement, probeAmount, pay } from "./harness";

describe("invoices.listAll for the /invoices page", () => {
  it("lists every invoice with vendor, remit projection, linked case and payment; sorted by due date; no secrets; session required", async () => {
    const { t, ids } = await setup();
    await expect(t.query(api.invoices.listAll, {})).rejects.toThrow(/unauthenticated/);
    const { clerk } = await actors(t);
    const before = await clerk.as.query(api.invoices.listAll, {});
    expect(before.length).toBeGreaterThan(1);
    for (let k = 1; k < before.length; k++) expect(before[k].dueAt).toBeGreaterThanOrEqual(before[k - 1].dueAt);
    const cc = before.find((i) => i.number === "CC-2026-0412");
    expect(cc?.vendorName).toMatch(/^CleanCo/);
    expect(cc?.status).toBe("open");
    expect(cc?.remit?.status).toBe("verified");
    expect(cc?.caseId).toBeNull();
    expect(cc?.payment).toBeNull();
    const text = JSON.stringify(before);
    expect(text).not.toMatch(/accountCiphertext|accountHash|identityKey|accountNumber"/);

    // A clerk types the attacker's account: the invoice is held, remits to the probing account and links to the open case.
    const edit = await manualEdit(t, ids.vendors.cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main);
    await drain(t);
    const held = (await clerk.as.query(api.invoices.listAll, {})).find((i) => i.number === "CC-2026-0412");
    expect(held?.status).toBe("held");
    expect(held?.remit?.status).toBe("probing");
    expect(held?.remit?.last4).toBe(VENDOR_B_ACCOUNT.accountNumber.slice(-4));
    expect(held?.caseId).toBe(edit.caseId);
    expect(held?.caseState).toBe("PROBE_SENT");
  });
  it("after the vendor of record confirms and the clerk pays, the row is paid with its payment and no open case", async () => {
    const { t, ids } = await setup();
    const { clerk } = await actors(t);
    const edit = await manualEdit(t, ids.vendors.cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main);
    await drain(t);
    await advanceToAvailability(t, edit.caseId);
    await vendorStatement(t, edit.caseId, await probeAmount(t, edit.caseId));
    await drain(t);
    const res = await pay(t, ids.invoices["CC-2026-0412"]);
    expect(res.ok).toBe(true);
    const row = (await clerk.as.query(api.invoices.listAll, {})).find((i) => i.number === "CC-2026-0412");
    expect(row?.status).toBe("paid");
    expect(row?.remit?.status).toBe("verified");
    expect(row?.payment?.landingState).toBe("pending");
    expect(row?.payment?.rail).toBe("ach");
  });
});
