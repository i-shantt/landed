// Model health, computed on read. Pure: no ctx, no I/O, no writes.
//
// Three questions a reviewer asks of a model in production, answered from the monitored payments
// (monitoring/evaluate.ts) and the training reference exported by ml/export.py:
//   1. Is the score distribution moving?   scoreStability: PSI of the recent half of scored payments vs the earlier half.
//   2. Does live traffic look like training?  domainShift: PSI per feature against the validation-window deciles;
//      scoreShift: PSI of live scores against the validation score distribution. The reference is public
//      consumer-payment data, so a high level here is expected (it is the domain shift the model card declares);
//      the number to watch is its trend.
//   3. Do the shipped trees and the glass-box baseline agree?  agreement: Spearman rank correlation and the
//      flag-disagreement rate between the two scorers on the same feature vectors (champion / challenger).
//
// PSI = sum((actual - expected) * ln(actual / expected)) over bins, with a floor so empty bins stay finite.
// Conventional reading: < 0.10 stable, 0.10-0.25 moderate, >= 0.25 drifted.

export type ReferenceFeature = { name: string; edges: number[]; proportions: number[] };
export type Reference = {
  version: string;
  family: string;
  model: string;
  source: string;
  n: number;
  positives: number;
  features: ReferenceFeature[];
  score: { edges: number[]; proportions: number[] };
  flagged_rate: number;
};

export type DriftStatus = "stable" | "moderate" | "drifted";
export const PSI_MODERATE = 0.1;
export const PSI_DRIFTED = 0.25;
export const MIN_ROWS = 10;
const EPS = 1e-4;

/** Share of values in each of edges.length + 1 bins; a value equal to an edge falls in the lower bin (mirrors ml/export.py). */
export function binProportions(values: number[], edges: number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const v of values) {
    let i = 0;
    while (i < edges.length && v > edges[i]) i++;
    counts[i]++;
  }
  const n = Math.max(values.length, 1);
  return counts.map((c) => c / n);
}

export function psi(expected: number[], actual: number[]): number {
  if (expected.length !== actual.length) throw new Error(`psi: ${expected.length} expected bins vs ${actual.length} actual`);
  let s = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = Math.max(expected[i], EPS);
    const a = Math.max(actual[i], EPS);
    s += (a - e) * Math.log(a / e);
  }
  return s;
}

export function driftStatus(x: number): DriftStatus {
  return x >= PSI_DRIFTED ? "drifted" : x >= PSI_MODERATE ? "moderate" : "stable";
}

/** Average ranks (1-based) with ties sharing the mean rank. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation; null below three pairs or when either side is constant. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ra = ranks(a), rb = ranks(b);
  const ma = ra.reduce((s, x) => s + x, 0) / ra.length, mb = rb.reduce((s, x) => s + x, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export type HealthRow = {
  sentAt: number;
  probability: number;          // shipped trees
  linearProbability: number | null;
  flagged: boolean;
  linearFlagged: boolean | null;
  vector: number[] | null;      // the 20 model features, FEATURE_NAMES order
};

export type FeatureDrift = { feature: string; psi: number; status: DriftStatus };

export type ModelHealth = {
  version: string;
  linearVersion: string;
  referenceVersion: string;
  referenceSource: string;
  scored: number;
  withFeatures: number;
  flaggedRate: number | null;
  referenceFlaggedRate: number;
  meanProbability: number | null;
  agreement: { n: number; spearman: number | null; bothFlagged: number; treesOnly: number; linearOnly: number; neither: number; disagreementRate: number | null };
  scoreStability: { recentN: number; earlierN: number; psi: number; status: DriftStatus } | null;
  scoreShift: { n: number; psi: number; status: DriftStatus } | null;
  domainShift: { n: number; drifted: number; moderate: number; features: FeatureDrift[] } | null;
  minRows: number;
};

export function modelHealth(args: { rows: HealthRow[]; reference: Reference; version: string; linearVersion: string }): ModelHealth {
  const { rows, reference } = args;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const probs = rows.map((r) => r.probability);

  const paired = rows.filter((r) => r.linearProbability !== null && r.linearFlagged !== null);
  const bothFlagged = paired.filter((r) => r.flagged && r.linearFlagged).length;
  const treesOnly = paired.filter((r) => r.flagged && !r.linearFlagged).length;
  const linearOnly = paired.filter((r) => !r.flagged && r.linearFlagged).length;
  const agreement = {
    n: paired.length,
    spearman: spearman(paired.map((r) => r.probability), paired.map((r) => r.linearProbability as number)),
    bothFlagged, treesOnly, linearOnly,
    neither: paired.length - bothFlagged - treesOnly - linearOnly,
    disagreementRate: paired.length ? (treesOnly + linearOnly) / paired.length : null,
  };

  const byTime = rows.slice().sort((a, b) => a.sentAt - b.sentAt);
  const half = Math.floor(byTime.length / 2);
  const earlier = byTime.slice(0, half), recent = byTime.slice(half);
  let scoreStability: ModelHealth["scoreStability"] = null;
  if (earlier.length >= MIN_ROWS && recent.length >= MIN_ROWS) {
    const x = psi(binProportions(earlier.map((r) => r.probability), reference.score.edges), binProportions(recent.map((r) => r.probability), reference.score.edges));
    scoreStability = { recentN: recent.length, earlierN: earlier.length, psi: x, status: driftStatus(x) };
  }

  let scoreShift: ModelHealth["scoreShift"] = null;
  if (rows.length >= MIN_ROWS) {
    const x = psi(reference.score.proportions, binProportions(probs, reference.score.edges));
    scoreShift = { n: rows.length, psi: x, status: driftStatus(x) };
  }

  const vectors = rows.map((r) => r.vector).filter((v): v is number[] => v !== null);
  let domainShift: ModelHealth["domainShift"] = null;
  if (vectors.length >= MIN_ROWS) {
    const features: FeatureDrift[] = reference.features.map((f, k) => {
      const x = psi(f.proportions, binProportions(vectors.map((v) => v[k]), f.edges));
      return { feature: f.name, psi: x, status: driftStatus(x) };
    });
    features.sort((a, b) => b.psi - a.psi);
    domainShift = { n: vectors.length, drifted: features.filter((f) => f.status === "drifted").length, moderate: features.filter((f) => f.status === "moderate").length, features };
  }

  return {
    version: args.version,
    linearVersion: args.linearVersion,
    referenceVersion: reference.version,
    referenceSource: reference.source,
    scored: rows.length,
    withFeatures: vectors.length,
    flaggedRate: rows.length ? rows.filter((r) => r.flagged).length / rows.length : null,
    referenceFlaggedRate: reference.flagged_rate,
    meanProbability: mean(probs),
    agreement,
    scoreStability,
    scoreShift,
    domainShift,
    minRows: MIN_ROWS,
  };
}
