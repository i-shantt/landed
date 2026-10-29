// Pure scorer for the exported logistic regression (ml/export.py -> risk/weights/transaction_lr.json).
// z = intercept + sum(coef_i * (x_i - mean_i) / std_i); p = sigmoid(z). The per-feature term is the
// contribution shown to operators. No ctx, no I/O; parity with Python is asserted in tests/modelParity.test.ts.

export type LinearFeature = { name: string; mean: number; std: number; coef: number };
export type LinearWeights = {
  version: string;
  family: string;
  trained_on: string[];
  features: LinearFeature[];
  intercept: number;
  threshold: number;
  calibration: { method: "platt"; a: number; b: number };
};

export type Contribution = { feature: string; value: number; contribution: number };

export type LinearScore = { logit: number; probability: number; contributions: Contribution[] };

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function scoreLinear(w: LinearWeights, x: number[]): LinearScore {
  if (x.length !== w.features.length) throw new Error(`feature vector has ${x.length} entries, weights expect ${w.features.length}`);
  let z = w.intercept;
  const contributions: Contribution[] = [];
  for (let i = 0; i < w.features.length; i++) {
    const f = w.features[i];
    const c = (f.coef * (x[i] - f.mean)) / f.std;
    z += c;
    contributions.push({ feature: f.name, value: x[i], contribution: c });
  }
  // Sorted by absolute contribution so the UI can show the top drivers; stable on ties by feature order.
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { logit: z, probability: sigmoid(z), contributions };
}

/** Platt-calibrated probability (fitted on the validation window); informational, the threshold is on the raw probability. */
export function calibrated(w: LinearWeights, logit: number): number {
  return sigmoid(w.calibration.a * logit + w.calibration.b);
}
