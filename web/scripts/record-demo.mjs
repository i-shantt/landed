#!/usr/bin/env node
// Records the raw demo video and takes the Devpost screenshots against PRODUCTION with Playwright.
// Usage (from web/): node scripts/record-demo.mjs [--base https://landed-blue.vercel.app] [--local]
// Outputs: ../assets/video/landed-raw.webm, ../assets/video/judge-run.webm, ../assets/screenshots/*.png
import { chromium } from "@playwright/test";
import { readFileSync, renameSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const LOCAL = process.argv.includes("--local");
const SHOTS_ONLY = process.argv.includes("--screenshots-only");
const argBase = process.argv.indexOf("--base");
const BASE = argBase > 0 ? process.argv[argBase + 1] : LOCAL ? "http://localhost:3000" : "https://landed-blue.vercel.app";
const SITE = LOCAL ? env.NEXT_PUBLIC_CONVEX_SITE_URL : env.PROD_CONVEX_SITE_URL;
const KEY = LOCAL ? env.EVAL_KEY : env.PROD_EVAL_KEY;
const H = { "x-eval-key": KEY, "content-type": "application/json" };
const post = async (p, b) => (await fetch(`${SITE}${p}`, { method: "POST", headers: H, body: JSON.stringify(b ?? {}) })).json();
const get = async (p) => (await fetch(`${SITE}${p}`, { headers: H })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VID = "../assets/video", SHOT = "../assets/screenshots";
mkdirSync(VID, { recursive: true }); mkdirSync(SHOT, { recursive: true });

console.log(`[record] base=${BASE}`);
const seed = await post("/eval/reset", { which: "full", demo: true });
const demo = seed.demoCases ?? [];
const fraud = demo.find((d) => d.label.startsWith("Fraud"))?.caseId;
const legit = demo.find((d) => d.label.startsWith("Legitimate"))?.caseId;
if (!fraud || !legit) throw new Error("demo cases missing after reset");
const cleanco = (await get("/eval/vendor/slug/cleanco")).vendor._id;

const browser = await chromium.launch();
const t0 = Date.now();
const marks = [];
const mark = (label) => { marks.push([((Date.now() - t0) / 1000).toFixed(1), label]); console.log(`[${marks.at(-1)[0]}s] ${label}`); };

// ---------- Take 1: the continuous demo video ----------
if (!SHOTS_ONLY) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: VID, size: { width: 1280, height: 800 } }, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/cases`, { waitUntil: "networkidle" });
  mark("cases list with demo cases");
  await sleep(2500);
  // The moment: captioned autoplay of the fraud case
  await page.goto(`${BASE}/cases/${fraud}?autoplay=1`, { waitUntil: "networkidle" });
  mark("autoplay fraud case starts");
  await page.waitForFunction(() => /\d+\/\d+ events/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  // wait until all events have played (text "N/N events")
  await page.waitForFunction(() => { const m = document.body.innerText.match(/(\d+)\/(\d+) events/); return m && m[1] === m[2]; }, null, { timeout: 90000 }).catch(() => {});
  mark("autoplay finished");
  await sleep(2000);
  // AI off: clerk edits the account by hand, Pay refused
  await post("/eval/setting", { key: "extractorMode", value: "off" });
  await page.goto(`${BASE}/vendors/${cleanco}`, { waitUntil: "networkidle" });
  mark("vendor page (AI off)");
  await sleep(1500);
  await page.getByRole("button", { name: /edit account/i }).first().click();
  await page.getByLabel(/routing/i).fill("011000015");
  await page.getByLabel(/^account number/i).fill("900012345678");
  await page.getByRole("button", { name: /save new account/i }).click();
  await sleep(2500);
  mark("manual edit saved");
  const ov = await get("/eval/overview");
  const edited = ov.cases.find((c) => c.triggerType === "manual_edit");
  await page.goto(`${BASE}/cases/${edited._id}`, { waitUntil: "networkidle" });
  await sleep(1500);
  await page.getByRole("button", { name: /^pay$/i }).click();
  await sleep(2500);
  mark("Pay refused (AI off)");
  await page.screenshot({ path: `${SHOT}/02-ai-off-pay-refused.png` });
  // The honest case
  await page.goto(`${BASE}/cases/${legit}`, { waitUntil: "networkidle" });
  mark("legitimate case landed");
  await sleep(3000);
  await page.mouse.wheel(0, 600); await sleep(2500);
  // Permissions
  await page.goto(`${BASE}/about#permissions`, { waitUntil: "networkidle" });
  mark("about: what the agent cannot do");
  await sleep(3500);
  await ctx.close();
  mark("take 1 end");
}

// ---------- Screenshots at 1600x1000 (extractor back to claude so the header reads as the demo does) ----------
await post("/eval/setting", { key: "extractorMode", value: "claude" });
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/cases/${fraud}`, { waitUntil: "networkidle" }); await sleep(1500);
  await page.screenshot({ path: `${SHOT}/01-fraud-case-needs-human.png` });
  await page.goto(`${BASE}/cases/${legit}`, { waitUntil: "networkidle" }); await sleep(1500);
  await page.screenshot({ path: `${SHOT}/03-legit-case-landed.png` });
  await page.goto(`${BASE}/about#permissions`, { waitUntil: "networkidle" }); await sleep(1500);
  await page.screenshot({ path: `${SHOT}/05-permissions.png` });
  await page.goto(`${BASE}/cases`, { waitUntil: "networkidle" }); await sleep(1500);
  await page.screenshot({ path: `${SHOT}/00-cases-demo-group.png` });
  await ctx.close();
}

// ---------- Take 2: /judge running a scenario (~20 s) + mid-run screenshot ----------
if (!SHOTS_ONLY) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: VID, size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle" });
  await sleep(1500);
  await page.getByRole("button", { name: /^run$/i }).first().click();
  await sleep(9000);
  await page.screenshot({ path: `${SHOT}/04-judge-mid-run.png` });
  await page.waitForFunction(() => /PASS|FAIL/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {});
  await sleep(2500);
  await ctx.close();
}
await browser.close();

// name the videos: newest two webm files in VID
const vids = SHOTS_ONLY ? [] : readdirSync(VID).filter((f) => f.endsWith(".webm") && !f.startsWith("landed-") && !f.startsWith("judge-")).map((f) => ({ f, t: statSync(`${VID}/${f}`).mtimeMs })).sort((a, b) => a.t - b.t);
if (vids.length >= 2) { renameSync(`${VID}/${vids[0].f}`, `${VID}/landed-raw.webm`); renameSync(`${VID}/${vids[1].f}`, `${VID}/judge-run.webm`); }
else if (vids.length === 1) renameSync(`${VID}/${vids[0].f}`, `${VID}/landed-raw.webm`);
let mp4 = "ffmpeg not found; .webm only";
if (!SHOTS_ONLY) try { execSync("ffmpeg -version", { stdio: "ignore" }); execSync(`ffmpeg -y -i ${VID}/landed-raw.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${VID}/landed-raw.mp4`, { stdio: "ignore", timeout: 10 * 60 * 1000 }); mp4 = "landed-raw.mp4 written"; } catch {}
console.log(`[record] ${mp4}`);
console.log("[record] marks:\n" + marks.map(([t, l]) => `  ${t}s ${l}`).join("\n"));
await post("/eval/setting", { key: "extractorMode", value: "claude" });
await post("/eval/reset", { which: "full", demo: true });
console.log("[record] reseeded with demo cases");
