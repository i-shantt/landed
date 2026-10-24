#!/usr/bin/env node
// Mirrors server-side keys from web/.env.local into the Convex deployment env.
// Usage: node scripts/sync-env.mjs   (run from web/)
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ACCOUNT_HMAC_KEY", "ACCOUNT_ENC_KEY", "EVAL_KEY", "RAIL", "VOICE", "NESSIE_KEY", "VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "CARTESIA_VOICE_ID", "TEST_PHONE_NUMBERS", "APIFY_TOKEN"];

if (!existsSync(".env.local")) {
  console.log("[sync-env] no .env.local; nothing to sync");
  process.exit(0);
}
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\s+#.*$/, "")];
    })
);
let synced = 0;
for (const k of KEYS) {
  const v = env[k];
  if (!v) continue;
  execSync(`npx convex env set ${k} ${JSON.stringify(v)}`, { stdio: "ignore" });
  console.log(`[sync-env] set ${k}`);
  synced++;
}
console.log(`[sync-env] synced ${synced} key(s)`);
