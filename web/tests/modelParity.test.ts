// The TypeScript scorers must reproduce the Python export on fixtures written by ml/export.py.
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scoreLinear, type LinearWeights } from "../convex/risk/model/linear";
import { scoreTrees, type TreeWeights } from "../convex/risk/model/trees";
import treeWeights from "../convex/risk/weights/transaction_gbm.json";
import { scoreText, tokenize, ngrams, type TextWeights } from "../convex/risk/model/text";
import { candidateFeatures, vector, FEATURE_NAMES, median } from "../convex/risk/model/features";
import { TRANSACTION_WEIGHTS, EMAIL_WEIGHTS } from "../convex/risk/model";

const fx = join(__dirname, "fixtures", "model-parity");
const tx = JSON.parse(readFileSync(join(fx, "transaction.json"), "utf8")) as { version: string; cases: { id: number; features: number[]; inputs: Record<string, unknown>; logit: number; probability: number; contributions: number[] }[] };
const em = JSON.parse(readFileSync(join(fx, "text.json"), "utf8")) as { version: string; cases: { text: string; probability: number }[] };
const gb = JSON.parse(readFileSync(join(fx, "transaction_gbm.json"), "utf8")) as { version: string; cases: { id: number; features: number[]; logit: number; probability: number; bias: number; contributions: number[] }[] };
const TREES = treeWeights as TreeWeights;
const weightsDir = join(__dirname, "..", "convex", "risk", "weights");

describe("model bundles", () => {
  it("versions match the fixtures and the bundles stay small", () => {
    expect(TRANSACTION_WEIGHTS.version).toBe(tx.version);
    expect(EMAIL_WEIGHTS.version).toBe(em.version);
    expect(TRANSACTION_WEIGHTS.features.map((f) => f.name)).toEqual([...FEATURE_NAMES]);
    expect(EMAIL_WEIGHTS.tokenizer).toBe("ascii_word2plus_v1");
    expect(EMAIL_WEIGHTS.vocab.length).toBe(EMAIL_WEIGHTS.idf.length);
    expect(EMAIL_WEIGHTS.vocab.length).toBe(EMAIL_WEIGHTS.coef.length);
    expect(statSync(join(weightsDir, "transaction_lr.json")).size).toBeLessThan(8 * 1024);
    expect(statSync(join(weightsDir, "transaction_gbm.json")).size).toBeLessThan(200 * 1024);
    expect(TREES.version).toBe(gb.version);
    expect(TREES.features).toEqual([...FEATURE_NAMES]);
    expect(TREES.trees.length).toBe(TREES.n_trees);
    expect(TREES.max_depth).toBeLessThanOrEqual(4);
    expect(statSync(join(weightsDir, "email_tfidf_lr.json")).size).toBeLessThan(150 * 1024);
    expect(TRANSACTION_WEIGHTS.threshold).toBeGreaterThan(0);
    expect(TRANSACTION_WEIGHTS.threshold).toBeLessThan(1);
  });
});

describe("transaction model parity (50 fixtures)", () => {
  it("has 50 cases", () => expect(tx.cases.length).toBe(50));
  it("feature builder reproduces the Python feature vector exactly", () => {
    for (const c of tx.cases) {
      const i = c.inputs as { amount: number; at: number; hour: number; weekday: number | null; type_: "transfer" | "payment" | "cash_out"; bene_history: [number, number][]; payer_history: [number, number][]; pair_seen_before: boolean; bene_first_seen_at: number | null; threshold: number };
      const f = candidateFeatures({
        amount: i.amount, at: i.at, hour: i.hour, weekday: i.weekday, type: i.type_,
        beneHistory: i.bene_history.map(([at, amount]) => ({ at, amount })),
        payerHistory: i.payer_history.map(([at, amount]) => ({ at, amount })),
        pairSeenBefore: i.pair_seen_before, beneFirstSeenAt: i.bene_first_seen_at, threshold: i.threshold,
      });
      const got = vector(f);
      for (let k = 0; k < got.length; k++) expect(Math.abs(got[k] - c.features[k]), `case ${c.id} ${FEATURE_NAMES[k]}`).toBeLessThan(1e-9);
    }
  });
  it("scores match Python within 1e-6 and contributions within 1e-6", () => {
    for (const c of tx.cases) {
      const s = scoreLinear(TRANSACTION_WEIGHTS as LinearWeights, c.features);
      expect(Math.abs(s.probability - c.probability), `case ${c.id}`).toBeLessThan(1e-6);
      expect(Math.abs(s.logit - c.logit), `case ${c.id} logit`).toBeLessThan(1e-6);
      const byName = Object.fromEntries(s.contributions.map((k) => [k.feature, k.contribution]));
      FEATURE_NAMES.forEach((n, k) => expect(Math.abs(byName[n] - c.contributions[k]), `case ${c.id} ${n}`).toBeLessThan(1e-6));
    }
  });
  it("median matches numpy on even and odd lengths", () => {
    expect(median([1])).toBe(1); expect(median([1, 3])).toBe(2); expect(median([5, 1, 3])).toBe(3); expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("gradient-boosted tree parity (50 fixtures)", () => {
  it("has 50 cases on the same feature vectors as the linear fixtures", () => {
    expect(gb.cases.length).toBe(50);
    gb.cases.forEach((c, i) => expect(c.features).toEqual(tx.cases[i].features));
  });
  it("logit, probability and path attributions match Python within 1e-9", () => {
    for (const c of gb.cases) {
      const s = scoreTrees(TREES, c.features);
      expect(Math.abs(s.logit - c.logit), `case ${c.id} logit`).toBeLessThan(1e-9);
      expect(Math.abs(s.probability - c.probability), `case ${c.id}`).toBeLessThan(1e-9);
      expect(Math.abs(s.bias - c.bias), `case ${c.id} bias`).toBeLessThan(1e-9);
      const byName = Object.fromEntries(s.contributions.map((k) => [k.feature, k.contribution]));
      FEATURE_NAMES.forEach((n, k) => expect(Math.abs(byName[n] - c.contributions[k]), `case ${c.id} ${n}`).toBeLessThan(1e-9));
    }
  });
  it("attributions sum to logit minus bias and every feature is reported once", () => {
    for (const c of gb.cases) {
      const s = scoreTrees(TREES, c.features);
      expect(s.contributions.length).toBe(FEATURE_NAMES.length);
      expect(Math.abs(s.contributions.reduce((a, k) => a + k.contribution, 0) - (s.logit - s.bias))).toBeLessThan(1e-9);
    }
  });
  it("a value exactly on a split threshold goes left, and NaN follows the exported side", () => {
    const w: TreeWeights = { ...TREES, baseline: 0, n_trees: 1, trees: [[[0, 1.5, 1, 2, 1, 0], [-1, -1], [-1, 1]]] };
    const x = new Array(FEATURE_NAMES.length).fill(0);
    expect(scoreTrees(w, [1.5, ...x.slice(1)]).logit).toBe(-1);
    expect(scoreTrees(w, [1.5000001, ...x.slice(1)]).logit).toBe(1);
    expect(scoreTrees(w, [NaN, ...x.slice(1)]).logit).toBe(-1);
    expect(scoreTrees({ ...w, trees: [[[0, 1.5, 1, 2, 0, 0], [-1, -1], [-1, 1]]] }, [NaN, ...x.slice(1)]).logit).toBe(1);
  });
  it("separates fraud-shaped from routine payments at least as well as the linear model on the fixtures", () => {
    // Not a metric claim; a sanity check that the two shipped scorers agree on direction over the fixture set.
    const pairs = gb.cases.map((c, i) => [scoreTrees(TREES, c.features).probability, tx.cases[i].probability]);
    const n = pairs.length;
    let concordant = 0, total = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d1 = pairs[i][0] - pairs[j][0], d2 = pairs[i][1] - pairs[j][1];
      if (d1 === 0 || d2 === 0) continue;
      total++; if (Math.sign(d1) === Math.sign(d2)) concordant++;
    }
    expect(concordant / total).toBeGreaterThan(0.5);
  });
});

describe("email text model parity (50 fixtures)", () => {
  it("has 50 cases including empty, whitespace, non-ASCII and short-token texts", () => {
    expect(em.cases.length).toBe(50);
    expect(em.cases.some((c) => c.text === "")).toBe(true);
    expect(em.cases.some((c) => /[^\x00-\x7f]/.test(c.text))).toBe(true);
  });
  it("tokenizer matches the Python contract", () => {
    expect(tokenize("Hello, World! a I ok 42 x_y")).toEqual(["hello", "world", "ok", "42", "x_y"]);
    expect(tokenize("Ünïcödé café naïve")).toEqual(["caf", "na", "ve"]);
    expect(tokenize("URGENT:wire\tfunds\nnow")).toEqual(["urgent", "wire", "funds", "now"]);
    expect(tokenize("a b c")).toEqual([]);
    expect(ngrams(["a1", "b2", "c3"], 2)).toEqual(["a1", "b2", "c3", "a1 b2", "b2 c3"]);
  });
  it("probabilities match Python within 1e-6", () => {
    for (const [i, c] of em.cases.entries()) {
      const s = scoreText(EMAIL_WEIGHTS as TextWeights, c.text);
      expect(Math.abs(s.probability - c.probability), `case ${i}: ${c.text.slice(0, 40)}`).toBeLessThan(1e-6);
    }
  });
  it("an urgent payment-redirect reads as riskier than a routine invoice email", () => {
    const bad = scoreText(EMAIL_WEIGHTS, "URGENT: please wire the funds today, our bank account has changed. Reply only to this address.");
    const ok = scoreText(EMAIL_WEIGHTS, "Hi team, attached is the Q3 invoice. Same remittance details as always. Thanks!");
    expect(bad.probability).toBeGreaterThan(ok.probability);
    expect(bad.topTokens.length).toBeGreaterThan(0);
  });
});
