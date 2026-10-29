#!/usr/bin/env node
// Mirrors server-side keys from web/.env.local into a Convex deployment env.
// Usage (from web/):
//   node scripts/sync-env.mjs            # dev deployment
//   node scripts/sync-env.mjs --prod     # production deployment
//   add --generate to create random ACCOUNT_HMAC_KEY / ACCOUNT_ENC_KEY / EVAL_KEY and the Convex Auth
//   signing keys (JWT_PRIVATE_KEY RS256 PKCS8 + JWKS) when the target has none (prod values are recorded
//   in .env.local as PROD_* so scripts can reach prod; dev and prod never share a signing key).
//   SITE_URL (Convex Auth redirects) is http://localhost:3000 for dev and SITE_URL_PROD from .env.local
//   (default https://landed-blue.vercel.app) for prod.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const PROD = process.argv.includes("--prod");
const GENERATE = process.argv.includes("--generate");
// EVAL_PROBE_AMOUNT_ENDPOINT is dev-only (enables the test-only probe-amount endpoint) and is never copied to prod.
const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ACCOUNT_HMAC_KEY", "ACCOUNT_ENC_KEY", "EVAL_KEY", "RAIL", "VOICE", "NESSIE_KEY", "VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "CARTESIA_VOICE_ID", "TEST_PHONE_NUMBERS", "APIFY_TOKEN", "VAPI_WEBHOOK_SECRET"];

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
// No shell: PEM text has spaces and starts with "-", JWKS is JSON. "--" ends option parsing.
const set = (k, v) => execFileSync("npx", ["convex", "env", "set", ...(PROD ? ["--prod"] : []), "--", k, v], { stdio: "ignore" });

async function generateAuthKeys() {
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKey = await exportPKCS8(keys.privateKey);
  const publicKey = await exportJWK(keys.publicKey);
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });
  return { privateKey: privateKey.trimEnd().replace(/\n/g, " "), jwks };
}

const prefix = PROD ? "PROD_" : "";
let synced = 0;
if (!PROD && env.EVAL_PROBE_AMOUNT_ENDPOINT === "1") { set("EVAL_PROBE_AMOUNT_ENDPOINT", "1"); console.log("[sync-env] set EVAL_PROBE_AMOUNT_ENDPOINT (dev only)"); }
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
// Convex Auth (email + password sessions): site URL and the JWT signing key pair, per deployment.
const siteUrl = PROD ? env.SITE_URL_PROD || "https://landed-blue.vercel.app" : "http://localhost:3000";
set("SITE_URL", siteUrl);
console.log(`[sync-env] set SITE_URL=${siteUrl}${PROD ? " (prod)" : ""}`);
let jwtKey = env[`${prefix}JWT_PRIVATE_KEY`];
let jwks = env[`${prefix}JWKS`];
if ((!jwtKey || !jwks) && GENERATE && !(has("JWT_PRIVATE_KEY") && has("JWKS"))) {
  const g = await generateAuthKeys();
  jwtKey = g.privateKey;
  jwks = g.jwks;
  raw += `\n${prefix}JWT_PRIVATE_KEY=${jwtKey}\n${prefix}JWKS=${jwks}`;
  console.log(`[sync-env] generated ${prefix}JWT_PRIVATE_KEY and ${prefix}JWKS (recorded in .env.local)`);
}
if (jwtKey && jwks) {
  set("JWT_PRIVATE_KEY", jwtKey);
  set("JWKS", jwks);
  console.log(`[sync-env] set JWT_PRIVATE_KEY and JWKS${PROD ? " (prod)" : ""}`);
  synced += 2;
} else if (!(has("JWT_PRIVATE_KEY") && has("JWKS"))) {
  console.log("[sync-env] WARNING: no JWT_PRIVATE_KEY/JWKS on the target and none in .env.local; sign-in will fail. Re-run with --generate.");
}
if (!has("ANTHROPIC_MODEL")) { set("ANTHROPIC_MODEL", "claude-sonnet-5-5"); console.log("[sync-env] set ANTHROPIC_MODEL default"); }
if (!has("RAIL")) set("RAIL", "sim");
if (!has("VOICE")) set("VOICE", "sim");
writeFileSync(".env.local", raw.endsWith("\n") ? raw : raw + "\n");
console.log(`[sync-env] synced ${synced} key(s)`);
