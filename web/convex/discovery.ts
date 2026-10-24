"use node";
// Apify onboarding crawl (optional; APIFY_TOKEN). Crawls the vendor's website with
// apify/website-content-crawler, extracts a phone number, and stores it as a
// `discovered` contact (cross-check only; never trusted for release). Without a
// token the action records why it did nothing. Not verified live (no token).
import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export const discoverFromWebsite = action({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }): Promise<{ ok: boolean; reason?: string; phones?: string[] }> => {
    const vendor = await ctx.runQuery(api.vendors.get, { vendorId });
    if (!vendor) return { ok: false, reason: "vendor_not_found" };
    const token = process.env.APIFY_TOKEN;
    if (!token) return { ok: false, reason: "APIFY_TOKEN not set; discovery is disabled" };
    if (vendor.domain.endsWith(".example")) return { ok: false, reason: "fixture domain (.example) is not crawlable" };
    const run = await fetch(`https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?token=${token}&timeout=90&memory=1024`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startUrls: [{ url: `https://${vendor.domain}` }], maxCrawlPages: 5, crawlerType: "cheerio" }),
    });
    if (!run.ok) return { ok: false, reason: `apify ${run.status}: ${(await run.text()).slice(0, 200)}` };
    const items = (await run.json()) as { text?: string }[];
    const text = items.map((i) => i.text ?? "").join("\n");
    const phones = Array.from(new Set(Array.from(text.matchAll(PHONE)).map((m) => "+1" + m[0].replace(/\D/g, "").slice(-10)))).slice(0, 3);
    for (const p of phones) {
      await ctx.runMutation(internal.contacts.addDiscoveredContact, { vendorId, kind: "phone", value: p, source: `apify website-content-crawler https://${vendor.domain}` });
    }
    return { ok: true, phones };
  },
});
