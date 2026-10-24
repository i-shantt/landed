#!/usr/bin/env node
// Track-audit helper: routes one probe through the Nessie rail on PRODUCTION, prints the rail ref,
// then restores rail=sim and re-seeds. Uses PROD_* values from web/.env.local.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const site = env.PROD_CONVEX_SITE_URL; const H = { "x-eval-key": env.PROD_EVAL_KEY, "content-type": "application/json" };
const post = async (p, b) => (await fetch(`${site}${p}`, { method: "POST", headers: H, body: JSON.stringify(b ?? {}) })).json();
const get = async (p) => (await fetch(`${site}${p}`, { headers: H })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = await post("/eval/reset", { which: "full" });
await post("/eval/setting", { key: "rail", value: "nessie" });
const r = await post("/eval/manualEdit", { vendorId: ids.vendors.cleanco, routing: "031000503", accountNumber: "55501234567" });
await sleep(8000);
const c = await get(`/eval/case/${r.caseId}`);
console.log("probe railRef:", c.probe?.railRef, "| events:", c.events.filter((e) => e.type.includes("rail")).map((e) => `${e.type}:${e.payload.rail ?? e.payload.error ?? ""}`).join(", "));
const ov = await get("/eval/overview");
console.log("nessie ids:", Object.fromEntries(Object.entries(ov.settings).filter(([k]) => k.startsWith("nessie:"))));
await post("/eval/setting", { key: "rail", value: "sim" });
await post("/eval/reset", { which: "full" });
console.log("restored rail=sim and reseeded prod");
