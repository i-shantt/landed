#!/usr/bin/env node
// REST API latency benchmark against a deployment. Mints a scoped key through `npx convex run api/keys:insert`
// (the CLI's deployment access, nothing in the browser), warms each route, then measures N sequential requests
// per route and reports p50 / p95 / max wall-clock from this machine. Writes docs/BENCHMARKS.md when --write is given.
// Usage (from web/):  node scripts/bench-api.mjs [--prod] [--n 30] [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().split(" #")[0].trim()]; }));
const PROD = process.argv.includes("--prod");
const nArg = process.argv.indexOf("--n");
const N = nArg > 0 ? Number(process.argv[nArg + 1]) : 30;
const WRITE = process.argv.includes("--write");
const SITE = PROD ? env.PROD_CONVEX_SITE_URL : env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (!SITE) throw new Error("no site URL in .env.local");

// Mint a key: plaintext stays in this process; only its SHA-256 reaches the deployment.
const key = `ld_live_sk_${randomBytes(24).toString("hex")}`;
const keyHash = createHash("sha256").update(key).digest("hex");
const runArgs = ["convex", "run", ...(PROD ? ["--prod"] : []), "api/keys:insert", JSON.stringify({ name: `bench ${new Date().toISOString().slice(0, 16)}`, prefix: key.slice(0, 16), keyHash, scopes: ["read", "write:payments"] })];
execFileSync("npx", runArgs, { stdio: ["ignore", "ignore", "inherit"] });
const H = { authorization: `Bearer ${key}` };

const quantile = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
async function timed(method, path, body, headers = {}) {
  const t0 = performance.now();
  const r = await fetch(`${SITE}${path}`, { method, headers: { ...H, ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  await r.arrayBuffer();
  return { ms: performance.now() - t0, status: r.status };
}

// Discover ids for the parameterised routes.
const vendors = await (await fetch(`${SITE}/api/v1/vendors?limit=5`, { headers: H })).json();
const vendor = vendors.data?.[0];
const cases = await (await fetch(`${SITE}/api/v1/cases?limit=5`, { headers: H })).json();
const kase = cases.data?.[0];
const vendorFull = vendor ? await (await fetch(`${SITE}/api/v1/vendors/${vendor.id}`, { headers: H })).json() : null;
const heldInvoice = vendorFull?.open_invoices?.find((i) => i.status === "held") ?? null;
const invoices = await (await fetch(`${SITE}/api/v1/invoices?limit=50`, { headers: H })).json();
const unverifiedInvoice = heldInvoice ?? invoices.data?.find((i) => i.status === "held") ?? null;

const routes = [
  { label: "GET /ping", method: "GET", path: "/api/v1/ping" },
  { label: "GET /vendors?limit=20", method: "GET", path: "/api/v1/vendors?limit=20" },
  vendor && { label: "GET /vendors/{id}", method: "GET", path: `/api/v1/vendors/${vendor.id}` },
  vendor && { label: "GET /vendors/{id}/trust", method: "GET", path: `/api/v1/vendors/${vendor.id}/trust` },
  { label: "GET /cases?limit=20", method: "GET", path: "/api/v1/cases?limit=20" },
  kase && { label: "GET /cases/{id}", method: "GET", path: `/api/v1/cases/${kase.id}` },
  kase && { label: "GET /cases/{id}/risk", method: "GET", path: `/api/v1/cases/${kase.id}/risk` },
  { label: "GET /invoices?limit=20", method: "GET", path: "/api/v1/invoices?limit=20" },
  { label: "GET /payments?limit=20", method: "GET", path: "/api/v1/payments?limit=20" },
  { label: "GET /events?limit=50", method: "GET", path: "/api/v1/events?limit=50" },
  { label: "GET /risk/trend?window=30d", method: "GET", path: "/api/v1/risk/trend?window=30d" },
  { label: "GET /model/health", method: "GET", path: "/api/v1/model/health" },
  { label: "GET /openapi.json", method: "GET", path: "/api/v1/openapi.json" },
  unverifiedInvoice && { label: "POST /payments (refused 409, unverified destination)", method: "POST", path: "/api/v1/payments", body: { invoice_id: unverifiedInvoice.id }, perCall: () => ({ "idempotency-key": `bench-${randomBytes(8).toString("hex")}` }), expect: 409 },
].filter(Boolean);

console.log(`[bench] ${SITE} n=${N} per route (sequential, from this machine; includes network RTT)`);
const rows = [];
for (const r of routes) {
  await timed(r.method, r.path, r.body, r.perCall?.());
  const samples = []; const statuses = new Set();
  for (let i = 0; i < N; i++) { const s = await timed(r.method, r.path, r.body, r.perCall?.()); samples.push(s.ms); statuses.add(s.status); }
  const row = { label: r.label, status: [...statuses].join("/"), p50: quantile(samples, 0.5), p95: quantile(samples, 0.95), max: Math.max(...samples) };
  rows.push(row);
  console.log(`${row.label.padEnd(54)} ${row.status.padEnd(4)} p50 ${row.p50.toFixed(0).padStart(5)} ms   p95 ${row.p95.toFixed(0).padStart(5)} ms   max ${row.max.toFixed(0).padStart(5)} ms`);
  if (r.expect && !statuses.has(r.expect)) console.log(`   expected ${r.expect}`);
}

// Rate limit: burst past the per-key limit and report when 429 starts.
const burst = [];
for (let i = 0; i < 150; i++) burst.push(timed("GET", "/api/v1/ping"));
const bs = await Promise.all(burst.map((p) => p.catch((e) => ({ ms: 0, status: `error:${e?.cause?.code ?? e?.message ?? "fetch"}` }))));
const hist = {};
for (const b of bs) hist[b.status] = (hist[b.status] ?? 0) + 1;
const histText = Object.entries(hist).sort().map(([k, v]) => `${v} × ${k}`).join(", ");
console.log(`[bench] burst of 150 concurrent /ping on one key: ${histText}`);
if (hist[500]) console.log("   500s under a burst mean the per-key bucket could not be serialised; the API maps that to 429 (apiRoutes.authenticate)");

if (WRITE) {
  const date = new Date().toISOString().slice(0, 10);
  const md = `# API latency

Measured by \`web/scripts/bench-api.mjs\` on ${date} against the ${PROD ? "production" : "cloud dev"} Convex deployment from a laptop
(sequential requests, wall-clock including network round trip, ${N} samples per route after one warm-up call; a key minted for the run with
\`read\` and \`write:payments\` scopes). Numbers move with the network and the deployment's region; the shape is the point: every route
is one Convex query or mutation, and the refused payment is as cheap as a read because the guard runs inside the transaction before any write.

| Route | Status | p50 | p95 | max |
|---|---|---:|---:|---:|
${rows.map((r) => `| \`${r.label}\` | ${r.status} | ${r.p50.toFixed(0)} ms | ${r.p95.toFixed(0)} ms | ${r.max.toFixed(0)} ms |`).join("\n")}

Burst: 150 concurrent \`GET /ping\` on one key returned ${histText}. The limiter is a token bucket per key (${600}/min, \`convex/rateLimit.ts\`);
when a burst exceeds what the bucket document can serialise, the API answers 429 with \`retry_after_ms\` instead of surfacing the write conflict as a 500
(found by the first run of this script, fixed in \`apiRoutes.authenticate\`).

Re-run: \`cd web && node scripts/bench-api.mjs --n ${N} --write\` (add \`--prod\` for production). The script needs the Convex CLI's deployment access to mint the key; the plaintext never leaves the process.
`;
  writeFileSync("../docs/BENCHMARKS.md", md);
  console.log("[bench] wrote docs/BENCHMARKS.md");
}
