#!/usr/bin/env node
// Exports /pitch to ../assets/pitch.pdf with Playwright (one slide per page via the print stylesheet).
// Usage (from web/): node scripts/pitch-pdf.mjs [--base http://localhost:3000]
import { chromium } from "@playwright/test";
const argBase = process.argv.indexOf("--base");
const BASE = argBase > 0 ? process.argv[argBase + 1] : "https://landed-blue.vercel.app";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${BASE}/pitch`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.emulateMedia({ media: "print" });
await page.pdf({ path: "../assets/pitch.pdf", width: "1280px", height: "800px", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
await browser.close();
console.log("[pitch-pdf] wrote ../assets/pitch.pdf");
