// Portal login lockout (additive; schema is frozen so state lives in `settings`):
// 5 failed attempts per username within 15 minutes locks the username for 15 minutes.
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getSetting, setSetting, deleteSetting } from "./settings";

export const MAX_FAILS = 5;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

type Lock = { fails: number; firstAt: number; lockedUntil?: number };
const key = (u: string) => `portalLock:${u.toLowerCase()}`;

async function read(ctx: Parameters<typeof getSetting>[0], username: string): Promise<Lock | null> {
  const raw = await getSetting(ctx, key(username));
  if (!raw) return null;
  try { return JSON.parse(raw) as Lock; } catch { return null; }
}

/** Returns ms remaining if locked, else 0. */
export const check = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const l = await read(ctx, username);
    if (!l?.lockedUntil) return 0;
    return Math.max(0, l.lockedUntil - Date.now());
  },
});

export const recordFailure = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const now = Date.now();
    let l = (await read(ctx, username)) ?? { fails: 0, firstAt: now };
    if (now - l.firstAt > WINDOW_MS) l = { fails: 0, firstAt: now };
    l.fails += 1;
    if (l.fails >= MAX_FAILS) l.lockedUntil = now + LOCK_MS;
    await setSetting(ctx, key(username), JSON.stringify(l));
    return { fails: l.fails, lockedUntil: l.lockedUntil ?? null };
  },
});

export const clear = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => deleteSetting(ctx, key(username)),
});
