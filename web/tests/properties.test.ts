// Property-based tests (fast-check) for the pure modules a reviewer would most want proven, not sampled:
// the payment boundary (canPay), the release gate (canRelease), and the two payment-file builders.
// Each property states an invariant that must hold for every generated input; a failure prints the shrunk counterexample.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { canPay, canRelease } from "../convex/guard";
import { mkAccount, mkInvoice, mkCase, mkProbe, mkConfirmation, mkContact, vendorA, vendorB, caseB, probeB, T0 } from "./fixtures";
import { buildNachaFile, parseNachaFile, entryHashOf, abaCheckDigitValid, alpha, type NachaEntry, type NachaOriginator } from "../convex/exports/nacha";
import { buildPain001, maskPain001, formatAmount, type Pain001Payment } from "../convex/exports/pain001";

const RUNS = { numRuns: 300 };

// ---------------------------------------------------------------- canPay (I1)

const invoiceStatus = fc.constantFrom("open", "held", "paid") as fc.Arbitrary<"open" | "held" | "paid">;
const accountStatus = fc.constantFrom("unverified", "probing", "verified", "disputed", "superseded", "rejected") as fc.Arbitrary<
  "unverified" | "probing" | "verified" | "disputed" | "superseded" | "rejected"
>;

describe("canPay: the only way to a yes", () => {
  it("ok iff the invoice is payable, the destination belongs to the invoice's vendor, is verified and is the current version", () => {
    fc.assert(
      fc.property(
        fc.option(invoiceStatus, { nil: null }),
        fc.option(fc.record({ status: accountStatus, sameVendor: fc.boolean(), version: fc.integer({ min: 1, max: 5 }) }), { nil: null }),
        fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
        (inv, dest, current) => {
          const d = canPay({
            invoice: inv === null ? null : mkInvoice({ status: inv }),
            destination: dest === null ? null : mkAccount({ status: dest.status, vendorId: dest.sameVendor ? vendorA : vendorB, version: dest.version }),
            currentVersionForIdentity: current,
          });
          const expected =
            inv !== null && (inv === "open" || inv === "held") && dest !== null && dest.sameVendor && dest.status === "verified" && current !== null && dest.version === current;
          expect(d.ok).toBe(expected);
          if (!d.ok) expect(d.reason).toBeTruthy();
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------- canRelease (I3)

type Perturbation =
  | "none" | "no_confirmation" | "other_case" | "other_vendor_conf" | "other_vendor_account" | "other_hash" | "other_account_version"
  | "other_probe" | "probe_pending" | "not_accepted" | "used" | "no_contact" | "contact_not_record" | "contact_superseded"
  | "wrong_amount" | "amount_missing" | "received_early" | "received_after_expiry" | "now_after_expiry";
const perturbation = fc.constantFrom<Perturbation>(
  "none", "no_confirmation", "other_case", "other_vendor_conf", "other_vendor_account", "other_hash", "other_account_version",
  "other_probe", "probe_pending", "not_accepted", "used", "no_contact", "contact_not_record", "contact_superseded",
  "wrong_amount", "amount_missing", "received_early", "received_after_expiry", "now_after_expiry",
);

function scenario(ps: Perturbation[], amount: number, statedDelta: number) {
  const has = (p: Perturbation) => ps.includes(p);
  const probe = mkProbe({ amountCents: amount, ...(has("probe_pending") ? { state: "pending" as const, availableAt: undefined } : {}) });
  const caseDoc = mkCase();
  const account = mkAccount({ ...(has("other_vendor_account") ? { vendorId: vendorB } : {}) });
  const receivedAt = has("received_early") ? T0 + 7200_000 : has("received_after_expiry") ? T0 + 7300_000 + 3 * 3600_000 : T0 + 7300_000;
  // Only defined keys go into the override: an explicit `undefined` would replace the fixture's default.
  const confirmation = has("no_confirmation")
    ? null
    : mkConfirmation({
        ...(has("other_case") ? { caseId: caseB } : {}),
        ...(has("other_vendor_conf") ? { vendorId: vendorB } : {}),
        ...(has("other_hash") ? { accountHash: "hashZ" } : {}),
        ...(has("other_account_version") ? { accountVersion: 2 } : {}),
        ...(has("other_probe") ? { probeId: probeB } : {}),
        accepted: !has("not_accepted"),
        ...(has("used") ? { usedAt: T0 + 7400_000 } : {}),
        statedAmountCents: has("amount_missing") ? undefined : has("wrong_amount") ? amount + statedDelta : amount,
        receivedAt,
      });
  const contact = has("no_contact") ? null : mkContact({ trustLevel: has("contact_not_record") ? "unverified" : "record", ...(has("contact_superseded") ? { supersededAt: T0 } : {}) });
  const now = has("now_after_expiry") ? T0 + 7300_000 + 3 * 3600_000 : T0 + 7400_000;
  return { caseDoc, account, probe, confirmation, contact, now };
}

describe("canRelease: a release needs every binding to hold", () => {
  it("ok only when no perturbation was applied; every single perturbation refuses", () => {
    fc.assert(
      fc.property(fc.uniqueArray(perturbation, { minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1, max: 50 }), (ps, amount, delta) => {
        const real = ps.filter((p) => p !== "none");
        const d = canRelease(scenario(real, amount, delta));
        expect(d.ok).toBe(real.length === 0);
      }),
      RUNS,
    );
  });
  it("no amount oracle: an unaccepted statement or a non-record contact never yields an amount-derived reason, whatever the stated amount", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Perturbation>("not_accepted", "contact_not_record", "no_contact", "contact_superseded", "used"),
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: -99, max: 99 }),
        (p, amount, delta) => {
          const s = scenario(delta === 0 ? [p] : [p, "wrong_amount"], amount, delta);
          const d = canRelease(s);
          expect(d.ok).toBe(false);
          if (!d.ok) expect(d.reason).not.toBe("amount_mismatch");
        },
      ),
      RUNS,
    );
  });
  it("a wrong stated amount is refused for every real amount and every offset", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), fc.integer({ min: -98, max: 98 }).filter((x) => x !== 0), (amount, delta) => {
        const d = canRelease(scenario(["wrong_amount"], amount, delta));
        expect(d).toEqual({ ok: false, reason: "amount_mismatch" });
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------- Nacha round-trip

/** A routing number that passes the ABA 3-7-1 check: 8 random digits plus the computed check digit. */
const routingArb = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 8 }).map((d) => {
  const partial = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5]);
  const check = (10 - (partial % 10)) % 10;
  return d.join("") + String(check);
});
const digits = (min: number, max: number) => fc.stringMatching(new RegExp(`^[0-9]{${min},${max}}$`));
const printable = (max: number) => fc.stringMatching(new RegExp(`^[A-Za-z0-9 .,&'-]{0,${max}}$`));
const entryArb: fc.Arbitrary<NachaEntry> = fc.record({
  routing: routingArb,
  accountNumber: digits(1, 17),
  amountCents: fc.integer({ min: 1, max: 99_999_999 }),
  receiverName: printable(22),
  receiverId: printable(15),
  addenda: fc.option(printable(80), { nil: undefined }),
});
const originator: NachaOriginator = {
  immediateDestination: "021000021",
  immediateOrigin: "1123456789",
  destinationName: "JPMorgan Chase",
  originName: "Landed Inc",
  companyName: "Landed Inc",
  companyId: "1123456789",
  odfiRouting: "044000024",
};

describe("Nacha: build then parse is the identity on every field a bank reconciles", () => {
  it("generated routing numbers pass the ABA check", () => {
    fc.assert(fc.property(routingArb, (r) => { expect(abaCheckDigitValid(r)).toBe(true); }), RUNS);
  });
  it("round-trips entries, totals, hash and geometry for any 1..40 valid entries", () => {
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 40 }), fc.constantFrom("CCD", "PPD") as fc.Arbitrary<"CCD" | "PPD">, (entries, secCode) => {
        const file = buildNachaFile(originator, entries, { secCode, entryDescription: "VENDOR PAY", effectiveDate: new Date(Date.UTC(2026, 9, 27)), createdAt: new Date(Date.UTC(2026, 9, 25, 9, 30)) });
        const lines = file.text.split("\n").filter((l) => l.length > 0);
        expect(lines.every((l) => l.length === 94)).toBe(true);
        expect(lines.length % 10).toBe(0);
        expect(lines.length).toBe(file.blockCount * 10);
        const parsed = parseNachaFile(file.text);
        expect(parsed.batches).toHaveLength(1);
        const b = parsed.batches[0];
        expect(b.entries).toHaveLength(entries.length);
        const addendaCount = entries.filter((e) => e.addenda).length; // an empty addenda string emits no record
        const total = entries.reduce((s, e) => s + e.amountCents, 0);
        expect(b.control.entryAddendaCount).toBe(entries.length + addendaCount);
        expect(parsed.control.entryAddendaCount).toBe(entries.length + addendaCount);
        expect(b.control.totalCreditCents).toBe(total);
        expect(parsed.control.totalCreditCents).toBe(total);
        expect(b.control.totalDebitCents).toBe(0);
        expect(b.control.entryHash).toBe(entryHashOf(entries.map((e) => e.routing)));
        expect(parsed.control.entryHash).toBe(file.entryHash);
        expect(parsed.control.blockCount).toBe(file.blockCount);
        expect(parsed.paddingLines).toBe(file.blockCount * 10 - file.records);
        entries.forEach((e, i) => {
          const p = b.entries[i];
          expect(p.routing).toBe(e.routing);
          expect(p.account).toBe(e.accountNumber);
          expect(p.accountMasked).toBe(false);
          expect(p.amountCents).toBe(e.amountCents);
          expect(p.receiverName).toBe(alpha(e.receiverName, 22).trim());
          expect(p.receiverId).toBe(alpha(e.receiverId, 15).trim());
          expect(p.traceNumber).toBe(file.traceNumbers[i]);
          expect(p.addendaIndicator).toBe(e.addenda ? "1" : "0");
          if (e.addenda) expect(p.addenda?.info).toBe(alpha(e.addenda, 80).trimEnd());
          else expect(p.addenda).toBeUndefined();
        });
        expect(new Set(file.traceNumbers).size).toBe(entries.length);
      }),
      { numRuns: 150 },
    );
  });
  it("rejects every entry whose routing fails the check digit, whose account is not 1..17 digits, or whose amount is not a positive integer", () => {
    const badRouting = routingArb.map((r) => r.slice(0, 8) + String((Number(r[8]) + 1) % 10));
    fc.assert(
      fc.property(
        fc.oneof(
          badRouting.map((routing) => ({ routing })),
          fc.constantFrom("", "123456789012345678", "12a4", "-1").map((accountNumber) => ({ accountNumber })),
          fc.oneof(fc.integer({ max: 0 }), fc.double({ min: 0.01, max: 1e6, noInteger: true, noNaN: true })).map((amountCents) => ({ amountCents })),
        ),
        (bad) => {
          const entry: NachaEntry = { routing: "021000021", accountNumber: "123", amountCents: 100, receiverName: "X", receiverId: "Y", ...bad };
          expect(() => buildNachaFile(originator, [entry], { secCode: "CCD", entryDescription: "VENDOR PAY", effectiveDate: new Date(0) })).toThrow();
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------- pain.001

const nameArb = fc.stringMatching(/^[A-Za-z0-9 <>&"'.,-]{1,60}$/);
const paymentArb: fc.Arbitrary<Pain001Payment> = fc.record({
  endToEndId: fc.stringMatching(/^[A-Z0-9-]{1,35}$/),
  amountCents: fc.integer({ min: 1, max: 9_999_999 }),
  creditor: fc.record({ name: nameArb }),
  creditorAccount: fc.record({ accountNumber: digits(10, 17) }),
  creditorAgent: fc.record({ routing: routingArb }),
  remittance: fc.option(nameArb, { nil: undefined }),
});
const ENTITY = /&(amp|lt|gt|quot|apos|#\d+);/g;

describe("pain.001: control sums, counts, escaping and masking hold for any batch", () => {
  it("NbOfTxs and CtrlSum match the payments, every amount is recoverable, and text content is escaped", () => {
    fc.assert(
      fc.property(fc.array(paymentArb, { minLength: 1, maxLength: 25 }), (payments) => {
        const r = buildPain001({
          msgId: "MSG-1", createdAt: new Date(Date.UTC(2026, 9, 25, 9, 30)), initiatingParty: "Landed Inc",
          debtor: { name: "Acme & Sons <AP>", accountNumber: "000123456789", routing: "044000024" },
          requestedExecutionDate: new Date(Date.UTC(2026, 9, 27)), payments,
        });
        const total = payments.reduce((s, p) => s + p.amountCents, 0);
        expect(r.nbOfTxs).toBe(payments.length);
        expect(r.ctrlSum).toBe(formatAmount(total));
        expect((r.xml.match(/<CdtTrfTxInf>/g) ?? []).length).toBe(payments.length);
        const amounts = [...r.xml.matchAll(/<InstdAmt Ccy="USD">([0-9]+\.[0-9]{2})<\/InstdAmt>/g)].map((m) => Math.round(Number(m[1]) * 100));
        expect(amounts).toEqual(payments.map((p) => p.amountCents));
        // Escaping: with tags removed, no "<" or ">" survives and every "&" starts an entity.
        const text = r.xml.replace(/<[^>]+>/g, "");
        expect(text).not.toMatch(/[<>]/);
        expect(text.replace(ENTITY, "")).not.toMatch(/&/);
        // Every creditor name survives escaping (and the XSD truncation at 140) exactly once per payment.
        for (const p of payments) {
          const esc = p.creditor.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
          expect(r.xml).toContain(`<Nm>${esc}</Nm>`);
        }
      }),
      { numRuns: 150 },
    );
  });
  it("masking removes every full account number and keeps the last four", () => {
    fc.assert(
      fc.property(fc.array(paymentArb, { minLength: 1, maxLength: 10 }), (payments) => {
        const r = buildPain001({
          msgId: "MSG-1", createdAt: new Date(0), initiatingParty: "Landed Inc",
          debtor: { name: "Acme", accountNumber: "98765432109876", routing: "044000024" },
          requestedExecutionDate: new Date(0), payments,
        });
        const masked = maskPain001(r.xml);
        expect(masked).not.toContain("98765432109876");
        for (const p of payments) {
          const acct = p.creditorAccount.accountNumber!;
          expect(masked).not.toContain(`<Id>${acct}</Id>`);
          expect(masked).toContain(`<Id>****${acct.slice(-4)}</Id>`);
        }
        expect(masked.match(/<CdtTrfTxInf>/g)?.length).toBe(payments.length);
      }),
      { numRuns: 100 },
    );
  });
});
