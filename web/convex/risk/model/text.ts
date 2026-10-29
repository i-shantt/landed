// Pure scorer for the exported email text model (TF-IDF uni/bigrams + logistic regression).
// Tokenizer `ascii_word2plus_v1` mirrors ml/text.py exactly: non-ASCII -> space, lowercase,
// tokens = runs of [a-z0-9_] of length >= 2, bigrams joined by one space. tf is raw counts,
// idf from the bundle, l2 normalisation over the terms present in the vocabulary.

export type TextWeights = {
  version: string;
  family: string;
  tokenizer: string;
  ngram: [number, number];
  vocab: string[];
  idf: number[];
  coef: number[];
  intercept: number;
  threshold: number;
};

export type TokenContribution = { token: string; contribution: number };
export type TextScore = { probability: number; flagged: boolean; topTokens: TokenContribution[]; tokens: number };

export function tokenize(s: string): string[] {
  // eslint-disable-next-line no-control-regex
  const folded = s.replace(/[^\x00-\x7f]/g, " ").toLowerCase();
  return folded.match(/[a-z0-9_]{2,}/g) ?? [];
}

export function ngrams(tokens: string[], nMax: number): string[] {
  const out = tokens.slice();
  if (nMax >= 2) for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

const indexCache = new WeakMap<TextWeights, Map<string, number>>();
function vocabIndex(w: TextWeights): Map<string, number> {
  let m = indexCache.get(w);
  if (!m) {
    m = new Map(w.vocab.map((t, i) => [t, i] as const));
    indexCache.set(w, m);
  }
  return m;
}

export function scoreText(w: TextWeights, text: string, topN = 8): TextScore {
  const index = vocabIndex(w);
  const toks = tokenize(text);
  const counts = new Map<number, number>();
  for (const g of ngrams(toks, w.ngram[1])) {
    const i = index.get(g);
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  let z = w.intercept;
  const contributions: TokenContribution[] = [];
  if (counts.size > 0) {
    let norm = 0;
    for (const [i, c] of counts) {
      const v = c * w.idf[i];
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    for (const [i, c] of counts) {
      const contribution = ((c * w.idf[i]) / norm) * w.coef[i];
      z += contribution;
      contributions.push({ token: w.vocab[i], contribution });
    }
  }
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const probability = 1 / (1 + Math.exp(-z));
  return { probability, flagged: probability >= w.threshold, topTokens: contributions.slice(0, topN), tokens: toks.length };
}
