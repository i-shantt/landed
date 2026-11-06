// Production sanctions list (controls layer, additive). The demo watchlist in watchlist.ts is a constant;
// this module loads the real OFAC SDN list from the Treasury's fixed export URLs, versions it by the
// SHA-256 of SDN.CSV, keeps the parsed list as one JSON blob in Convex file storage and points to it from
// the setting `watchlist:current` (listState.ts). Mutations cannot read file storage, so once a list is
// loaded all screening runs in the actions here: `refresh` re-screens every vendor not yet screened
// against the loaded version, onboarding and "Screen all" schedule one debounced `rescreen`, and policy
// fails closed (`policy_screening_pending`) for a vendor that has not been screened against the loaded
// list yet. The only outbound requests are to the two fixed URLs below; no user input reaches them, and a
// response over MAX_BYTES or one that parses to nothing is refused and leaves the current list untouched.
import { action, internalAction, internalMutation, internalQuery, query } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import { append } from "../events";
import { getSetting, setSetting, deleteSetting } from "../settings";
import { requireActor } from "../controls/actor";
import { parseSdnCsv, parseAltCsv, buildWatchlist, DEMO_LIST_VERSION, DEMO_WATCHLIST, type WatchlistEntry } from "./watchlist";
import { screenName, latestFor, recordResult, type ScreenMatch } from "./screen";
import { CURRENT_KEY, NEXT_RUN_KEY, RESCREEN_KEY, LAST_ERROR_KEY, loadedWatchlist, type LoadedWatchlist } from "./listState";

export const OFAC_EXPORTS = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
export const SDN_URL = `${OFAC_EXPORTS}SDN.CSV`;
export const ALT_URL = `${OFAC_EXPORTS}ALT.CSV`;
export const MAX_BYTES = 64 * 1024 * 1024;
export const REFRESH_EVERY_MS = 24 * 3600_000;
const BATCH = 25;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One export: fixed URL, follows the Treasury's redirect to the signed object, refuses anything over MAX_BYTES or empty. */
export async function fetchExport(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow", headers: { accept: "text/csv, text/plain;q=0.9, */*;q=0.1" } });
  if (!res.ok) throw new ConvexError(`watchlist_fetch_failed:${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new ConvexError("watchlist_too_large");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new ConvexError("watchlist_too_large");
  if (buf.byteLength === 0) throw new ConvexError("watchlist_empty");
  return new TextDecoder("utf-8").decode(buf);
}

/** Pure: the two exports in the matcher's shape. Throws when nothing parses (an error page, a captcha, an empty file). */
export function parseExports(sdnText: string, altText: string): { list: WatchlistEntry[]; names: number } {
  const list = buildWatchlist(parseSdnCsv(sdnText), parseAltCsv(altText));
  if (list.length === 0) throw new ConvexError("watchlist_parse_empty");
  return { list, names: list.reduce((n, e) => n + 1 + e.aliases.length, 0) };
}

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
  const scheduledId = await ctx.scheduler.runAfter(REFRESH_EVERY_MS, internal.screening.watchlistStore.refresh, { reschedule: true });
  await ctx.runMutation(internal.screening.watchlistStore.setNextRun, { scheduledId, at });
  return at;
}

// ---- internal plumbing ----

export const vendorsToScreen = internalQuery({
  args: { version: v.string() },
  handler: async (ctx, { version }): Promise<{ _id: Id<"vendors">; name: string }[]> => {
    const out: { _id: Id<"vendors">; name: string }[] = [];
    for (const vnd of await ctx.db.query("vendors").collect()) {
      const latest = await latestFor(ctx, vnd._id);
      if (latest && latest.listVersion === version && latest.subject === vnd.name) continue;
      out.push({ _id: vnd._id, name: vnd.name });
    }
    return out;
  },
});

const resultV = v.object({
  subject: v.string(),
  listVersion: v.string(),
  status: v.union(v.literal("clear"), v.literal("potential_match")),
  strong: v.boolean(),
  matches: v.array(v.object({ entry: v.string(), program: v.string(), score: v.number(), method: v.string() })),
});

export const recordMany = internalMutation({
  args: { results: v.array(v.object({ vendorId: v.id("vendors"), result: resultV })) },
  handler: async (ctx, { results }): Promise<{ inserted: number; potentialMatches: number }> => {
    let inserted = 0;
    let potentialMatches = 0;
    for (const { vendorId, result } of results) {
      const r = await recordResult(ctx, vendorId, { ...result, matches: result.matches as ScreenMatch[] });
      if (r.inserted) inserted++;
      if (r.status === "potential_match" || r.status === "confirmed_match") potentialMatches++;
    }
    return { inserted, potentialMatches };
  },
});

export const currentInternal = internalQuery({ args: {}, handler: async (ctx): Promise<LoadedWatchlist | null> => loadedWatchlist(ctx) });

export const setCurrent = internalMutation({
  args: { storageId: v.id("_storage"), version: v.string(), entries: v.number(), names: v.number(), bytes: v.number(), source: v.string() },
  handler: async (ctx, a): Promise<void> => {
    const previous = await loadedWatchlist(ctx);
    const current: LoadedWatchlist = { ...a, loadedAt: Date.now() };
    await setSetting(ctx, CURRENT_KEY, JSON.stringify(current));
    await deleteSetting(ctx, LAST_ERROR_KEY);
    await append(ctx, { actor: "system", type: "watchlist_loaded", payload: { version: a.version, previousVersion: previous?.version ?? null, entries: a.entries, names: a.names, bytes: a.bytes, source: a.source } });
  },
});

export const recordFailure = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }): Promise<void> => {
    await setSetting(ctx, LAST_ERROR_KEY, JSON.stringify({ at: Date.now(), error }));
    await append(ctx, { actor: "system", type: "watchlist_refresh_failed", payload: { error } });
  },
});

export const setNextRun = internalMutation({
  args: { scheduledId: v.id("_scheduled_functions"), at: v.number() },
  handler: async (ctx, a): Promise<void> => {
    await setSetting(ctx, NEXT_RUN_KEY, JSON.stringify(a));
  },
});

export const clearRescreenFlag = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    await deleteSetting(ctx, RESCREEN_KEY);
  },
});

export const noteRefreshRequested = internalMutation({
  args: { chained: v.boolean() },
  handler: async (ctx, { chained }): Promise<void> => {
    // The session identity propagates through ctx.runMutation; the admin is resolved here, never passed in.
    const op = await requireActor(ctx, ["admin"]);
    await append(ctx, { actor: "human", type: "watchlist_refresh_requested", payload: { requestedBy: op.name, operatorId: op._id, startsDailyRefresh: chained } });
  },
});

export const clearLastError = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    await deleteSetting(ctx, LAST_ERROR_KEY);
  },
});

async function nextRun(ctx: { db: { system: { get: (id: Id<"_scheduled_functions">) => Promise<{ state: { kind: string } } | null> } } } & Parameters<typeof getSetting>[0]): Promise<{ scheduledId: Id<"_scheduled_functions">; at: number; pending: boolean } | null> {
  const raw = await getSetting(ctx, NEXT_RUN_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { scheduledId: Id<"_scheduled_functions">; at: number };
    const job = await ctx.db.system.get(p.scheduledId);
    return { ...p, pending: job?.state.kind === "pending" };
  } catch {
    return null;
  }
}

export const nextRunInternal = internalQuery({ args: {}, handler: async (ctx): Promise<{ scheduledId: Id<"_scheduled_functions">; at: number; pending: boolean } | null> => nextRun(ctx) });

// ---- the work ----

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

/** Admin: load or refresh the OFAC list now. Starts the daily chain unless one is already booked. */
export const refreshNow = action({
  args: {},
  handler: async (ctx): Promise<{ started: true; chained: boolean }> => {
    await ctx.runQuery(internal.controls.actor.resolve, { roles: ["admin"] });
    const next = await ctx.runQuery(internal.screening.watchlistStore.nextRunInternal, {});
    const chained = !next?.pending;
    const scheduledId = await ctx.scheduler.runAfter(0, internal.screening.watchlistStore.refresh, { reschedule: chained });
    if (chained) await ctx.runMutation(internal.screening.watchlistStore.setNextRun, { scheduledId, at: Date.now() });
    await ctx.runMutation(internal.screening.watchlistStore.noteRefreshRequested, { chained });
    return { started: true, chained };
  },
});

/** Which list is in force, when it was loaded, when it refreshes next, and the last failure if any. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx);
    const loaded = await loadedWatchlist(ctx);
    const next = await nextRun(ctx);
    const errRaw = await getSetting(ctx, LAST_ERROR_KEY);
    return {
      loaded,
      nextRunAt: next?.pending ? next.at : null,
      lastError: errRaw ? (JSON.parse(errRaw) as { at: number; error: string }) : null,
      rescreenPending: (await getSetting(ctx, RESCREEN_KEY)) !== null,
      demo: { version: DEMO_LIST_VERSION, entries: DEMO_WATCHLIST.length },
      refreshEveryMs: REFRESH_EVERY_MS,
      sources: [SDN_URL, ALT_URL],
    };
  },
});
