import { describe, it, expect } from "vitest";
import { summarizeEvalRuns } from "../lib/eval-metrics";

const md = "\n- Fraud blocked: **3 / 3**\n- False releases (payment or verification): **0**\n\nThese are results on these 4 scripted cases.\n";

describe("summarizeEvalRuns", () => {
  it("returns null without runs", () => {
    expect(summarizeEvalRuns(undefined)).toBeNull();
    expect(summarizeEvalRuns([{ scenarioId: "__metrics__", metrics: { passed: 0, total: 0 } }])).toBeNull();
  });
  it("counts scenarios once across on/off twins and reads the metrics row", () => {
    const s = summarizeEvalRuns([
      { scenarioId: "__metrics__", metrics: { markdown: md, passed: 3, total: 4 } },
      { scenarioId: "lookalike_1", passed: true },
      { scenarioId: "lookalike_1__off", passed: false, metrics: { extractor_off: true } },
      { scenarioId: "legit_1", passed: true },
      { scenarioId: "misdirection_1", passed: true },
      { scenarioId: "judge:abc", passed: true },
    ]);
    expect(s).toMatchObject({ passed: 3, total: 4, scenarios: 3, onPassed: 3, onTotal: 3, offPassed: 0, offTotal: 1, falseReleases: 0 });
    expect(s?.disclaimer).toMatch(/^These are results/);
  });
});
