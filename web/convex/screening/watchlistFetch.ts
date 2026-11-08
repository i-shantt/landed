"use node";
// The heavy half of the sanctions-list loader runs in the Node runtime: the real SDN.CSV is tens of
// megabytes and the default isolate's 64 MB would not hold the text, the parsed rows and the JSON blob
// at once. Everything that touches the database stays in watchlistStore.ts (isolate functions) and is
// reached through ctx.runQuery / ctx.runMutation; the URLs, cap and parsers are in watchlistSource.ts.
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import type { WatchlistEntry } from "./watchlist";
import { screenName } from "./screen";
import { SDN_URL, ALT_URL, REFRESH_EVERY_MS, sha256Hex, fetchExport, parseExports } from "./watchlistSource";

const BATCH = 25;

const errorText = (e: unknown) => (e instanceof ConvexError ? String(e.data) : String((e as Error)?.message ?? e)).slice(0, 300);

async function loadList(ctx: ActionCtx, storageId: Id<"_storage">): Promise<WatchlistEntry[]> {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new ConvexError("watchlist_blob_missing");
  return JSON.parse(await blob.text()) as WatchlistEntry[];
}

/** Score every vendor not yet screened against `version` in the action, record in batches of one mutation. */
async function screenVendorsWith(ctx: ActionCtx, list: WatchlistEntry[], version: string): Promise<{ screened: number; potentialMatches: number }> {
  const vendors = await ctx.runQuery(internal.screening.watchlistStore.vendorsToScreen, { version });
  let potentialMatches = 0;
  for (let i = 0; i < vendors.length; i += BATCH) {
    const chunk = vendors.slice(i, i + BATCH).map((vnd) => ({ vendorId: vnd._id, result: screenName(vnd.name, { list, listVersion: version }) }));
    const r = await ctx.runMutation(internal.screening.watchlistStore.recordMany, { results: chunk });
    potentialMatches += r.potentialMatches;
  }
  return { screened: vendors.length, potentialMatches };
}

async function scheduleNext(ctx: ActionCtx): Promise<number> {
  const at = Date.now() + REFRESH_EVERY_MS;
  const scheduledId = await ctx.scheduler.runAfter(REFRESH_EVERY_MS, internal.screening.watchlistFetch.refresh, { reschedule: true });
  await ctx.runMutation(internal.screening.watchlistStore.setNextRun, { scheduledId, at });
  return at;
}

/**
 * Fetch, version, store, re-screen. Idempotent on the published SHA-256: an unchanged list stores nothing
 * and only screens vendors added since. With `reschedule` the action books itself again in a day.
 */
export const refresh = internalAction({
  args: { reschedule: v.optional(v.boolean()) },
  handler: async (ctx, { reschedule }): Promise<{ version: string; changed: boolean; entries: number; screened: number; potentialMatches: number; nextRunAt: number | null }> => {
    let parsed: { list: WatchlistEntry[]; names: number };
    let version: string;
    let bytes: number;
    try {
      const [sdnText, altText] = await Promise.all([fetchExport(SDN_URL), fetchExport(ALT_URL)]);
      version = await sha256Hex(sdnText);
      parsed = parseExports(sdnText, altText);
      bytes = sdnText.length + altText.length;
    } catch (e) {
      await ctx.runMutation(internal.screening.watchlistStore.recordFailure, { error: errorText(e) });
      if (reschedule) await scheduleNext(ctx);
      throw e;
    }
    const current = await ctx.runQuery(internal.screening.watchlistStore.currentInternal, {});
    const changed = !current || current.version !== version;
    if (changed) {
      const storageId = await ctx.storage.store(new Blob([JSON.stringify(parsed.list)], { type: "application/json" }));
      await ctx.runMutation(internal.screening.watchlistStore.setCurrent, { storageId, version, entries: parsed.list.length, names: parsed.names, bytes, source: "ofac" });
      if (current) {
        try {
          await ctx.storage.delete(current.storageId);
        } catch {
          /* already gone */
        }
      }
    }
    if (!changed) await ctx.runMutation(internal.screening.watchlistStore.clearLastError, {});
    const { screened, potentialMatches } = await screenVendorsWith(ctx, parsed.list, version);
    const nextRunAt = reschedule ? await scheduleNext(ctx) : null;
    console.log(`[watchlist] ${changed ? "loaded" : "unchanged"} ${version.slice(0, 12)} entries=${parsed.list.length} screened=${screened} hits=${potentialMatches}`);
    return { version, changed, entries: parsed.list.length, screened, potentialMatches, nextRunAt };
  },
});

/** Screen the vendors not yet screened against the loaded list (scheduled by onboarding and "Screen all"; see screen.scheduleRescreen). */
export const rescreen = internalAction({
  args: {},
  handler: async (ctx): Promise<{ screened: number; potentialMatches: number } | null> => {
    await ctx.runMutation(internal.screening.watchlistStore.clearRescreenFlag, {});
    const current = await ctx.runQuery(internal.screening.watchlistStore.currentInternal, {});
    if (!current) return null;
    const list = await loadList(ctx, current.storageId);
    return screenVendorsWith(ctx, list, current.version);
  },
});
