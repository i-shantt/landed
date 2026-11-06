#!/usr/bin/env node
// Export operator dispositions joined with the send-time feature vector (GET /api/v1/model/labels) as JSONL for
// ml/feedback.py. Mints a read-only key through the Convex CLI's deployment access; the plaintext never leaves this process.
// Usage (from web/):  node scripts/export-labels.mjs [--prod] [--out ../ml/data/feedback/labels.jsonl]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().split(" #")[0].trim()]; }));
const PROD = process.argv.includes("--prod");
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? process.argv[outArg + 1] : `../ml/data/feedback/labels-${PROD ? "prod" : "dev"}.jsonl`;
const SITE = PROD ? env.PROD_CONVEX_SITE_URL : env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (!SITE) throw new Error("no site URL in .env.local");

const key = `ld_live_sk_${randomBytes(24).toString("hex")}`;
const keyHash = createHash("sha256").update(key).digest("hex");
execFileSync("npx", ["convex", "run", ...(PROD ? ["--prod"] : []), "api/keys:insert", JSON.stringify({ name: `labels export ${new Date().toISOString().slice(0, 16)}`, prefix: key.slice(0, 16), keyHash, scopes: ["read"] })], { stdio: ["ignore", "ignore", "inherit"] });

const r = await fetch(`${SITE}/api/v1/model/labels`, { headers: { authorization: `Bearer ${key}` } });
if (!r.ok) throw new Error(`GET /api/v1/model/labels -> ${r.status}`);
const body = await r.json();
mkdirSync(dirname(OUT), { recursive: true });
const lines = body.data.map((row) => JSON.stringify({ ...row, feature_names: undefined }));
writeFileSync(OUT, [JSON.stringify({ object: "header", as_of: body.as_of, source: SITE, feature_names: body.feature_names, summary: body.summary }), ...lines].join("\n") + "\n");
const s = body.summary;
console.log(`[labels] ${SITE} as of ${body.as_of}: ${s.labelled} labelled (${s.positives} suspicious, ${s.negatives} benign), ${s.pending} pending; by source ${JSON.stringify(s.bySource ?? s.by_source)}`);
console.log(`[labels] wrote ${OUT} (${lines.length} rows + header). Next: cd ml && .venv/bin/python -I feedback.py ${OUT.replace(/^\.\.\/ml\//, "")}`);
