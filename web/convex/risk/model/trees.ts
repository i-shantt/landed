// Pure scorer for the exported gradient-boosted trees (ml/trees.py -> risk/weights/transaction_gbm.json).
// logit = baseline + sum over trees of the reached leaf's value; p = sigmoid(logit). Routing is x <= threshold
// -> left, with the exported side for NaN. Thresholds carry full double precision, so a comparison here is
// bit-for-bit the one sklearn made; parity is asserted on 50 fixtures in tests/modelParity.test.ts.
//
// Contributions are path attributions: each split moves the estimate from the parent's value to the child's
// and that delta is credited to the split feature. Over all trees they sum to logit - bias exactly, where
// bias = baseline + sum of root values. Same quantity the Python side writes into the fixtures.
import { sigmoid, type Contribution } from "./linear";

/** Internal node: [feature, threshold, left, right, missingGoesLeft, value]. Leaf: [-1, value]. */
export type TreeNode = [number, number, number, number, number, number] | [number, number];
export type TreeWeights = {
  version: string;
  family: string;
  trained_on: string[];
  features: string[];
  baseline: number;
  n_trees: number;
  max_depth: number;
  trees: TreeNode[][];
  threshold: number;
  calibration: { method: "platt"; a: number; b: number };
};

export type TreeScore = { logit: number; probability: number; bias: number; contributions: Contribution[] };

const LEAF = -1;

function valueOf(n: TreeNode): number {
  return n[0] === LEAF ? n[1] : (n as [number, number, number, number, number, number])[5];
}

export function scoreTrees(w: TreeWeights, x: number[]): TreeScore {
  if (x.length !== w.features.length) throw new Error(`feature vector has ${x.length} entries, trees expect ${w.features.length}`);
  const acc = new Array<number>(x.length).fill(0);
  let logit = w.baseline;
  let bias = w.baseline;
  for (const nodes of w.trees) {
    let i = 0;
    let prev = valueOf(nodes[0]);
    bias += prev;
    while (nodes[i][0] !== LEAF) {
      const [f, t, left, right, missingLeft] = nodes[i] as [number, number, number, number, number, number];
      const xi = x[f];
      i = Number.isNaN(xi) ? (missingLeft ? left : right) : xi <= t ? left : right;
      const nv = valueOf(nodes[i]);
      acc[f] += nv - prev;
      prev = nv;
    }
    logit += nodes[i][1];
  }
  const contributions: Contribution[] = w.features.map((feature, k) => ({ feature, value: x[k], contribution: acc[k] }));
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { logit, probability: sigmoid(logit), bias, contributions };
}

/** Platt-calibrated probability (fitted on the validation window); informational, the threshold is on the raw probability. */
export function calibratedTrees(w: TreeWeights, logit: number): number {
  return sigmoid(w.calibration.a * logit + w.calibration.b);
}
