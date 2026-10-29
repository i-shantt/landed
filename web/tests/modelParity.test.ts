// The TypeScript scorers must reproduce the Python export on fixtures written by ml/export.py.
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scoreLinear, type LinearWeights } from "../convex/risk/model/linear";
import { scoreText, tokenize, ngrams, type TextWeights } from "../convex/risk/model/text";
import { candidateFeatures, vector, FEATURE_NAMES, median } from "../convex/risk/model/features";
import { TRANSACTION_WEIGHTS, EMAIL_WEIGHTS } from "../convex/risk/model";

const fx = join(__dirname, "fixtures", "model-parity");
const tx = JSON.parse(readFileSync(join(fx, "transaction.json"), "utf8")) as { version: string; cases: { id: number; features: number[]; inputs: Record<string, unknown>; logit: number; probability: number; contributions: number[] }[] };
const em = JSON.parse(readFileSync(join(fx, "text.json"), "utf8")) as { version: string; cases: { text: string; probability: number }[] };
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
