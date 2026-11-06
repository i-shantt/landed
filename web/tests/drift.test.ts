// Model-health arithmetic (monitoring/drift.ts): bins, PSI, Spearman, and the health summary over synthetic rows.
import { describe, it, expect } from "vitest";
import { binProportions, psi, driftStatus, ranks, spearman, modelHealth, MIN_ROWS, type Reference, type HealthRow } from "../convex/monitoring/drift";
import reference from "../convex/risk/weights/transaction_reference.json";
import { FEATURE_NAMES } from "../convex/risk/model/features";

const REF = reference as Reference;

describe("bins and PSI", () => {
  it("binProportions puts a value on an edge in the lower bin and sums to one", () => {
    expect(binProportions([0, 0.5, 1, 2], [0.5, 1.5])).toEqual([0.5, 0.25, 0.25]);
    expect(binProportions([], [0.5])).toEqual([0, 0]);
    const p = binProportions([-3, -1, 0, 1, 3, 9], [-2, 0, 2]);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
  });
  it("PSI is zero for identical distributions, symmetric, and grows with the shift", () => {
    expect(psi([0.5, 0.5], [0.5, 0.5])).toBe(0);
    const small = psi([0.5, 0.3, 0.2], [0.48, 0.31, 0.21]);
    const large = psi([0.5, 0.3, 0.2], [0.1, 0.2, 0.7]);
    expect(small).toBeLessThan(0.1);
    expect(large).toBeGreaterThan(0.25);
    expect(psi([0.5, 0.3, 0.2], [0.1, 0.2, 0.7])).toBeCloseTo(psi([0.1, 0.2, 0.7], [0.5, 0.3, 0.2]), 12);
    expect(Number.isFinite(psi([1, 0], [0, 1]))).toBe(true); // empty bins are floored, never -Infinity/NaN
    expect(() => psi([0.5, 0.5], [1])).toThrow();
  });
  it("status thresholds follow the conventional 0.10 / 0.25 reading", () => {
    expect(driftStatus(0.099)).toBe("stable");
    expect(driftStatus(0.1)).toBe("moderate");
    expect(driftStatus(0.25)).toBe("drifted");
  });
});

describe("rank correlation", () => {
  it("average ranks on ties; Spearman is 1 on a monotone pair, -1 reversed, null when constant or too short", () => {
    expect(ranks([10, 30, 20, 30])).toEqual([1, 3.5, 2, 3.5]);
    expect(spearman([1, 2, 3, 4], [10, 20, 40, 80])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2, 3, 4, 5], [1, 3, 2, 5, 4])).toBeCloseTo(0.8, 12);
  });
});

function row(i: number, p: number, lp: number | null, vector: number[] | null = null): HealthRow {
  return { sentAt: 1_700_000_000_000 + i * 3_600_000, probability: p, linearProbability: lp, flagged: p >= 0.81, linearFlagged: lp === null ? null : lp >= 0.8405, vector };
}

describe("modelHealth", () => {
  it("below the minimum rows the distribution blocks are null and the counts still report", () => {
    const h = modelHealth({ rows: [row(0, 0.2, 0.3), row(1, 0.9, 0.9)], reference: REF, version: "t", linearVersion: "l" });
    expect(h.scored).toBe(2);
    expect(h.scoreShift).toBeNull();
    expect(h.scoreStability).toBeNull();
    expect(h.domainShift).toBeNull();
    expect(h.flaggedRate).toBe(0.5);
    expect(h.agreement).toMatchObject({ n: 2, bothFlagged: 1, treesOnly: 0, linearOnly: 0, neither: 1, disagreementRate: 0, spearman: null });
    expect(h.minRows).toBe(MIN_ROWS);
    expect(h.referenceVersion).toBe(REF.version);
  });
  it("a stable stream reads stable; a stream whose recent half jumps reads drifted", () => {
    const steady = Array.from({ length: 40 }, (_, i) => row(i, 0.05 + 0.01 * (i % 5), 0.1 + 0.01 * (i % 5)));
    const hs = modelHealth({ rows: steady, reference: REF, version: "t", linearVersion: "l" });
    expect(hs.scoreStability!.status).toBe("stable");
    expect(hs.scoreStability!.recentN).toBe(20);
    const jump = steady.map((r, i) => (i >= 20 ? { ...r, probability: 0.95, flagged: true } : r));
    const hj = modelHealth({ rows: jump, reference: REF, version: "t", linearVersion: "l" });
    expect(hj.scoreStability!.status).toBe("drifted");
    expect(hj.scoreStability!.psi).toBeGreaterThan(hs.scoreStability!.psi);
  });
  it("agreement counts the two scorers' flags and ranks; domain shift ranks features by PSI against the reference", () => {
    const n = 30;
    const rows = Array.from({ length: n }, (_, i) => {
      const p = i / n;
      const vec = FEATURE_NAMES.map(() => 0);
      vec[0] = 2 + 0.1 * i;  // amount_log inside the reference range
      vec[17] = 5000;        // bene_age_days far above every reference edge -> drifted
      return row(i, p, 1 - p, vec);
    });
    const h = modelHealth({ rows, reference: REF, version: "t", linearVersion: "l" });
    expect(h.agreement.spearman).toBeCloseTo(-1, 12);
    expect(h.agreement.treesOnly + h.agreement.linearOnly).toBe(h.agreement.n - h.agreement.bothFlagged - h.agreement.neither);
    expect(h.domainShift!.n).toBe(n);
    expect(h.domainShift!.features.length).toBe(FEATURE_NAMES.length);
    expect(h.domainShift!.features[0].psi).toBeGreaterThanOrEqual(h.domainShift!.features[1].psi);
    expect(h.domainShift!.features.find((f) => f.feature === "bene_age_days")!.status).toBe("drifted");
    expect(h.scoreShift!.n).toBe(n);
    expect(["stable", "moderate", "drifted"]).toContain(h.scoreShift!.status);
  });
  it("the shipped reference is well formed: one bin more than edges per feature, proportions sum to one", () => {
    expect(REF.features.map((f) => f.name)).toEqual([...FEATURE_NAMES]);
    for (const f of REF.features) {
      expect(f.proportions.length).toBe(f.edges.length + 1);
      expect(f.proportions.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 3);
      expect([...f.edges]).toEqual([...f.edges].sort((a, b) => a - b));
    }
    expect(REF.score.proportions.length).toBe(10);
  });
});
