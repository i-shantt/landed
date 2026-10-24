#!/usr/bin/env node
// Mirrors server-side keys from web/.env.local into a Convex deployment env.
// Usage (from web/):
//   node scripts/sync-env.mjs            # dev deployment
//   node scripts/sync-env.mjs --prod     # production deployment
//   add --generate to create random ACCOUNT_HMAC_KEY / ACCOUNT_ENC_KEY / EVAL_KEY when the
//   target has none (prod values are recorded in .env.local as PROD_* so scripts can reach prod).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const PROD = process.argv.includes("--prod");
const GENERATE = process.argv.includes("--generate");
const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ACCOUNT_HMAC_KEY", "ACCOUNT_ENC_KEY", "EVAL_KEY", "RAIL", "VOICE", "NESSIE_KEY", "VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "CARTESIA_VOICE_ID", "TEST_PHONE_NUMBERS", "APIFY_TOKEN"];

if (!existsSync(".env.local")) {
  console.log("[sync-env] no .env.local; nothing to sync");
  process.exit(0);
}
let raw = readFileSync(".env.local", "utf8");
const env = Object.fromEntries(
  raw.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\s+#.*$/, "")];
  })
);
const flag = PROD ? "--prod" : "";
const existing = execSync(`npx convex env list ${flag}`, { encoding: "utf8" }).split("\n").map((l) => l.trim()).filter(Boolean);
const has = (k) => existing.some((l) => l === k || l.startsWith(`${k}=`));
const set = (k, v) => execSync(`npx convex env set ${flag} ${k} ${JSON.stringify(v)}`, { stdio: "ignore" });

const prefix = PROD ? "PROD_" : "";
let synced = 0;
for (const k of KEYS) {
  let v = env[k];
  // Secrets that differ per deployment: for prod, prefer PROD_<KEY> from .env.local.
  if (["ACCOUNT_HMAC_KEY", "ACCOUNT_ENC_KEY", "EVAL_KEY"].includes(k)) {
    v = env[`${prefix}${k}`];
    if (!v && GENERATE && !has(k)) {
      v = k === "EVAL_KEY" ? randomBytes(16).toString("hex") : randomBytes(32).toString("base64");
      raw += `\n${prefix}${k}=${v}`;
      console.log(`[sync-env] generated ${prefix}${k} (recorded in .env.local)`);
    }
  }
  if (!v) continue;
  set(k, v);
  console.log(`[sync-env] set ${k}${PROD ? " (prod)" : ""}`);
  synced++;
}
if (!has("ANTHROPIC_MODEL")) { set("ANTHROPIC_MODEL", "claude-sonnet-5-5"); console.log("[sync-env] set ANTHROPIC_MODEL default"); }
if (!has("RAIL")) set("RAIL", "sim");
if (!has("VOICE")) set("VOICE", "sim");
writeFileSync(".env.local", raw.endsWith("\n") ? raw : raw + "\n");
console.log(`[sync-env] synced ${synced} key(s)`);
