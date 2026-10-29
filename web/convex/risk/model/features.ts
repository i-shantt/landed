// Landed -> model feature vector. Mirrors ml/features.py `candidate_features` (the contract) and
// tests/modelParity.test.ts checks the vector on 50 fixtures. Pure.
//
// Mapping of the training-data roles onto accounts payable:
//   payer        = the company (payer-side baselines come from company-wide history)
//   beneficiary  = the vendor (counts, amount baselines, age = vendor tenure)
//   "new beneficiary" = first payment to THIS destination account (what a bank-change attack creates)
//   type         = wire -> transfer, ach -> payment
//   threshold    = policy.dualApprovalAboveCents (the amount an attacker structures under), default $10,000
import { localHourAndDay } from "../score";

export const FEATURE_NAMES = [
  "amount_log", "hour_sin", "hour_cos", "is_off_hours", "is_weekend", "is_weekend_missing",
  "type_transfer", "type_payment", "type_cash_out", "is_new_beneficiary",
  "bene_count_24h", "bene_count_7d", "payer_count_24h",
  "bene_amount_ratio_median", "bene_amount_ratio_missing", "payer_amount_ratio_median", "payer_amount_ratio_missing",
  "bene_age_days", "is_round_amount", "just_under_threshold",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export const DAY_S = 86_400;
export const MIN_HISTORY_FOR_MEDIAN = 3;
export const UNDER_THRESHOLD_BAND = 0.9;
export const DEFAULT_THRESHOLD_CENTS = 1_000_000;

/** One prior payment, in the units the model was trained on (seconds, major currency units). */
export type HistoryPoint = { at: number; amount: number };

export type CandidateInput = {
  amount: number;              // major units
  at: number;                  // seconds
  hour: number;                // 0..23 local
  weekday: number | null;      // 0 = Sunday .. 6, null when unknown
  type: "transfer" | "payment" | "cash_out";
  beneHistory: HistoryPoint[]; // earlier payments to this beneficiary (strictly before `at` is enforced here)
  payerHistory: HistoryPoint[];
  pairSeenBefore: boolean;
  beneFirstSeenAt: number | null;
  threshold: number;           // major units
};

export function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function ratio(amount: number, prior: number[]): [number, number] {
  if (prior.length < MIN_HISTORY_FOR_MEDIAN) return [1, 1];
  const m = median(prior);
  if (!(m > 0)) return [1, 1];
  return [amount / m, 0];
}

export function candidateFeatures(c: CandidateInput): Record<FeatureName, number> {
  const bene = c.beneHistory.filter((h) => h.at < c.at);
  const payer = c.payerHistory.filter((h) => h.at < c.at);
  const [bRatio, bMissing] = ratio(c.amount, bene.map((h) => h.amount));
  const [pRatio, pMissing] = ratio(c.amount, payer.map((h) => h.amount));
  const first = c.beneFirstSeenAt ?? c.at;
  return {
    amount_log: Math.log1p(Math.max(c.amount, 0)),
    hour_sin: Math.sin((2 * Math.PI * c.hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * c.hour) / 24),
    is_off_hours: c.hour < 6 || c.hour >= 20 ? 1 : 0,
    is_weekend: c.weekday === null ? 0 : c.weekday === 0 || c.weekday === 6 ? 1 : 0,
    is_weekend_missing: c.weekday === null ? 1 : 0,
    type_transfer: c.type === "transfer" ? 1 : 0,
    type_payment: c.type === "payment" ? 1 : 0,
    type_cash_out: c.type === "cash_out" ? 1 : 0,
    is_new_beneficiary: c.pairSeenBefore ? 0 : 1,
    bene_count_24h: bene.filter((h) => h.at >= c.at - DAY_S).length,
    bene_count_7d: bene.filter((h) => h.at >= c.at - 7 * DAY_S).length,
    payer_count_24h: payer.filter((h) => h.at >= c.at - DAY_S).length,
    bene_amount_ratio_median: bRatio,
    bene_amount_ratio_missing: bMissing,
    payer_amount_ratio_median: pRatio,
    payer_amount_ratio_missing: pMissing,
    bene_age_days: Math.max(0, (c.at - Math.min(first, c.at)) / DAY_S),
    is_round_amount: c.amount > 0 && c.amount % 100 === 0 ? 1 : 0,
    just_under_threshold: UNDER_THRESHOLD_BAND * c.threshold <= c.amount && c.amount < c.threshold ? 1 : 0,
  };
}

export function vector(f: Record<FeatureName, number>): number[] {
  return FEATURE_NAMES.map((n) => f[n]);
}

// ------------------------------------------------------------------ Landed-side adapter

/** A prior payment as Landed stores it: live `payments` rows, or paid invoices without a payment row (seeded history). */
export type HistoryRow = {
  vendorId: string;
  destinationAccountId: string;
  amountCents: number;
  at: number; // ms
  source: "payment" | "invoice_history";
};

export type PaymentFeatureInput = {
  amountCents: number;
  at: number; // ms, application clock
  rail: "ach" | "wire";
  vendorId: string;
  destinationAccountId: string;
  destinationFirstPaidAt: number | undefined;
  vendorOnboardedAt: number;
  vendorHistory: HistoryRow[];   // this vendor's prior payments (any account)
  companyHistory: HistoryRow[];  // every prior payment by the company
  timezone: string;
  thresholdCents: number | null;
};

const toPoint = (r: HistoryRow): HistoryPoint => ({ at: Math.floor(r.at / 1000), amount: r.amountCents / 100 });

export function buildPaymentFeatures(p: PaymentFeatureInput): { input: CandidateInput; features: Record<FeatureName, number>; vector: number[] } {
  const atS = Math.floor(p.at / 1000);
  const { hour, weekday } = localHourAndDay(p.at, p.timezone);
  const toThisAccount = p.vendorHistory.filter((r) => r.destinationAccountId === p.destinationAccountId && r.at < p.at);
  const input: CandidateInput = {
    amount: p.amountCents / 100,
    at: atS,
    hour,
    weekday,
    type: p.rail === "wire" ? "transfer" : "payment",
    beneHistory: p.vendorHistory.map(toPoint),
    payerHistory: p.companyHistory.map(toPoint),
    pairSeenBefore: p.destinationFirstPaidAt !== undefined || toThisAccount.length > 0,
    beneFirstSeenAt: Math.floor(Math.min(p.vendorOnboardedAt, p.at) / 1000),
    threshold: (p.thresholdCents ?? DEFAULT_THRESHOLD_CENTS) / 100,
  };
  const features = candidateFeatures(input);
  return { input, features, vector: vector(features) };
}
