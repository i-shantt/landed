#!/usr/bin/env node
// Single source for the "measured" numbers quoted in README.md, DEVPOST.md and docs/CASE_STUDY.md.
// Reads eval/results.json (written by eval/runner.py, the same data the /eval page shows) and the
// vitest test count, renders the two paragraphs, and writes them between the
// <!-- measured:start --> / <!-- measured:end --> markers. `--check` only verifies and exits 1 on drift
// (scripts/verify.sh runs it). `--tests N` skips running vitest.
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const testsArg = args.indexOf("--tests");

const results = JSON.parse(readFileSync(join(root, "eval", "results.json"), "utf8"));
const FRAUD = new Set(["compromised_inbox", "lookalike", "misdirection"]);
const off = (r) => Boolean(r.metrics?.extractor_off);
const fraud = results.filter((r) => FRAUD.has(r.family) && !off(r));
const fraudOff = results.filter((r) => FRAUD.has(r.family) && off(r));
const legit = results.filter((r) => r.family === "legit" && !off(r));
const blocked = fraud.filter((r) => (r.actual.payments_to_new_destination ?? 0) === 0 && r.actual.payments_created === (r.expected.payments_created ?? 0));
const blockedOff = fraudOff.filter((r) => (r.actual.payments_to_new_destination ?? 0) === 0);
const falseReleases = [...fraud, ...fraudOff].filter((r) => (r.actual.payments_to_new_destination ?? 0) > 0 || (r.actual.account_status === "verified" && r.actual.final_state !== null && r.family !== "legit" && r.expected.final_state !== "VERIFIED"));
const legitOk = legit.filter((r) => (r.actual.payments_landed ?? 0) >= 1 && r.metrics.human_actions === 0);
const missed = fraud.filter((r) => r.failures.join(" ").includes("missed_extraction") || (r.actual.final_state === null && r.family !== "misdirection"));
const holds = results.map((r) => r.metrics?.time_to_hold_ms).filter((x) => typeof x === "number").sort((a, b) => a - b);
// Wall-clock medians jitter by a few ms between runs; round to the nearest 50 ms so the gate's
// drift check compares the measurement, not network noise.
const rawMedian = holds.length ? holds[Math.floor(holds.length / 2)] : null;
const holdMedian = rawMedian === null ? null : Math.round(rawMedian / 50) * 50;
const scenarios = new Set(results.map((r) => r.scenarioId.replace(/__off$/, ""))).size;
const runs = results.length;
const offRuns = results.filter(off).length;
const passed = results.filter((r) => r.passed).length;
const families = [...new Set(results.map((r) => r.family))];

let tests;
if (testsArg !== -1) tests = Number(args[testsArg + 1]);
else {
  const out = join(mkdtempSync(join(tmpdir(), "landed-vitest-")), "vitest.json");
  execSync(`npx vitest run --reporter=json --outputFile=${out}`, { cwd: web, stdio: "ignore" });
  tests = JSON.parse(readFileSync(out, "utf8")).numTotalTests;
}
if (!Number.isFinite(tests) || tests <= 0) throw new Error("could not determine the vitest test count");

const famLabel = { compromised_inbox: "compromised inbox", lookalike: "lookalike sender", misdirection: "misdirection", legit: "legitimate change", recovery: "recovery", judge: "judge-style cases", paymentrun: "payment run" };
const famList = families.map((f) => famLabel[f] ?? f).join(", ").replace(/, ([^,]*)$/, " and $1");

const readmeText = `From \`eval/RESULTS.md\` (${runs} scripted runs over ${scenarios} scenarios, ${offRuns} of them with the extractor off; ${passed}/${runs} passed): fraud and misdirection scenarios blocked before payment ${blocked.length}/${fraud.length}; blocked with the extractor off ${blockedOff.length}/${fraudOff.length}; false releases ${falseReleases.length}; legitimate changes landed with zero human actions other than Pay ${legitOk.length}/${legit.length}; missed instruction changes by the extractor ${missed.length}; time to hold median about ${holdMedian} ms wall-clock; ${tests} unit and invariant tests (convex-test). This paragraph is generated from \`eval/results.json\` by \`web/scripts/sync-measured.mjs\`; the gate fails if it drifts from the data the Eval page shows.`;
const devpostText = `${tests} unit and invariant tests (convex-test), a scripted click-through of the dashboard, and an eval of ${scenarios} scenarios across ${famList}, run with the extractor on and off (${runs} runs): ${blocked.length}/${fraud.length} fraud and misdirection scenarios blocked before payment, ${blockedOff.length}/${fraudOff.length} blocked with the extractor off, ${falseReleases.length} false releases, ${legitOk.length}/${legit.length} legitimate changes landed with no human action other than Pay.`;

const START = "<!-- measured:start -->", END = "<!-- measured:end -->";
let drift = false;
for (const [file, text] of [["README.md", readmeText], ["DEVPOST.md", devpostText], ["docs/CASE_STUDY.md", readmeText]]) {
  const p = join(root, file);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, "utf8");
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error(`${file}: measured markers missing`);
  const next = src.slice(0, a + START.length) + text + src.slice(b);
  if (next !== src) {
    drift = true;
    if (check) console.error(`${file}: measured numbers are stale; run node web/scripts/sync-measured.mjs`);
    else { writeFileSync(p, next); console.log(`${file}: measured paragraph updated`); }
  } else console.log(`${file}: measured paragraph current`);
}
console.log(`tests=${tests} scenarios=${scenarios} runs=${runs} passed=${passed} blocked=${blocked.length}/${fraud.length} off=${blockedOff.length}/${fraudOff.length} falseReleases=${falseReleases.length} legit=${legitOk.length}/${legit.length}`);
if (check && drift) process.exit(1);
