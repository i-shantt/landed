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
import { binProportions, psi, driftStatus, ranks, spearman, modelHealth, MIN_ROWS, type Reference, type HealthRow } from "../convex/monitoring/drift";
import { dispositionFor, summariseLabels, type Disposition, type LabelEvent, type LabelSource } from "../convex/monitoring/labels";
import reference from "../convex/risk/weights/transaction_reference.json";
import { FEATURE_NAMES, type HistoryRow } from "../convex/risk/model/features";
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

// ---------------------------------------------------------------- model health (drift)

const REF = reference as Reference;
const unit = fc.double({ min: 0, max: 1, noNaN: true });
const healthRow: fc.Arbitrary<HealthRow> = fc.record({
  sentAt: fc.integer({ min: T0 - 90 * DAY, max: T0 }),
  probability: unit,
  linearProbability: fc.option(unit, { nil: null }),
  flagged: fc.boolean(),
  linearFlagged: fc.option(fc.boolean(), { nil: null }),
  vector: fc.option(fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: FEATURE_NAMES.length, maxLength: FEATURE_NAMES.length }), { nil: null }),
});
const sameLength = <T,>(arb: fc.Arbitrary<T>, min: number, max: number) =>
  fc.integer({ min, max }).chain((n) => fc.tuple(fc.array(arb, { minLength: n, maxLength: n }), fc.array(arb, { minLength: n, maxLength: n })));
const isConstant = (xs: number[]) => xs.every((x) => x === xs[0]);

describe("model health: PSI, ranks and Spearman behave like the statistics they claim to be", () => {
  it("binProportions: edges.length + 1 bins in [0, 1] that sum to 1 (all zero when empty), independent of order", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { maxLength: 60 }), fc.uniqueArray(fc.double({ min: -100, max: 100, noNaN: true }), { maxLength: 12 }), (values, edgesRaw) => {
        const edges = edgesRaw.slice().sort((a, b) => a - b);
        const p = binProportions(values, edges);
        expect(p.length).toBe(edges.length + 1);
        for (const x of p) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
        }
        const sum = p.reduce((s, x) => s + x, 0);
        if (values.length === 0) expect(sum).toBe(0);
        else expect(sum).toBeCloseTo(1, 9);
        expect(binProportions(values.slice().reverse(), edges)).toEqual(p);
      }),
      RUNS,
    );
  });

  it("psi is non-negative, zero on identical distributions, symmetric, finite, and rejects a bin-count mismatch", () => {
    fc.assert(
      fc.property(sameLength(unit, 1, 12), (pair) => {
        const [e, a] = pair;
        const x = psi(e, a);
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(psi(e, e)).toBe(0);
        expect(Math.abs(psi(a, e) - x)).toBeLessThanOrEqual(1e-12 * Math.max(1, x));
        expect(driftStatus(x)).toBe(x >= 0.25 ? "drifted" : x >= 0.1 ? "moderate" : "stable");
        expect(() => psi(e, [...a, 0])).toThrow(/bins/);
      }),
      RUNS,
    );
  });

  it("ranks are 1-based average ranks: they sum to n(n+1)/2, lie in [1, n], and ignore any strictly increasing transform", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { maxLength: 30 }), (xs) => {
        const r = ranks(xs);
        const n = xs.length;
        expect(r.length).toBe(n);
        expect(r.reduce((s, x) => s + x, 0)).toBe((n * (n + 1)) / 2);
        for (const x of r) {
          expect(x).toBeGreaterThanOrEqual(n ? 1 : 0);
          expect(x).toBeLessThanOrEqual(n);
        }
        expect(ranks(xs.map((x) => 2 * x + 1))).toEqual(r);
        // equal inputs share a rank, distinct inputs are ordered
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          if (xs[i] === xs[j]) expect(r[i]).toBe(r[j]);
          if (xs[i] < xs[j]) expect(r[i]).toBeLessThan(r[j]);
        }
      }),
      RUNS,
    );
  });

  it("spearman: null below three pairs or on a constant side, otherwise in [-1, 1], symmetric, 1 with itself, -1 with its negation, invariant under increasing transforms", () => {
    fc.assert(
      fc.property(sameLength(fc.integer({ min: -50, max: 50 }), 3, 30), (pair) => {
        const [a, b] = pair;
        const s = spearman(a, b);
        if (isConstant(a) || isConstant(b)) {
          expect(s).toBeNull();
          return;
        }
        expect(s).not.toBeNull();
        expect(s!).toBeGreaterThanOrEqual(-1 - 1e-12);
        expect(s!).toBeLessThanOrEqual(1 + 1e-12);
        expect(spearman(b, a)!).toBeCloseTo(s!, 12);
        expect(spearman(a, a)!).toBeCloseTo(1, 12);
        expect(spearman(a, a.map((x) => -x))!).toBeCloseTo(-1, 12);
        expect(spearman(a.map((x) => 3 * x + 7), b)!).toBeCloseTo(s!, 12);
        expect(spearman(a.slice(0, 2), b.slice(0, 2))).toBeNull();
        expect(spearman(a, b.slice(1))).toBeNull();
      }),
      RUNS,
    );
  });

  it("modelHealth: agreement counts partition the paired rows, every block is null exactly below MIN_ROWS, domain shift is sorted by PSI", () => {
    fc.assert(
      fc.property(fc.array(healthRow, { maxLength: 30 }), (rows) => {
        const h = modelHealth({ rows, reference: REF, version: "t", linearVersion: "l" });
        expect(h.scored).toBe(rows.length);
        const withFeatures = rows.filter((r) => r.vector !== null).length;
        expect(h.withFeatures).toBe(withFeatures);
        const paired = rows.filter((r) => r.linearProbability !== null && r.linearFlagged !== null).length;
        const ag = h.agreement;
        expect(ag.n).toBe(paired);
        expect(ag.bothFlagged + ag.treesOnly + ag.linearOnly + ag.neither).toBe(paired);
        if (paired === 0) expect(ag.disagreementRate).toBeNull();
        else {
          expect(ag.disagreementRate).toBeCloseTo((ag.treesOnly + ag.linearOnly) / paired, 12);
          expect(ag.disagreementRate!).toBeGreaterThanOrEqual(0);
          expect(ag.disagreementRate!).toBeLessThanOrEqual(1);
        }
        if (rows.length === 0) {
          expect(h.flaggedRate).toBeNull();
          expect(h.meanProbability).toBeNull();
        } else {
          expect(h.flaggedRate).toBeCloseTo(rows.filter((r) => r.flagged).length / rows.length, 12);
          expect(h.meanProbability!).toBeGreaterThanOrEqual(0);
          expect(h.meanProbability!).toBeLessThanOrEqual(1);
        }
        expect(h.scoreShift === null).toBe(rows.length < MIN_ROWS);
        expect(h.scoreStability === null).toBe(Math.floor(rows.length / 2) < MIN_ROWS);
        expect(h.domainShift === null).toBe(withFeatures < MIN_ROWS);
        for (const block of [h.scoreShift, h.scoreStability]) {
          if (!block) continue;
          expect(block.psi).toBeGreaterThanOrEqual(0);
          expect(block.status).toBe(driftStatus(block.psi));
        }
        if (h.domainShift) {
          expect(h.domainShift.n).toBe(withFeatures);
          expect(h.domainShift.features.length).toBe(REF.features.length);
          expect(h.domainShift.drifted + h.domainShift.moderate).toBeLessThanOrEqual(REF.features.length);
          for (let i = 0; i < h.domainShift.features.length; i++) {
            const f = h.domainShift.features[i];
            expect(f.status).toBe(driftStatus(f.psi));
            if (i > 0) expect(f.psi).toBeLessThanOrEqual(h.domainShift.features[i - 1].psi);
          }
          expect(h.domainShift.drifted).toBe(h.domainShift.features.filter((f) => f.status === "drifted").length);
        }
        expect(h.minRows).toBe(MIN_ROWS);
      }),
      { numRuns: 150 },
    );
  });
});

// ---------------------------------------------------------------- labels from dispositions

const SOURCES: LabelSource[] = ["landed", "attested_landed", "unconfirmed", "fraud_reported", "case_recovery"];
const disposition: fc.Arbitrary<Disposition | null> = fc.option(
  fc.record({ label: fc.constantFrom(0, 1) as fc.Arbitrary<0 | 1>, source: fc.constantFrom(...SOURCES), decidedAt: fc.option(fc.integer({ min: 0, max: T0 }), { nil: null }) }),
  { nil: null },
);
const labelEvent: fc.Arbitrary<LabelEvent> = fc.record({
  type: fc.constantFrom("fraud_reported", "recovery_started", "landing_unconfirmed", "payment_landed", "case_opened", "probe_sent"),
  at: fc.integer({ min: T0 - 30 * DAY, max: T0 }),
  payload: fc.option(fc.record({ method: fc.constantFrom("operator_attestation", "rail_confirmation") }), { nil: undefined }),
});

describe("labels: dispositions come only from outcomes and the summary partitions them", () => {
  it("summariseLabels: labelled + pending = rows, positives + negatives = labelled, sources sum to labelled, additive over concatenation", () => {
    fc.assert(
      fc.property(fc.array(disposition, { maxLength: 40 }), fc.array(disposition, { maxLength: 40 }), (a, b) => {
        const s = summariseLabels(a);
        expect(s.labelled + s.pending).toBe(a.length);
        expect(s.positives + s.negatives).toBe(s.labelled);
        expect(SOURCES.reduce((n, k) => n + s.bySource[k], 0)).toBe(s.labelled);
        const sb = summariseLabels(b);
        const both = summariseLabels([...a, ...b]);
        expect(both.labelled).toBe(s.labelled + sb.labelled);
        expect(both.positives).toBe(s.positives + sb.positives);
        expect(both.negatives).toBe(s.negatives + sb.negatives);
        expect(both.pending).toBe(s.pending + sb.pending);
        for (const k of SOURCES) expect(both.bySource[k]).toBe(s.bySource[k] + sb.bySource[k]);
        expect(summariseLabels(a.slice().reverse())).toEqual(s);
      }),
      RUNS,
    );
  });

  it("dispositionFor: a fraud report always wins, suspicious and benign sources never mix, null only for a pending payment with nothing against it", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("pending", "landed", "unconfirmed") as fc.Arbitrary<"pending" | "landed" | "unconfirmed">,
        fc.option(fc.constantFrom("HELD", "PROBE_SENT", "VERIFIED", "NEEDS_HUMAN", "RECOVERY", "UNCONFIRMED", "CLOSED"), { nil: null }),
        fc.array(labelEvent, { maxLength: 8 }),
        fc.array(labelEvent, { maxLength: 8 }),
        (landingState, caseState, caseEvents, paymentEvents) => {
          const d = dispositionFor({ landingState, caseState, caseEvents, paymentEvents });
          const fraud = caseEvents.some((e) => e.type === "fraud_reported");
          const recovery = caseState === "RECOVERY" || caseState === "UNCONFIRMED";
          if (fraud) {
            expect(d).toEqual({ label: 1, source: "fraud_reported", decidedAt: expect.any(Number) });
            return;
          }
          if (d === null) {
            expect(landingState).toBe("pending");
            expect(recovery).toBe(false);
            return;
          }
          expect(SOURCES).toContain(d.source);
          if (d.label === 1) expect(["fraud_reported", "case_recovery", "unconfirmed"]).toContain(d.source);
          else expect(["landed", "attested_landed"]).toContain(d.source);
          if (recovery) expect(d).toMatchObject({ label: 1, source: "case_recovery" });
          else if (landingState === "unconfirmed") expect(d).toMatchObject({ label: 1, source: "unconfirmed" });
          else expect(d.label).toBe(0);
          if (d.decidedAt !== null) expect(Number.isFinite(d.decidedAt)).toBe(true);
          // the label and its source do not depend on the order events are listed
          const again = dispositionFor({ landingState, caseState, caseEvents: caseEvents.slice().reverse(), paymentEvents: paymentEvents.slice().reverse() });
          expect(again).toMatchObject({ label: d.label, source: d.source });
        },
      ),
      RUNS,
    );
  });
});
