// Application clock. All case timing reads `now(ctx)`; nothing uses wall-clock delays.
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { runTick } from "./timers";
import { assertDemoControls } from "./controls/demoGuard";

export const NY = "America/New_York";
export const DEFAULT_RECEIVER_TZ = "America/Los_Angeles";
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export async function now(ctx: QueryCtx | MutationCtx): Promise<number> {
  const row = await ctx.db.query("clock").first();
  if (!row || row.mode === "live") return Date.now();
  return Date.now() + row.offsetMs;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("clock").first();
    const t = await now(ctx);
    return { mode: row?.mode ?? "live", offsetMs: row?.offsetMs ?? 0, now: t };
  },
});

export async function advanceBy(ctx: MutationCtx, ms: number) {
  let row = await ctx.db.query("clock").first();
  if (!row) {
    const id = await ctx.db.insert("clock", { mode: "demo", offsetMs: 0 });
    row = (await ctx.db.get(id))!;
  }
  await ctx.db.patch(row._id, { offsetMs: row.offsetMs + ms, mode: "demo" });
  const fired = await runTick(ctx);
  return { now: await now(ctx), fired };
}

export const advance = mutation({
  args: { ms: v.number() },
  handler: async (ctx, { ms }) => {
    await assertDemoControls(ctx);
    if (!Number.isFinite(ms)) throw new Error("ms must be finite");
    return advanceBy(ctx, ms);
  },
});

/** Advance the demo clock to an absolute instant (no-op if already past). */
export const advanceTo = mutation({
  args: { at: v.number() },
  handler: async (ctx, { at }) => {
    await assertDemoControls(ctx);
    if (!Number.isFinite(at)) throw new Error("at must be finite");
    const t = await now(ctx);
    return advanceBy(ctx, Math.max(0, at - t));
  },
});

export const setMode = mutation({
  args: { mode: v.union(v.literal("live"), v.literal("demo")) },
  handler: async (ctx, { mode }) => {
    await assertDemoControls(ctx);
    const row = await ctx.db.query("clock").first();
    if (!row) await ctx.db.insert("clock", { mode, offsetMs: 0 });
    else await ctx.db.patch(row._id, { mode });
  },
});

// ---- timezone helpers (Intl only; no date library) ----

export type Parts = { y: number; m: number; d: number; h: number; mi: number; weekday: number };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(t: number, tz: string): Parts {
  const parts = fmt(tz).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const h = Number(get("hour")) % 24;
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), h, mi: Number(get("minute")), weekday: WEEKDAYS[get("weekday")] ?? 0 };
}

/** UTC instant for a wall-clock time in `tz`. Two-pass offset correction handles DST. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const target = Date.UTC(y, m - 1, d, h, mi, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, 0, 0);
    const diff = target - asUtc; // how far the wall clock at `guess` is from the wanted wall clock
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

export const ACH_WINDOWS_ET = [13, 17, 18] as const;

/** Next Same Day ACH window (13:00, 17:00, 18:00 ET) on a business day at or after t. */
export function nextAchWindow(t: number): number {
  const p0 = zonedParts(t, NY);
  for (let k = 0; k < 10; k++) {
    // noon on candidate day, then re-read parts to normalize month/day overflow
    const probeNoon = zonedToUtc(p0.y, p0.m, p0.d + k, 12, 0, NY);
    const p = zonedParts(probeNoon, NY);
    if (p.weekday === 0 || p.weekday === 6) continue;
    for (const hour of ACH_WINDOWS_ET) {
      const w = zonedToUtc(p.y, p.m, p.d, hour, 0, NY);
      if (w >= t) return w;
    }
  }
  throw new Error("nextAchWindow: no window found");
}

/** Funds availability for a given ACH window: 13:30 / 17:00 / 18:00 receiver-local. */
export function availabilityFor(windowTime: number, receiverTz: string = DEFAULT_RECEIVER_TZ): number {
  const ny = zonedParts(windowTime, NY);
  const local = zonedParts(windowTime, receiverTz);
  let h = 18, mi = 0;
  if (ny.h === 13) { h = 13; mi = 30; }
  else if (ny.h === 17) { h = 17; mi = 0; }
  const avail = zonedToUtc(local.y, local.m, local.d, h, mi, receiverTz);
  // Never before the window itself (e.g. a receiver far east of NY).
  return Math.max(avail, windowTime);
}

/** 18:00 receiver-local on the same calendar day as t (or next day if already past). */
export function endOfBusinessDay(t: number, tz: string = DEFAULT_RECEIVER_TZ): number {
  const p = zonedParts(t, tz);
  let eob = zonedToUtc(p.y, p.m, p.d, 18, 0, tz);
  if (eob <= t) eob = zonedToUtc(p.y, p.m, p.d + 1, 18, 0, tz);
  return eob;
}

/** Same wall-clock time on the next business day. */
export function nextBusinessDay(t: number, tz: string = NY): number {
  const p = zonedParts(t, tz);
  for (let k = 1; k < 8; k++) {
    const cand = zonedToUtc(p.y, p.m, p.d + k, p.h, p.mi, tz);
    const wd = zonedParts(cand, tz).weekday;
    if (wd !== 0 && wd !== 6) return cand;
  }
  return t + DAY;
}
