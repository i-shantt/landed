import { describe, it, expect } from "vitest";
import { evaluateCandidate, structuringClusters, robustZ, weeklyCounts, DAY, HOUR, type MonitoringCandidate } from "../convex/monitoring/signals";
import { trustScore, bandFor } from "../convex/monitoring/beneficiaryTrust";
import { buildTrend, localDate } from "../convex/monitoring/trend";
import type { HistoryRow } from "../convex/risk/model/features";

const T0 = Date.UTC(2026, 9, 14, 18, 0, 0); // Wed 2026-10-14 18:00Z = 11:00 PT
const row = (daysAgo: number, amountCents: number, dest = "A"): HistoryRow => ({ vendorId: "V", destinationAccountId: dest, amountCents, at: T0 - daysAgo * DAY, source: "payment" });
const cand = (over: Partial<MonitoringCandidate> = {}): MonitoringCandidate => ({ amountCents: 2_000_100, at: T0, vendorId: "V", destinationAccountId: "A", rail: "ach", isFirstPaymentToAccount: false, verifiedAt: null, timezone: "America/Los_Angeles", thresholdCents: 2_500_000, ...over });
const steady = [row(90, 2_000_000), row(60, 2_100_000), row(30, 1_950_000), row(10, 2_050_000)];
const ids = (r: ReturnType<typeof evaluateCandidate>) => r.signals.map((s) => s.id);

describe("monitoring signals", () => {
  it("a routine payment on a steady cadence fires nothing", () => {
    const r = evaluateCandidate(cand(), steady);
    expect(ids(r)).toEqual([]);
    expect(r.flagged).toBe(false);
    expect(r.checked.length).toBe(9);
  });
  it("velocity_24h fires at the third prior payment in 24 h, not the second", () => {
    const two = [row(0.5, 100_000), row(0.2, 100_000)];
    expect(ids(evaluateCandidate(cand({ amountCents: 100_000 }), two))).not.toContain("velocity_24h");
    expect(ids(evaluateCandidate(cand({ amountCents: 100_000 }), [...two, row(0.9, 100_000)]))).toContain("velocity_24h");
  });
  it("velocity_7d fires when the week doubles the vendor's typical week", () => {
    const monthly = [row(100, 1_000_000), row(70, 1_000_000), row(40, 1_000_000)]; // ~1 per 4 weeks -> median week 0
    const burst = [row(6, 1_000_000), row(4, 1_000_000), row(2, 1_000_000)];
    expect(ids(evaluateCandidate(cand({ amountCents: 1_000_000 }), [...monthly, ...burst]))).toContain("velocity_7d");
    expect(ids(evaluateCandidate(cand({ amountCents: 1_000_000 }), [...monthly, row(5, 1_000_000)]))).not.toContain("velocity_7d");
  });
  it("amount_zscore and amount_ratio_median need three prior payments and fire at the boundary", () => {
    expect(ids(evaluateCandidate(cand({ amountCents: 20_000_100 }), steady.slice(0, 2)))).toEqual([]);
    const r = evaluateCandidate(cand({ amountCents: 20_000_100 }), steady);
    expect(ids(r)).toContain("amount_zscore");
    expect(ids(r)).toContain("amount_ratio_median");
    const med = 2_025_000;
    expect(ids(evaluateCandidate(cand({ amountCents: Math.ceil(2.5 * med) }), steady))).toContain("amount_ratio_median");
    expect(ids(evaluateCandidate(cand({ amountCents: Math.floor(2.49 * med) }), steady))).not.toContain("amount_ratio_median");
    expect(robustZ(10, [1, 1, 1])).toBeNaN(); // no spread
    expect(robustZ(5, [1, 2, 3])).toBeCloseTo((5 - 2) / (1.4826 * 1), 6);
  });
  it("structuringClusters finds 3 × $24,500 within 72 h at T = $25,000 and ignores a fourth outside the window", () => {
    const T = 2_500_000;
    const rows = [
      { at: T0 - 70 * HOUR, amountCents: 2_450_000 }, { at: T0 - 40 * HOUR, amountCents: 2_450_000 }, { at: T0, amountCents: 2_450_000 },
      { at: T0 - 200 * HOUR, amountCents: 2_450_000 }, // outside
      { at: T0 - 50 * HOUR, amountCents: 2_000_000 }, // not in the band
    ];
    const clusters = structuringClusters(rows, T);
    expect(clusters.length).toBe(1);
    expect(clusters[0].length).toBe(3);
    expect(clusters[0].every((r) => r.amountCents === 2_450_000 && r.at >= T0 - 70 * HOUR)).toBe(true);
    // two payments summing under T are not a cluster; a single under-threshold payment never is
    expect(structuringClusters([{ at: T0, amountCents: 1_200_000 }, { at: T0 + HOUR, amountCents: 1_200_000 }], T).length).toBe(0);
    expect(structuringClusters([{ at: T0, amountCents: 2_450_000 }], T).length).toBe(0);
  });
  it("structuring_under_threshold fires for the candidate completing a cluster and is skipped without a policy threshold", () => {
    const hist = [{ ...row(2, 2_450_000) }, { ...row(1, 2_450_000) }];
    const r = evaluateCandidate(cand({ amountCents: 2_450_000 }), hist);
    expect(ids(r)).toContain("structuring_under_threshold");
    expect(r.signals.find((s) => s.id === "structuring_under_threshold")!.evidence).toMatch(/3 payments within 72 h/);
    expect(ids(evaluateCandidate(cand({ amountCents: 2_450_000, thresholdCents: null }), hist))).not.toContain("structuring_under_threshold");
    expect(ids(evaluateCandidate(cand({ amountCents: 2_450_000 }), [row(5, 2_450_000)]))).not.toContain("structuring_under_threshold"); // 2nd is outside 72 h
  });
  it("dormant_vendor_spike needs 180 quiet days and more than twice the prior maximum", () => {
    const old = [row(400, 1_000_000), row(300, 1_200_000), row(200, 900_000)];
    expect(ids(evaluateCandidate(cand({ amountCents: 2_400_001 }), old))).toContain("dormant_vendor_spike");
    expect(ids(evaluateCandidate(cand({ amountCents: 2_400_000 }), old))).not.toContain("dormant_vendor_spike");
    expect(ids(evaluateCandidate(cand({ amountCents: 5_000_000 }), [...old, row(100, 1_000_000)]))).not.toContain("dormant_vendor_spike");
  });
  it("first_payment_recently_verified fires under 7 days for a first payment only", () => {
    const v = T0 - 2 * DAY;
    expect(ids(evaluateCandidate(cand({ isFirstPaymentToAccount: true, verifiedAt: v }), []))).toContain("first_payment_recently_verified");
    expect(ids(evaluateCandidate(cand({ isFirstPaymentToAccount: false, verifiedAt: v }), []))).not.toContain("first_payment_recently_verified");
    expect(ids(evaluateCandidate(cand({ isFirstPaymentToAccount: true, verifiedAt: T0 - 8 * DAY }), []))).not.toContain("first_payment_recently_verified");
  });
  it("round_amount and off_hours_initiation", () => {
    expect(ids(evaluateCandidate(cand({ amountCents: 1_000_000 }), []))).toContain("round_amount");
    expect(ids(evaluateCandidate(cand({ amountCents: 1_000_100 }), []))).not.toContain("round_amount");
    expect(ids(evaluateCandidate(cand({ at: Date.UTC(2026, 9, 15, 10, 0, 0) }), []))).toContain("off_hours_initiation"); // 03:00 PT
    expect(ids(evaluateCandidate(cand({ at: Date.UTC(2026, 9, 17, 18, 0, 0) }), []))).toContain("off_hours_initiation"); // Saturday
    expect(ids(evaluateCandidate(cand(), []))).not.toContain("off_hours_initiation");
  });
  it("flag score sums weights, caps at 100 and flags at 40", () => {
    const r = evaluateCandidate(cand({ amountCents: 20_000_000, at: Date.UTC(2026, 9, 17, 18, 0, 0) }), steady); // zscore 25 + ratio 15 + round 5 + off-hours 10
    expect(r.flagScore).toBe(55);
    expect(r.flagged).toBe(true);
    expect(evaluateCandidate(cand({ amountCents: 1_000_000 }), steady).flagged).toBe(false);
  });
  it("weeklyCounts buckets by 7-day windows ending at `until`", () => {
    expect(weeklyCounts([{ at: T0 - 1 * DAY }, { at: T0 - 8 * DAY }, { at: T0 - 9 * DAY }], T0)).toEqual([1, 2]);
    expect(weeklyCounts([], T0)).toEqual([]);
  });
});

describe("beneficiary trust", () => {
  const base = { now: T0, vendorOnboardedAt: T0 - 730 * DAY, landedPayments: 24, unconfirmedPayments: 0, lastBankChangeAt: null, screening: "clear" as const, modelProbability: 0.05, openCases: 0 };
  it("a long-standing, clean vendor is trusted; a brand-new one is new", () => {
    const t = trustScore(base);
    expect(t.score).toBeGreaterThanOrEqual(80);
    expect(t.band).toBe("trusted");
    const n = trustScore({ ...base, vendorOnboardedAt: T0, landedPayments: 0, screening: "none", modelProbability: null });
    expect(n.band).toBe("new");
    expect(n.score).toBeLessThan(30);
  });
  it("is monotone in tenure and in landed payments", () => {
    let prev = -1;
    for (const d of [0, 30, 90, 365, 730, 1500]) {
      const s = trustScore({ ...base, vendorOnboardedAt: T0 - d * DAY }).score;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    prev = -1;
    for (const k of [0, 1, 3, 6, 12, 24, 100]) {
      const s = trustScore({ ...base, landedPayments: k }).score;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
  it("penalties: recent bank change, open case, unconfirmed payment, potential match; confirmed match zeroes the score", () => {
    const full = trustScore(base).score;
    expect(trustScore({ ...base, lastBankChangeAt: T0 - DAY }).score).toBeLessThan(full);
    expect(trustScore({ ...base, openCases: 1 }).score).toBe(Math.max(0, full - 15));
    expect(trustScore({ ...base, unconfirmedPayments: 2 }).score).toBe(Math.max(0, full - 20));
    expect(trustScore({ ...base, screening: "potential" }).score).toBe(Math.max(0, full - 40));
    const z = trustScore({ ...base, screening: "confirmed" });
    expect(z.score).toBe(0);
    expect(z.band).toBe("new");
    expect(z.components.some((c) => c.id === "screening" && c.points === -100)).toBe(true);
  });
  it("bands", () => {
    expect(bandFor(0)).toBe("new"); expect(bandFor(30)).toBe("building"); expect(bandFor(55)).toBe("established"); expect(bandFor(80)).toBe("trusted");
  });
});

describe("risk trend", () => {
  it("bins across the day boundary in the company timezone", () => {
    const tz = "America/Los_Angeles";
    const now = Date.UTC(2026, 9, 15, 5, 30, 0); // 2026-10-14 22:30 PT
    expect(localDate(now, tz)).toBe("2026-10-14");
    const rows = [
      { at: Date.UTC(2026, 9, 15, 6, 59, 0), flagged: true, flagScore: 60, amountCents: 100 },  // 23:59 PT Oct 14
      { at: Date.UTC(2026, 9, 15, 7, 1, 0), flagged: false, flagScore: 10, amountCents: 200 },  // 00:01 PT Oct 15 (tomorrow: outside the window)
      { at: Date.UTC(2026, 9, 14, 7, 1, 0), flagged: false, flagScore: 20, amountCents: 300 },  // 00:01 PT Oct 14
      { at: Date.UTC(2026, 9, 14, 6, 59, 0), flagged: true, flagScore: 80, amountCents: 400 },  // 23:59 PT Oct 13
    ];
    const t = buildTrend({ now, days: 7, timezone: tz, rows, heldByDay: { "2026-10-13": 999 } });
    expect(t.length).toBe(7);
    expect(t[6]).toEqual({ date: "2026-10-14", payments: 2, flagged: 1, avgRisk: 40, sentCents: 400, heldCents: 0 });
    expect(t[5]).toEqual({ date: "2026-10-13", payments: 1, flagged: 1, avgRisk: 80, sentCents: 400, heldCents: 999 });
    expect(t[0].date).toBe("2026-10-08");
    expect(t[0].avgRisk).toBeNull();
    expect(buildTrend({ now, days: 30, timezone: tz, rows: [] }).length).toBe(30);
  });
});
