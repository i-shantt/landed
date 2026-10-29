#!/usr/bin/env node
// Re-seeds the PRODUCTION deployment (POST /eval/reset) using PROD_EVAL_KEY from web/.env.local, then makes
// sure the operators and the two public demo sign-in accounts exist (auth tables survive the reseed).
// Usage (from web/): node scripts/prod-seed.mjs [--site https://xxx.convex.site]
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const argSite = process.argv.indexOf("--site");
const site = argSite > 0 ? process.argv[argSite + 1] : env.PROD_CONVEX_SITE_URL;
if (!site || !env.PROD_EVAL_KEY) { console.error("need PROD_CONVEX_SITE_URL and PROD_EVAL_KEY in .env.local"); process.exit(1); }
const r = await fetch(`${site}/eval/reset`, { method: "POST", headers: { "x-eval-key": env.PROD_EVAL_KEY, "content-type": "application/json" }, body: JSON.stringify({ which: "full", demo: true }) });
const j = await r.json();
console.log(`[prod-seed] ${site} -> ok=${j.ok} vendors=${Object.keys(j.vendors ?? {}).length} demoCases=${(j.demoCases ?? []).length}`);
const operators = execFileSync("npx", ["convex", "run", "--prod", "controls/operators:ensureSeeded"], { encoding: "utf8" }).trim();
console.log(`[prod-seed] operators: ${operators}`);
const demo = execFileSync("npx", ["convex", "run", "--prod", "authSetup:ensureDemoAccounts"], { encoding: "utf8" }).trim();
console.log(`[prod-seed] demo sign-in accounts: ${demo}`);
const unauth = await fetch(`${site}/eval/tick`, { method: "POST" });
console.log(`[prod-seed] unauthenticated /eval/tick -> ${unauth.status} (expect 401)`);
