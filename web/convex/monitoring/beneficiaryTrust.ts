// Beneficiary (vendor) trust score, 0..100, computed on read from facts the platform already stores.
// Pure. Each component carries its evidence so the number can be audited.

export type TrustBand = "new" | "building" | "established" | "trusted";
export type TrustComponent = { id: string; points: number; evidence: string };
export type TrustResult = { score: number; band: TrustBand; components: TrustComponent[] };

export type TrustInput = {
  now: number;
  vendorOnboardedAt: number;
  landedPayments: number;        // payments with landingState "landed" + seeded paid history
  unconfirmedPayments: number;   // landingState "unconfirmed"
  lastBankChangeAt: number | null; // most recent case openedAt (bank-change request), null when none
  screening: "none" | "clear" | "potential" | "confirmed";
  modelProbability: number | null; // learned-model probability of the vendor's latest/next payment, when known
  openCases: number;
};

const DAY = 86_400_000;

export function bandFor(score: number): TrustBand {
  if (score >= 80) return "trusted";
  if (score >= 55) return "established";
  if (score >= 30) return "building";
  return "new";
}

export function trustScore(i: TrustInput): TrustResult {
  const components: TrustComponent[] = [];
  const add = (id: string, points: number, evidence: string) => components.push({ id, points: Math.round(points * 10) / 10, evidence });

  const tenureDays = Math.max(0, Math.floor((i.now - i.vendorOnboardedAt) / DAY));
  add("tenure", 25 * Math.min(1, Math.log1p(tenureDays) / Math.log1p(730)), `${tenureDays} days since onboarding (full credit at 2 years)`);

  add("landed_payments", 25 * Math.min(1, Math.log1p(i.landedPayments) / Math.log1p(24)), `${i.landedPayments} payment(s) landed (full credit at 24)`);

  if (i.lastBankChangeAt === null) add("bank_change_recency", 15, "no bank-account change on record");
  else {
    const days = Math.max(0, (i.now - i.lastBankChangeAt) / DAY);
    add("bank_change_recency", 15 * Math.min(1, days / 180), `last bank-account change ${Math.floor(days)} days ago (full credit after 180)`);
  }

  if (i.screening === "clear") add("screening", 10, "sanctions screening clear");
  else if (i.screening === "potential") add("screening", -30, "unresolved potential sanctions match");
  else if (i.screening === "none") add("screening", 0, "not yet screened");

  if (i.modelProbability === null) add("model", 7.5, "no learned-model assessment yet");
  else add("model", (1 - i.modelProbability) * 15, `learned model probability ${(100 * i.modelProbability).toFixed(0)}% on the latest payment`);

  if (i.openCases > 0) add("open_cases", -15 * i.openCases, `${i.openCases} open verification case(s)`);
  if (i.unconfirmedPayments > 0) add("unconfirmed_payments", -10 * i.unconfirmedPayments, `${i.unconfirmedPayments} payment(s) never confirmed as landed`);

  let score = components.reduce((s, c) => s + c.points, 0);
  if (i.screening === "confirmed") {
    add("screening", -100, "confirmed sanctions match: trust is zero");
    score = 0;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, band: bandFor(score), components };
}
