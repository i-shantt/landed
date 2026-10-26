/**
 * Derives the headline eval numbers from the rows `useEvalRuns()` returns, the same data the
 * Evaluations page renders. The About and Pitch pages read these instead of hardcoding counts.
 * The runner posts one synthetic row with scenarioId "__metrics__" whose `metrics.markdown` is
 * the "## Metrics" section of eval/RESULTS.md; `passed` / `total` are the run totals.
 */
export type EvalRunRow = {
  scenarioId: string;
  passed?: boolean;
  metrics?: Record<string, unknown>;
};

export type EvalSummary = {
  /** Scenario runs passed / total, from the __metrics__ row (falls back to counting rows). */
  passed: number;
  total: number;
  /** Distinct scenarios (the `__off` twin of a scenario counts once). */
  scenarios: number;
  /** Runs with the extractor on (not `__off`): passed / total. */
  onPassed: number;
  onTotal: number;
  /** Runs with the extractor off: passed / total. */
  offPassed: number;
  offTotal: number;
  /** Parsed from the metrics markdown; null when the line is absent. */
  falseReleases: number | null;
  /** First "These are results…" line of the markdown, if present. */
  disclaimer: string | null;
};

export function summarizeEvalRuns(runs: readonly EvalRunRow[] | undefined): EvalSummary | null {
  if (!runs) return null;
  const rows = runs.filter((r) => r.scenarioId !== "__metrics__" && !r.scenarioId.startsWith("judge:"));
  if (rows.length === 0) return null;
  const metrics = runs.find((r) => r.scenarioId === "__metrics__")?.metrics as
    | { markdown?: string; passed?: number; total?: number }
    | undefined;
  const isOff = (r: EvalRunRow) => r.scenarioId.endsWith("__off") || (r.metrics as { extractor_off?: boolean } | undefined)?.extractor_off === true;
  const on = rows.filter((r) => !isOff(r));
  const off = rows.filter(isOff);
  const lines = (metrics?.markdown ?? "")
    .split("\n")
    .map((l) => l.replace(/\*\*/g, "").replace(/^- /, "").trim())
    .filter(Boolean);
  const fr = lines.find((l) => /^False releases/i.test(l));
  const frMatch = fr ? /:\s*(\d+)\s*$/.exec(fr) : null;
  return {
    passed: typeof metrics?.passed === "number" ? metrics.passed : rows.filter((r) => r.passed).length,
    total: typeof metrics?.total === "number" ? metrics.total : rows.length,
    scenarios: new Set(rows.map((r) => r.scenarioId.replace(/__off$/, ""))).size,
    onPassed: on.filter((r) => r.passed).length,
    onTotal: on.length,
    offPassed: off.filter((r) => r.passed).length,
    offTotal: off.length,
    falseReleases: frMatch ? Number(frMatch[1]) : null,
    disclaimer: lines.find((l) => l.startsWith("These are results")) ?? null,
  };
}
