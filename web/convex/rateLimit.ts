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

/**
 * Convex reports an optimistic-concurrency failure (one bucket document written by more concurrent requests than
 * its retries can serialise) as a thrown Error. For a per-key bucket that is the definition of a burst, so the
 * HTTP layer answers 429 with a short retry instead of 500. Matches the message Convex emits today and the
 * error class name, nothing broader.
 */
export function isWriteConflict(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return /changed while this mutation was being run|OptimisticConcurrencyControlFailure/.test(msg);
}

export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "";
  // The LAST entry is the hop the platform appended; the leftmost values are client-controlled.
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
  const ip = parts[parts.length - 1] ?? "";
  return ip || "global";
}
