#!/usr/bin/env node
// Flakiness run: the compromised-inbox flow N times against a deployment via the eval endpoints,
// resetting between runs. Measures time to case (HELD/PROBE_SENT), time to AWAITING after the clock
// jump, and time to NEEDS_HUMAN after the vendor statement. Usage (from web/):
//   node scripts/soak.mjs [--prod] [--runs 20]
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const PROD = process.argv.includes("--prod");
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) : 20;
const SITE = PROD ? env.PROD_CONVEX_SITE_URL : env.NEXT_PUBLIC_CONVEX_SITE_URL;
const KEY = PROD ? env.PROD_EVAL_KEY : env.EVAL_KEY;
const H = { "x-eval-key": KEY, "content-type": "application/json" };
const post = async (p, b) => (await fetch(`${SITE}${p}`, { method: "POST", headers: H, body: JSON.stringify(b ?? {}) })).json();
const get = async (p) => (await fetch(`${SITE}${p}`, { headers: H })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ATT = { routing: "011000015", accountNumber: "900012345678" };
const results = [];
console.log(`[soak] ${SITE} runs=${RUNS}`);
for (let i = 0; i < RUNS; i++) {
  const r = { i, ok: true, errors: [] };
  try {
    await post("/eval/reset", { which: "full" });
    await post("/eval/setting", { key: "extractorMode", value: "rules" });
    const t0 = Date.now();
    const inj = await post("/eval/inject", { from: "ap@cleanco.example", subject: "Updated banking details", body: `We have changed banks.\nRouting (ABA): ${ATT.routing}\nAccount number: ${ATT.accountNumber}\nThanks, Dana`, dmarc: true });
    let caseId = null;
    for (let k = 0; k < 120 && !caseId; k++) { const m = await get(`/eval/message/${inj.messageId}`); if (m.intakeStatus === "done") caseId = m.intakeResult?.caseId ?? null; if (m.intakeStatus === "error") throw new Error("intake error"); if (!caseId) await sleep(250); }
    if (!caseId) throw new Error("no case");
    r.msToCase = Date.now() - t0;
    const c0 = await get(`/eval/case/${caseId}`);
    r.stateAfterIntake = c0.case.state;
    const pay0 = await post("/eval/pay", { invoiceId: (await get("/eval/vendor/slug/cleanco")).invoices.find((x) => x.status !== "paid")._id });
    if (pay0.ok !== false || pay0.reason !== "destination_not_verified") r.errors.push(`pay0 ${JSON.stringify(pay0)}`);
    const t1 = Date.now();
    const avail = c0.timers.find((t) => t.kind === "probe_available");
    await post("/eval/advanceTo", { at: avail.dueAt + 1000 });
    let c1 = null;
    for (let k = 0; k < 80; k++) { c1 = await get(`/eval/case/${caseId}`); if (c1.case.state === "AWAITING_CONFIRMATION" && c1.events.some((e) => e.type === "sim_voice_waiting")) break; await sleep(250); }
    r.msToAwaiting = Date.now() - t1;
    if (c1.case.state !== "AWAITING_CONFIRMATION") r.errors.push(`state after jump ${c1.case.state}`);
    const t2 = Date.now();
    await post("/eval/vendorStatement", { caseId, statedAmountCents: null, outcome: "nothing_arrived" });
    let c2 = null;
    for (let k = 0; k < 40; k++) { c2 = await get(`/eval/case/${caseId}`); if (c2.case.state === "NEEDS_HUMAN") break; await sleep(200); }
    r.msToNeedsHuman = Date.now() - t2;
    if (c2.case.state !== "NEEDS_HUMAN") r.errors.push(`state after statement ${c2.case.state}`);
    const pay1 = await post("/eval/pay", { invoiceId: (await get("/eval/vendor/slug/cleanco")).invoices.find((x) => x.status !== "paid")._id });
    if (pay1.ok !== false) r.errors.push(`pay1 ${JSON.stringify(pay1)}`);
    r.ok = r.errors.length === 0;
  } catch (e) { r.ok = false; r.errors.push(String(e?.message ?? e)); }
  results.push(r);
  console.log(`[soak] run ${i + 1}/${RUNS} ${r.ok ? "ok" : "FAIL"} case=${r.msToCase ?? "-"}ms awaiting=${r.msToAwaiting ?? "-"}ms needsHuman=${r.msToNeedsHuman ?? "-"}ms ${r.errors.join("; ")}`);
}
const ok = results.filter((r) => r.ok);
const med = (k) => { const xs = results.map((r) => r[k]).filter((x) => typeof x === "number").sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };
const max = (k) => Math.max(...results.map((r) => r[k] ?? 0));
console.log(`[soak] ${ok.length}/${RUNS} ok · to case median ${med("msToCase")} ms max ${max("msToCase")} · to awaiting median ${med("msToAwaiting")} ms max ${max("msToAwaiting")} · to needs-human median ${med("msToNeedsHuman")} ms max ${max("msToNeedsHuman")}`);
if (PROD) await post("/eval/reset", { which: "full", demo: true });
process.exit(ok.length === RUNS ? 0 : 1);
