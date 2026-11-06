// Property-based tests (fast-check), second pass: the pure monitoring and model modules. The first pass
// (tests/properties.test.ts) covers the payment boundary and the file builders; the fixed-example tests in
// monitoring.test.ts, drift.test.ts, dispositionLabels.test.ts and modelParity.test.ts pin specific values.
// Each property here states an invariant that must hold for every generated input; a failure prints the
// shrunk counterexample. Timezones are pinned to UTC so calendar expectations are computable in the test.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { evaluateCandidate, structuringClusters, robustZ, weeklyCounts, median, DAY, FLAG_AT, STRUCTURING_WINDOW, STRUCTURING_BAND, type MonitoringCandidate, type MonitoringSignalId } from "../convex/monitoring/signals";
import { trustScore, bandFor, type TrustInput } from "../convex/monitoring/beneficiaryTrust";
import { buildTrend, localDate, type TrendRow } from "../convex/monitoring/trend";
import type { HistoryRow } from "../convex/risk/model/features";
import { T0 } from "./fixtures";

const RUNS = { numRuns: 300 };
const SIGNAL_IDS: MonitoringSignalId[] = [
  "velocity_24h", "velocity_7d", "amount_zscore", "amount_ratio_median", "structuring_under_threshold",
  "dormant_vendor_spike", "first_payment_recently_verified", "round_amount", "off_hours_initiation",
];

// ---------------------------------------------------------------- arbitraries

/** A prior payment strictly before the candidate at T0 (up to 400 days back). */
const histRow = (opts: { maxAmount?: number; minAt?: number; maxAt?: number } = {}): fc.Arbitrary<HistoryRow> =>
  fc.record({
    vendorId: fc.constant("vendor"),
    destinationAccountId: fc.constantFrom("acct-1", "acct-2"),
    amountCents: fc.integer({ min: 1, max: opts.maxAmount ?? 50_000_000 }),
    at: fc.integer({ min: opts.minAt ?? T0 - 400 * DAY, max: opts.maxAt ?? T0 - 1 }),
    source: fc.constantFrom("payment", "invoice_history") as fc.Arbitrary<"payment" | "invoice_history">,
  });

/** Histories with distinct timestamps, so ordering by `at` is unambiguous. */
const history = fc.uniqueArray(histRow(), { maxLength: 40, selector: (r) => r.at });

const candidate: fc.Arbitrary<MonitoringCandidate> = fc.record({
  amountCents: fc.integer({ min: 1, max: 50_000_000 }),
  at: fc.constant(T0),
  vendorId: fc.constant("vendor"),
  destinationAccountId: fc.constantFrom("acct-1", "acct-2"),
  rail: fc.constantFrom("ach", "wire") as fc.Arbitrary<"ach" | "wire">,
  isFirstPaymentToAccount: fc.boolean(),
  verifiedAt: fc.option(fc.integer({ min: T0 - 30 * DAY, max: T0 }), { nil: null }),
  timezone: fc.constant("UTC"),
  thresholdCents: fc.option(fc.integer({ min: 100_000, max: 5_000_000 }), { nil: null }),
});

const trustInput: fc.Arbitrary<TrustInput> = fc.record({
  now: fc.constant(T0),
  vendorOnboardedAt: fc.integer({ min: T0 - 1000 * DAY, max: T0 + 10 * DAY }),
  landedPayments: fc.integer({ min: 0, max: 100 }),
  unconfirmedPayments: fc.integer({ min: 0, max: 5 }),
  lastBankChangeAt: fc.option(fc.integer({ min: T0 - 400 * DAY, max: T0 }), { nil: null }),
  screening: fc.constantFrom("none", "clear", "potential", "confirmed") as fc.Arbitrary<TrustInput["screening"]>,
  modelProbability: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  openCases: fc.integer({ min: 0, max: 5 }),
});

const trendRow: fc.Arbitrary<TrendRow> = fc.record({
  at: fc.integer({ min: T0 - 40 * DAY, max: T0 + 2 * DAY }),
  flagged: fc.boolean(),
  flagScore: fc.integer({ min: 0, max: 100 }),
  amountCents: fc.integer({ min: 1, max: 10_000_000 }),
});

const sameResult = (a: ReturnType<typeof evaluateCandidate>, b: ReturnType<typeof evaluateCandidate>) => {
  expect(b.flagScore).toBe(a.flagScore);
  expect(b.flagged).toBe(a.flagged);
  expect(b.signals.map((s) => s.id)).toEqual(a.signals.map((s) => s.id));
};

// ---------------------------------------------------------------- signals

describe("monitoring signals: the flag score is exactly the capped sum of what fired", () => {
  it("flagScore = min(100, sum of weights), flagged iff >= FLAG_AT, checked is the fixed list, signals a duplicate-free subset", () => {
    fc.assert(
      fc.property(candidate, history, (c, rows) => {
        const r = evaluateCandidate(c, rows);
        expect(r.checked).toEqual(SIGNAL_IDS);
        const ids = r.signals.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(SIGNAL_IDS).toContain(id);
        expect(r.flagScore).toBe(Math.min(100, r.signals.reduce((s, x) => s + x.weight, 0)));
        expect(r.flagScore).toBeGreaterThanOrEqual(0);
        expect(r.flagScore).toBeLessThanOrEqual(100);
        expect(r.flagged).toBe(r.flagScore >= FLAG_AT);
        for (const s of r.signals) expect(s.evidence.length).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });

  it("the order of the history never matters, and rows at or after the candidate are invisible to it", () => {
    fc.assert(
      fc.property(candidate, history, fc.array(histRow({ minAt: T0, maxAt: T0 + 30 * DAY }), { maxLength: 10 }), (c, rows, future) => {
        const base = evaluateCandidate(c, rows);
        sameResult(base, evaluateCandidate(c, rows.slice().reverse()));
        sameResult(base, evaluateCandidate(c, rows.slice().sort((a, b) => a.amountCents - b.amountCents)));
        sameResult(base, evaluateCandidate(c, [...future, ...rows]));
        // with fewer than three prior amounts the baseline signals cannot fire; without a threshold, structuring cannot
        if (rows.length < 3) expect(base.signals.find((s) => s.id === "amount_zscore" || s.id === "amount_ratio_median")).toBeUndefined();
        if (c.thresholdCents === null) expect(base.signals.find((s) => s.id === "structuring_under_threshold")).toBeUndefined();
      }),
      RUNS,
    );
  });

  it("structuringClusters: every member is in [band*T, T), clusters have >= 2 rows summing to >= T within the window, disjoint and time-ordered", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 5_000_000 }),
        fc.uniqueArray(fc.record({ at: fc.integer({ min: T0 - 30 * DAY, max: T0 }), amountCents: fc.integer({ min: 1, max: 10_000_000 }) }), { maxLength: 40, selector: (r) => r.at }),
        (T, rowsRaw) => {
          // amounts relative to T so the band is actually populated
          const rows = rowsRaw.map((r, i) => ({ ...r, amountCents: i % 2 ? Math.floor(T * (0.85 + (r.amountCents % 20) / 100)) : r.amountCents }));
          const clusters = structuringClusters(rows, T);
          const seen = new Set<number>();
          for (const g of clusters) {
            expect(g.length).toBeGreaterThanOrEqual(2);
            expect(g.reduce((s, r) => s + r.amountCents, 0)).toBeGreaterThanOrEqual(T);
            expect(g[g.length - 1].at - g[0].at).toBeLessThanOrEqual(STRUCTURING_WINDOW);
            for (let i = 0; i < g.length; i++) {
              expect(g[i].amountCents).toBeGreaterThanOrEqual(STRUCTURING_BAND * T);
              expect(g[i].amountCents).toBeLessThan(T);
              if (i > 0) expect(g[i].at).toBeGreaterThanOrEqual(g[i - 1].at);
              expect(seen.has(g[i].at)).toBe(false);
              seen.add(g[i].at);
            }
          }
          // a row outside the band never appears, whatever the order of the input
          const again = structuringClusters(rows.slice().reverse(), T);
          expect(again.map((g) => g.map((r) => r.at))).toEqual(clusters.map((g) => g.map((r) => r.at)));
        },
      ),
      RUNS,
    );
  });

  it("weeklyCounts partitions the rows: non-negative integer buckets that sum to the row count, independent of order", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ at: fc.integer({ min: T0 - 400 * DAY, max: T0 }) }), { maxLength: 60 }), (rows) => {
        const w = weeklyCounts(rows, T0);
        if (rows.length === 0) {
          expect(w).toEqual([]);
          return;
        }
        const first = Math.min(...rows.map((r) => r.at));
        expect(w.length).toBe(Math.max(1, Math.ceil((T0 - first) / (7 * DAY))));
        for (const n of w) {
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(0);
        }
        expect(w.reduce((s, n) => s + n, 0)).toBe(rows.length);
        expect(weeklyCounts(rows.slice().reverse(), T0)).toEqual(w);
      }),
      RUNS,
    );
  });

  it("robustZ is invariant under a common shift and a positive rescale, has the sign of x - median, and median lies within the sample", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 3, maxLength: 25 }),
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: 1, max: 9 }),
        (x, prior, shift, scale) => {
          const med = median(prior);
          const s = prior.slice().sort((a, b) => a - b);
          expect(med).toBeGreaterThanOrEqual(s[0]);
          expect(med).toBeLessThanOrEqual(s[s.length - 1]);
          expect(median(prior.slice().reverse())).toBe(med);
          const z = robustZ(x, prior);
          const z2 = robustZ(scale * x + shift, prior.map((v) => scale * v + shift));
          if (Number.isNaN(z)) {
            expect(Number.isNaN(z2)).toBe(true);
            return;
          }
          expect(Number.isFinite(z)).toBe(true);
          expect(Math.abs(z2 - z)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(z)));
          expect(Math.sign(z)).toBe(Math.sign(x - med));
          // one unit of z is one scaled MAD: moving x by that much moves z by one
          const mad = median(prior.map((v) => Math.abs(v - med)));
          expect(robustZ(x + 1.4826 * mad, prior)).toBeCloseTo(z + 1, 6);
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------- beneficiary trust

describe("beneficiary trust: a bounded, auditable, monotone score", () => {
  it("score is an integer in [0, 100], equals the clamped rounded component sum, and the band follows bandFor", () => {
    fc.assert(
      fc.property(trustInput, (i) => {
        const r = trustScore(i);
        expect(Number.isInteger(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(r.band).toBe(bandFor(r.score));
        const sum = r.components.reduce((s, c) => s + c.points, 0);
        expect(r.score).toBe(Math.max(0, Math.min(100, Math.round(sum))));
        for (const c of r.components) expect(c.evidence.length).toBeGreaterThan(0);
        if (i.screening === "confirmed") {
          expect(r.score).toBe(0);
          expect(r.band).toBe("new");
        }
      }),
      RUNS,
    );
  });

  it("never decreases with tenure, landed payments or time since the last bank change; never increases with open cases, unconfirmed payments or model probability", () => {
    fc.assert(
      fc.property(
        trustInput,
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 3 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (i, moreDays, morePayments, moreCases, pBump) => {
          const base = trustScore(i).score;
          expect(trustScore({ ...i, vendorOnboardedAt: i.vendorOnboardedAt - moreDays * DAY }).score).toBeGreaterThanOrEqual(base);
          expect(trustScore({ ...i, landedPayments: i.landedPayments + morePayments }).score).toBeGreaterThanOrEqual(base);
          if (i.lastBankChangeAt !== null) expect(trustScore({ ...i, lastBankChangeAt: i.lastBankChangeAt - moreDays * DAY }).score).toBeGreaterThanOrEqual(base);
          expect(trustScore({ ...i, openCases: i.openCases + moreCases }).score).toBeLessThanOrEqual(base);
          expect(trustScore({ ...i, unconfirmedPayments: i.unconfirmedPayments + moreCases }).score).toBeLessThanOrEqual(base);
          const p = i.modelProbability ?? 0;
          expect(trustScore({ ...i, modelProbability: Math.min(1, p + pBump) }).score).toBeLessThanOrEqual(trustScore({ ...i, modelProbability: p }).score);
          // a clear screening is worth at least as much as none, and a potential match never more than clear
          const clear = trustScore({ ...i, screening: "clear" }).score;
          expect(clear).toBeGreaterThanOrEqual(trustScore({ ...i, screening: "none" }).score);
          expect(trustScore({ ...i, screening: "potential" }).score).toBeLessThanOrEqual(clear);
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------- trend

describe("risk trend: per-day bins conserve the rows inside the window", () => {
  it("exactly `days` ascending distinct dates ending today; counts, flags and cents add up; order of rows is irrelevant", () => {
    fc.assert(
      fc.property(fc.constantFrom(7, 30) as fc.Arbitrary<7 | 30>, fc.array(trendRow, { maxLength: 80 }), fc.integer({ min: T0 - 5 * DAY, max: T0 + 5 * DAY }), (days, rows, now) => {
        const tz = "UTC";
        const out = buildTrend({ now, days, timezone: tz, rows });
        expect(out.length).toBe(days);
        expect(out[out.length - 1].date).toBe(localDate(now, tz));
        for (let i = 1; i < out.length; i++) expect(out[i].date > out[i - 1].date).toBe(true);
        const dates = new Set(out.map((d) => d.date));
        const inside = rows.filter((r) => dates.has(localDate(r.at, tz)));
        expect(out.reduce((s, d) => s + d.payments, 0)).toBe(inside.length);
        expect(out.reduce((s, d) => s + d.flagged, 0)).toBe(inside.filter((r) => r.flagged).length);
        expect(out.reduce((s, d) => s + d.sentCents, 0)).toBe(inside.reduce((s, r) => s + r.amountCents, 0));
        for (const d of out) {
          expect(d.flagged).toBeLessThanOrEqual(d.payments);
          expect(d.heldCents).toBe(0);
          if (d.payments === 0) expect(d.avgRisk).toBeNull();
          else {
            expect(d.avgRisk).toBeGreaterThanOrEqual(0);
            expect(d.avgRisk).toBeLessThanOrEqual(100);
          }
        }
        expect(buildTrend({ now, days, timezone: tz, rows: rows.slice().reverse() })).toEqual(out);
      }),
      { numRuns: 150 },
    );
  });
});
