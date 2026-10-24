// Simple token bucket for public HTTP actions (additive; schema frozen, so buckets live in `settings`
// under `rl:<bucket>`). Keyed by client IP when the platform forwards it, else a global bucket.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getSetting, setSetting } from "./settings";

type Bucket = { tokens: number; updatedAt: number };

export function refill(b: Bucket | null, capacity: number, refillPerSec: number, now: number): Bucket {
  if (!b) return { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - b.updatedAt) / 1000;
  return { tokens: Math.min(capacity, b.tokens + elapsed * refillPerSec), updatedAt: now };
}

export const take = internalMutation({
  args: { bucket: v.string(), capacity: v.number(), refillPerSec: v.number(), cost: v.optional(v.number()) },
  handler: async (ctx, { bucket, capacity, refillPerSec, cost }) => {
    const key = `rl:${bucket}`;
    const raw = await getSetting(ctx, key);
    let b: Bucket | null = null;
    try { b = raw ? (JSON.parse(raw) as Bucket) : null; } catch { b = null; }
    const now = Date.now();
    const cur = refill(b, capacity, refillPerSec, now);
    const c = cost ?? 1;
    if (cur.tokens < c) {
      await setSetting(ctx, key, JSON.stringify(cur));
      return { ok: false as const, retryAfterMs: Math.ceil(((c - cur.tokens) / refillPerSec) * 1000) };
    }
    cur.tokens -= c;
    await setSetting(ctx, key, JSON.stringify(cur));
    return { ok: true as const, remaining: Math.floor(cur.tokens) };
  },
});

export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "";
  const ip = xff.split(",")[0].trim();
  return ip || "global";
}
