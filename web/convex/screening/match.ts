// Pure name-matching for sanctions screening. No ctx, no I/O, so the matcher is unit-testable and
// the same code scores a vendor at onboarding, at list refresh and in the demo page.
//
// Approach follows OFAC's own description (FAQ 249) and common industry practice: normalise both
// names (casefold, strip diacritics/punctuation, drop legal-form suffixes), then run Jaro-Winkler on
// the whole string AND on the token-sorted string (so "Ivanov Dmitri" ~ "Dmitri Ivanov"), and report
// the higher score. OFAC deliberately publishes no threshold; we use the 0.85 industry midpoint.
//
// Security rationale for the classification: automation never produces a "confirmed_match". A score
// is evidence, not a verdict; a sanctions determination has legal weight and is made by a named
// reviewer (see screen.ts `review`). The matcher only decides whether a human must look.

/** Below this a name is clear; at or above, a human must review. */
export const POTENTIAL_MATCH_THRESHOLD = 0.85;
/** At or above this the match is near-certain; still surfaced as potential_match, flagged `strong`. */
export const STRONG_MATCH_THRESHOLD = 0.95;
/** Matches at or above this are stored for the audit trail even though they do not trigger review. */
export const REPORT_ABOVE = 0.7;

export type MatchMethod = "exact" | "jaro_winkler" | "token_sort";
export type Classification = "clear" | "potential_match";

// Legal-form words carry no identity: "Acme LLC" and "Acme Inc" are the same counterparty.
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "sa",
  "sarl", "srl", "spa", "plc", "ag", "bv", "nv", "pty", "lp", "llp", "pte", "oy", "ab", "as", "kk", "ooo", "ltda",
]);

// Connectors carry no identity either: "Alder & Finch" == "Alder and Finch" == "Alder Finch".
const CONNECTORS = new Set(["and", "the", "of"]);

/** Casefold, strip diacritics and punctuation, collapse whitespace, drop legal suffixes. */
export function normalizeName(s: string): string {
  const folded = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining marks left over from NFKD (é -> e)
    .toLowerCase()
    .replace(/\./g, "") // dotted abbreviations: "S.A." -> "sa", "L.L.C." -> "llc"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Drop legal-form tokens anywhere, but never reduce a name to nothing ("Limited" alone stays).
  const kept = folded.filter((tok) => !LEGAL_SUFFIXES.has(tok) && !CONNECTORS.has(tok));
  return (kept.length ? kept : folded).join(" ");
}

/** Jaro similarity in [0,1]. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatched = new Array<boolean>(la).fill(false);
  const bMatched = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(lb - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  return (matches / la + matches / lb + (matches - t) / matches) / 3;
}

/** Standard Jaro-Winkler: Jaro plus a prefix bonus (p = 0.1) for up to 4 shared leading characters. */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

/**
 * Order-insensitive variant: Jaro on the alphabetically sorted tokens of each side, so
 * "Volkov Dmitri" scores as "Dmitri Volkov". Deliberately WITHOUT the Winkler prefix bonus: after
 * sorting, the shared leading characters are whichever token sorts first (often a generic word such
 * as "logistics"), so a prefix bonus would reward the wrong thing and push unrelated vendors that
 * share one industry word over the review threshold.
 */
export function tokenSortRatio(a: string, b: string): number {
  const sort = (s: string) => s.split(/\s+/).filter(Boolean).sort().join(" ");
  return jaro(sort(a), sort(b));
}

export type NameScore = { score: number; method: MatchMethod };

/** Score a candidate (vendor) name against one list name. Inputs may be raw; both are normalised. */
export function scoreNames(candidate: string, entry: string): NameScore {
  const a = normalizeName(candidate);
  const b = normalizeName(entry);
  if (!a || !b) return { score: 0, method: "jaro_winkler" };
  if (a === b) return { score: 1, method: "exact" };
  const jw = jaroWinkler(a, b);
  const ts = tokenSortRatio(a, b);
  // Prefer the whole-string result on ties so the audit record names the simpler technique.
  return ts > jw ? { score: round(ts), method: "token_sort" } : { score: round(jw), method: "jaro_winkler" };
}

/** Never returns "confirmed_match": that decision belongs to a reviewer, not to a score. */
export function classify(score: number): Classification {
  return score >= POTENTIAL_MATCH_THRESHOLD ? "potential_match" : "clear";
}

function round(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
