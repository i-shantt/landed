// Transaction monitoring signals for a candidate payment, evaluated against the vendor's own history.
// Pure: no ctx, no I/O. Thresholds adapt to the vendor (median, MAD, weekly cadence) and are computed on
// read, never cached. The result informs people and, through policy.monitoringReviewAbove, can require
// an approval; it has no write path and cannot release money (tests/modelCannotRelease.test.ts).
import { localHourAndDay } from "../risk/score";
import type { HistoryRow } from "../risk/model/features";

export type MonitoringSignalId =
  | "velocity_24h"
  | "velocity_7d"
  | "amount_zscore"
  | "amount_ratio_median"
  | "structuring_under_threshold"
  | "dormant_vendor_spike"
  | "first_payment_recently_verified"
  | "round_amount"
  | "off_hours_initiation";

export type MonitoringSignal = { id: MonitoringSignalId; weight: number; title: string; evidence: string };

export type MonitoringCandidate = {
  amountCents: number;
  at: number; // ms, application clock
  vendorId: string;
  destinationAccountId: string;
  rail: "ach" | "wire";
  /** No payment (live or seeded history) has gone to this destination before `at`. */
  isFirstPaymentToAccount: boolean;
  /** When the destination was verified (bound confirmation or exceptional release), if known. */
  verifiedAt: number | null;
  timezone: string;
  /** policy.dualApprovalAboveCents; structuring is skipped when the company has no threshold. */
  thresholdCents: number | null;
};

export type MonitoringResult = {
  signals: MonitoringSignal[];
  checked: MonitoringSignalId[];
  flagScore: number; // 0..100
  flagged: boolean;  // flagScore >= FLAG_AT
};

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const FLAG_AT = 40;
export const STRUCTURING_WINDOW = 72 * HOUR;
export const STRUCTURING_BAND = 0.9;
export const DORMANT_AFTER = 180 * DAY;
export const RECENTLY_VERIFIED = 7 * DAY;
export const MIN_BASELINE = 3;

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const m = Math.floor(n / 2);
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Robust z-score: (x - median) / (1.4826 * MAD). NaN when there is no spread. */
export function robustZ(x: number, prior: number[]): number {
  const med = median(prior);
  const mad = median(prior.map((v) => Math.abs(v - med)));
  if (!(mad > 0)) return NaN;
  return (x - med) / (1.4826 * mad);
}

/** Weekly payment counts over the vendor's history (7-day buckets ending at `until`), for the cadence baseline. */
export function weeklyCounts(rows: { at: number }[], until: number): number[] {
  if (rows.length === 0) return [];
  const first = Math.min(...rows.map((r) => r.at));
  const weeks = Math.max(1, Math.ceil((until - first) / (7 * DAY)));
  const counts = new Array<number>(weeks).fill(0);
  for (const r of rows) {
    const idx = Math.min(weeks - 1, Math.floor((until - r.at) / (7 * DAY)));
    counts[idx]++;
  }
  return counts;
}

/**
 * Clusters of payments that each sit just under the threshold ([band*T, T)) within `window` of each other
 * and together exceed T. Returns clusters as arrays of rows (each row appears in at most one cluster).
 */
export function structuringClusters<R extends { at: number; amountCents: number }>(rows: R[], thresholdCents: number, window = STRUCTURING_WINDOW, band = STRUCTURING_BAND): R[][] {
  const under = rows.filter((r) => r.amountCents >= band * thresholdCents && r.amountCents < thresholdCents).sort((a, b) => a.at - b.at);
  const clusters: R[][] = [];
  let i = 0;
  while (i < under.length) {
    let j = i;
    while (j + 1 < under.length && under[j + 1].at - under[i].at <= window) j++;
    const group = under.slice(i, j + 1);
    const sum = group.reduce((s, r) => s + r.amountCents, 0);
    if (group.length >= 2 && sum >= thresholdCents) {
      clusters.push(group);
      i = j + 1;
    } else i++;
  }
  return clusters;
}

export function evaluateCandidate(c: MonitoringCandidate, vendorHistory: HistoryRow[]): MonitoringResult {
  const prior = vendorHistory.filter((r) => r.at < c.at).sort((a, b) => a.at - b.at);
  const amounts = prior.map((r) => r.amountCents);
  const signals: MonitoringSignal[] = [];
  const checked: MonitoringSignalId[] = [];
  const check = (id: MonitoringSignalId) => checked.push(id);
  const fire = (s: MonitoringSignal) => signals.push(s);

  check("velocity_24h");
  const n24 = prior.filter((r) => r.at >= c.at - DAY).length;
  if (n24 >= 3) fire({ id: "velocity_24h", weight: 20, title: "Many payments to this vendor in 24 hours", evidence: `${n24} payment(s) in the previous 24 h before this one` });

  check("velocity_7d");
  const n7 = prior.filter((r) => r.at >= c.at - 7 * DAY).length;
  const weeks = weeklyCounts(prior.filter((r) => r.at < c.at - 7 * DAY), c.at - 7 * DAY);
  const weeklyMedian = weeks.length ? median(weeks) : 0;
  if (n7 >= 3 && n7 >= 2 * Math.max(weeklyMedian, 1)) fire({ id: "velocity_7d", weight: 15, title: "Weekly cadence doubled", evidence: `${n7} payments in 7 days vs a typical week of ${weeklyMedian}` });

  check("amount_zscore");
  if (amounts.length >= MIN_BASELINE) {
    const z = robustZ(c.amountCents, amounts);
    if (Number.isFinite(z) && z >= 3) fire({ id: "amount_zscore", weight: 25, title: "Amount far outside this vendor's range", evidence: `robust z = ${z.toFixed(1)} against ${amounts.length} prior payments (median ${usd(median(amounts))})` });
  }

  check("amount_ratio_median");
  if (amounts.length >= MIN_BASELINE) {
    const med = median(amounts);
    const ratio = med > 0 ? c.amountCents / med : 0;
    if (ratio >= 2.5) fire({ id: "amount_ratio_median", weight: 15, title: "Amount is a multiple of the usual invoice", evidence: `${ratio.toFixed(1)}× the vendor's median of ${usd(med)}` });
  }

  check("structuring_under_threshold");
  if (c.thresholdCents !== null && c.thresholdCents > 0) {
    const me = { at: c.at, amountCents: c.amountCents, vendorId: c.vendorId, destinationAccountId: c.destinationAccountId, source: "payment" as const };
    const window = prior.filter((r) => r.at >= c.at - STRUCTURING_WINDOW);
    const cluster = structuringClusters([...window, me], c.thresholdCents).find((g) => g.includes(me));
    if (cluster) fire({ id: "structuring_under_threshold", weight: 30, title: "Split just under the approval threshold", evidence: `${cluster.length} payments within 72 h, each under ${usd(c.thresholdCents)}, totalling ${usd(cluster.reduce((s, r) => s + r.amountCents, 0))}` });
  }

  check("dormant_vendor_spike");
  if (prior.length >= 1) {
    const last = prior[prior.length - 1];
    const max = Math.max(...amounts);
    if (c.at - last.at >= DORMANT_AFTER && c.amountCents > 2 * max) fire({ id: "dormant_vendor_spike", weight: 25, title: "Dormant vendor, unusually large payment", evidence: `no payment for ${Math.floor((c.at - last.at) / DAY)} days, then ${usd(c.amountCents)} vs a prior maximum of ${usd(max)}` });
  }

  check("first_payment_recently_verified");
  if (c.isFirstPaymentToAccount && c.verifiedAt !== null && c.at - c.verifiedAt < RECENTLY_VERIFIED) {
    fire({ id: "first_payment_recently_verified", weight: 20, title: "First payment to an account verified this week", evidence: `verified ${Math.max(0, Math.floor((c.at - c.verifiedAt) / HOUR))} h before this payment` });
  }

  check("round_amount");
  if (c.amountCents >= 100_000 && c.amountCents % 100_000 === 0) fire({ id: "round_amount", weight: 5, title: "Round amount", evidence: `${usd(c.amountCents)} is a whole multiple of $1,000` });

  check("off_hours_initiation");
  const { hour, weekday } = localHourAndDay(c.at, c.timezone);
  if (weekday === 0 || weekday === 6 || hour < 6 || hour >= 20) fire({ id: "off_hours_initiation", weight: 10, title: "Initiated outside business hours", evidence: `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday]} ${String(hour).padStart(2, "0")}:00 ${c.timezone}` });

  const flagScore = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  return { signals, checked, flagScore, flagged: flagScore >= FLAG_AT };
}
