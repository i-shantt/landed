import { describe, it, expect } from "vitest";
import { scoreRisk, isValidAbaRouting, tierFor, type RiskInput } from "../convex/risk/score";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, manualEdit, VENDOR_B_ACCOUNT } from "./harness";

const T = 1_800_000_000_000;

function base(over: Partial<RiskInput> = {}): RiskInput {
  return {
    triggerType: "instruction_change",
    message: {
      from: "ap@cleanco.example",
      subject: "Updated banking details",
      body: "We have changed banks. Routing 011000015, account 900012345678.",
      sentAt: T + 18 * 3600_000, // 10:00 PT on a weekday if T is a Tuesday 00:00 UTC; computed below
      authResult: { spf: true, dkim: true, dmarc: true },
    },
    senderMismatchReason: null,
    contactAlsoChanged: false,
    amountAtStakeCents: 100_000,
    vendorOnboardedAt: T - 400 * 86_400_000,
    priorCasesLast90Days: 0,
    newRouting: "011000015",
    oldRouting: "021000021",
    receiptClaimByEmail: false,
    validationProviderResult: "no_coverage",
    accountUsedByOtherVendors: 0,
    caseOpenedAt: T,
    timezone: "UTC",
    ...over,
  };
}

describe("ABA routing checksum", () => {
  it("accepts valid routing numbers", () => {
    for (const r of ["011000015", "021000021", "031000503", "210905610", "122105155"]) expect(isValidAbaRouting(r)).toBe(true);
  });
  it("rejects a transposed digit, wrong length, and an out-of-range prefix", () => {
    expect(isValidAbaRouting("011000051")).toBe(false);
    expect(isValidAbaRouting("12345678")).toBe(false);
    expect(isValidAbaRouting("991000015")).toBe(false);
  });
});

describe("risk scoring (pure)", () => {
  it("a clean, authenticated change from a long-standing vendor is low risk", () => {
    const a = scoreRisk(base({ message: { ...base().message!, sentAt: Date.UTC(2026, 9, 20, 15, 0) } }));
    expect(a.tier).toBe("low");
    expect(a.signals.map((s) => s.id)).toEqual(["routing_bank_changed"]);
    expect(a.checked.length).toBeGreaterThan(10);
  });
  it("lookalike sender + DMARC failure + urgency + new callback number is critical", () => {
    const a = scoreRisk(
      base({
        senderMismatchReason: "lookalike_domain",
        contactAlsoChanged: true,
        message: { ...base().message!, from: "ap@c1eanco.example", subject: "URGENT: updated banking details", body: "Please update immediately. Do not call the old number, use 555-0199.", authResult: { spf: true, dkim: false, dmarc: false }, sentAt: Date.UTC(2026, 9, 20, 15, 0) },
      })
    );
    expect(a.tier).toBe("critical");
    const ids = a.signals.map((s) => s.id);
    expect(ids).toContain("sender_domain_lookalike");
    expect(ids).toContain("email_auth_failed");
    expect(ids).toContain("contact_also_changed");
    expect(ids).toContain("urgency_language");
    expect(ids).toContain("secrecy_language");
    expect(a.signals[0].weight).toBeGreaterThanOrEqual(a.signals[a.signals.length - 1].weight);
    expect(a.score).toBeLessThanOrEqual(100);
  });
  it("a mule account shared across vendors and a bad checksum dominate", () => {
    const a = scoreRisk(base({ accountUsedByOtherVendors: 2, newRouting: "011000051" }));
    expect(a.signals[0].id).toBe("account_reused_across_vendors");
    expect(a.signals.map((s) => s.id)).toContain("routing_checksum_invalid");
    expect(a.tier).toBe("critical");
  });
  it("off-hours and reply-to mismatch are detected", () => {
    const a = scoreRisk(base({ message: { ...base().message!, sentAt: Date.UTC(2026, 9, 18, 3, 0), replyTo: "billing@mail-cleanco.example" } }));
    const ids = a.signals.map((s) => s.id);
    expect(ids).toContain("off_hours_request");
    expect(ids).toContain("reply_to_mismatch");
  });
  it("amount, tenure and repeat changes add up; tiers are monotone", () => {
    const a = scoreRisk(base({ amountAtStakeCents: 12_000_000, vendorOnboardedAt: T - 10 * 86_400_000, priorCasesLast90Days: 1 }));
    expect(a.signals.map((s) => s.id)).toEqual(expect.arrayContaining(["large_amount_at_stake", "vendor_tenure_short", "recent_prior_change"]));
    expect(tierFor(0)).toBe("low");
    expect(tierFor(20)).toBe("elevated");
    expect(tierFor(45)).toBe("high");
    expect(tierFor(70)).toBe("critical");
  });
  it("never includes an amount other than the invoice total in evidence (no probe amounts)", () => {
    const a = scoreRisk(base());
    for (const s of a.signals) expect(s.evidence).not.toMatch(/\$0\.\d\d/);
  });
});

describe("risk assessment (engine)", () => {
  it("a manual edit is scored from stored facts and a reused account across vendors is flagged", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const northpeak = ids.vendors.northpeak as Id<"vendors">;
    const r1 = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    const a1 = (await t.query(api.risk.assess.forCase, { caseId: r1.caseId }))!;
    expect(a1.signals.map((s) => s.id)).toContain("manual_edit_no_document");
    expect(a1.signals.map((s) => s.id)).not.toContain("account_reused_across_vendors");

    const r2 = await manualEdit(t, northpeak, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.northpeak_main as Id<"bankAccounts">);
    const a2 = (await t.query(api.risk.assess.forCase, { caseId: r2.caseId }))!;
    expect(a2.signals.map((s) => s.id)).toContain("account_reused_across_vendors");
    expect(a2.score).toBeGreaterThan(a1.score);
    // and the first case now sees the reuse too (derived on read)
    const a1b = (await t.query(api.risk.assess.forCase, { caseId: r1.caseId }))!;
    expect(a1b.signals.map((s) => s.id)).toContain("account_reused_across_vendors");

    const all = await t.query(api.risk.assess.forAll, {});
    expect(all[r2.caseId].tier).toBe(a2.tier);
  });
});
