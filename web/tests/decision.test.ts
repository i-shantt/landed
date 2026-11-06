import { describe, it, expect } from "vitest";
import { decisionHelper, ESCALATION_IDS, type DecisionInput, type RiskTier, type ScreeningStatus, type TrustBand } from "../lib/decision";
import { HUMAN_REASONS } from "../lib/enums";

const base: DecisionInput = {
  reason: "contact_and_bank_changed_together",
  risk: { score: 35, tier: "elevated", signals: [{ title: "Phone changed with the bank" }] },
  screening: "clear",
  trustBand: "building",
  confirmations: { accepted: 0, rejected: 0 },
  otherVendors: null,
  amountAtStakeCents: 4200000,
};
const fits = (d: ReturnType<typeof decisionHelper>) => Object.fromEntries(d.options.map((o) => [o.action, o.fit]));

describe("decision helper for NEEDS_HUMAN", () => {
  it("nothing arrived at the vendor of record: mark fraud first, release discouraged", () => {
    const d = decisionHelper({ ...base, reason: "vendor_reports_nothing_arrived", confirmations: { accepted: 1, rejected: 1 } });
    expect(d.options[0].action).toBe("mark_fraud");
    expect(fits(d)).toEqual({ mark_fraud: "recommended", reject_change: "possible", exceptional_release: "discouraged" });
    expect(d.headline).toMatch(/never saw the probe/);
    expect(d.facts.find((f) => f.label === "Vendor statements")?.value).toBe("1 from the contact of record, 1 ignored");
  });
  it("a confirmed sanctions match overrides a benign stall", () => {
    const d = decisionHelper({ ...base, reason: "sla_expired", risk: { score: 5, tier: "low", signals: [] }, screening: "confirmed_match", trustBand: "trusted" });
    expect(d.options[0].action).toBe("mark_fraud");
    expect(fits(d).exceptional_release).toBe("discouraged");
    expect(d.headline).toMatch(/sanctions/);
  });
  it("a quiet SLA expiry at low risk: reject and re-request; release possible only for an established beneficiary", () => {
    const quiet = { ...base, reason: "sla_expired", risk: { score: 5, tier: "low" as const, signals: [] } };
    const newVendor = decisionHelper({ ...quiet, trustBand: "new" });
    expect(newVendor.options[0].action).toBe("reject_change");
    expect(fits(newVendor)).toEqual({ reject_change: "recommended", exceptional_release: "discouraged", mark_fraud: "discouraged" });
    const old = decisionHelper({ ...quiet, trustBand: "trusted" });
    expect(fits(old).exceptional_release).toBe("possible");
    expect(old.nextStep).toMatch(/resubmit/);
  });
  it("bank and phone changed together at elevated risk: reject recommended, fraud discouraged until the old number is called", () => {
    const d = decisionHelper(base);
    expect(fits(d)).toEqual({ reject_change: "recommended", mark_fraud: "discouraged", exceptional_release: "discouraged" });
    expect(d.headline).toMatch(/no trusted way to reach the vendor/);
    expect(d.nextStep).toMatch(/predates this request/);
  });
  it("an operator's free-text reason is quoted, and a critical risk tier makes it hostile", () => {
    const calm = decisionHelper({ ...base, reason: "the clerk wants a second look", risk: { score: 20, tier: "low", signals: [] } });
    expect(calm.facts[0].value).toBe("Operator request: “the clerk wants a second look”");
    expect(calm.options[0].action).toBe("reject_change");
    const hot = decisionHelper({ ...base, reason: "the clerk wants a second look", risk: { score: 92, tier: "critical", signals: [{ title: "Lookalike sender" }] } });
    expect(hot.options[0].action).toBe("mark_fraud");
    expect(hot.facts.find((f) => f.label === "Risk")?.value).toBe("92/100 critical · Lookalike sender");
  });
  it("account reuse reports the other vendors and tolerates missing risk, trust and screening", () => {
    const d = decisionHelper({ reason: "account_reused_across_vendors", risk: null, screening: "unknown", trustBand: null, confirmations: { accepted: 0, rejected: 0 }, otherVendors: 2, amountAtStakeCents: 0 });
    expect(d.options[0].action).toBe("mark_fraud");
    expect(d.facts.find((f) => f.label === "Same account elsewhere")?.value).toBe("2 other vendors");
    expect(d.facts.find((f) => f.label === "Risk")?.value).toBe("not computed yet");
    expect(d.facts.find((f) => f.label === "Held back")?.value).toBe("no open invoice remits here");
  });
  it("every reason × tier × screening × trust yields three distinct options with exactly one recommended; a confirmed match never recommends release", () => {
    const reasons = [...HUMAN_REASONS, "free text", null];
    const tiers: RiskTier[] = ["low", "elevated", "high", "critical"];
    const screens: ScreeningStatus[] = ["unknown", "clear", "potential_match", "confirmed_match", "false_positive"];
    const bands: (TrustBand | null)[] = [null, "new", "building", "established", "trusted"];
    let n = 0;
    for (const reason of reasons)
      for (const tier of tiers)
        for (const screening of screens)
          for (const trustBand of bands) {
            const d = decisionHelper({ ...base, reason, risk: { score: 50, tier, signals: [] }, screening, trustBand });
            n++;
            expect(new Set(d.options.map((o) => o.action)).size).toBe(3);
            expect(d.options.filter((o) => o.fit === "recommended")).toHaveLength(1);
            expect(d.options[0].fit).toBe("recommended");
            expect(d.headline.length).toBeGreaterThan(20);
            if (screening === "confirmed_match") expect(d.options.find((o) => o.action === "exceptional_release")?.fit).toBe("discouraged");
            if (tier === "critical") expect(d.options[0].action).toBe("mark_fraud");
            for (const o of d.options) expect(o.why.length).toBeGreaterThan(20);
          }
    expect(n).toBe(reasons.length * tiers.length * screens.length * bands.length);
    for (const r of HUMAN_REASONS) expect(ESCALATION_IDS.has(r)).toBe(true);
  });
});
