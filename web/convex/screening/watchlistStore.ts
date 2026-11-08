// Production sanctions list (controls layer, additive). The demo watchlist in watchlist.ts is a constant;
// the loader fetches the real OFAC SDN list from the Treasury's fixed export URLs (watchlistSource.ts),
// versions it by the SHA-256 of SDN.CSV, keeps the parsed list as one JSON blob in Convex file storage
// and points to it from the setting `watchlist:current` (listState.ts). Mutations cannot read file
// storage, so once a list is loaded all screening runs in actions: `refresh` (watchlistFetch.ts, Node
// runtime) re-screens every vendor not yet screened against the loaded version, onboarding and "Screen
// all" schedule one debounced `rescreen`, and policy fails closed (`policy_screening_pending`) for a
// vendor not yet screened against the loaded list. This file holds the isolate side: the queries and
// mutations the actions call, the admin entry point and the status read.
import { action, internalMutation, internalQuery, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { append } from "../events";
import { getSetting, setSetting, deleteSetting } from "../settings";
import { requireActor } from "../controls/actor";
import { DEMO_LIST_VERSION, DEMO_WATCHLIST } from "./watchlist";
import { latestFor, recordResult, type ScreenMatch } from "./screen";
import { CURRENT_KEY, NEXT_RUN_KEY, RESCREEN_KEY, LAST_ERROR_KEY, loadedWatchlist, type LoadedWatchlist } from "./listState";
import { SDN_URL, ALT_URL, REFRESH_EVERY_MS } from "./watchlistSource";

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

/** Admin: load or refresh the OFAC list now. Starts the daily chain unless one is already booked. */
export const refreshNow = action({
  args: {},
  handler: async (ctx): Promise<{ started: true; chained: boolean }> => {
    await ctx.runQuery(internal.controls.actor.resolve, { roles: ["admin"] });
    const next = await ctx.runQuery(internal.screening.watchlistStore.nextRunInternal, {});
    const chained = !next?.pending;
    const scheduledId = await ctx.scheduler.runAfter(0, internal.screening.watchlistFetch.refresh, { reschedule: chained });
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
