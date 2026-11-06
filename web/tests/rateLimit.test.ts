import { describe, it, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import { refill, isWriteConflict } from "../convex/rateLimit";
import { setup } from "./harness";

describe("rate limit token bucket", () => {
  it("refills linearly up to capacity", () => {
    const b = refill({ tokens: 0, updatedAt: 0 }, 10, 1, 5000);
    expect(b.tokens).toBe(5);
    expect(refill({ tokens: 0, updatedAt: 0 }, 10, 1, 60000).tokens).toBe(10);
    expect(refill(null, 10, 1, 0).tokens).toBe(10);
  });
  it("recognises Convex's write-conflict failure and nothing else", () => {
    expect(isWriteConflict(new Error('[Request ID: 3d7c9d58ef1921ea] Server Error: Uncaught Error: Documents read from or written to the "settings" table changed while this mutation was being run and on every subsequent retry.'))).toBe(true);
    expect(isWriteConflict(new Error("OptimisticConcurrencyControlFailure: retry"))).toBe(true);
    expect(isWriteConflict(new Error("Uncaught ConvexError: not_found"))).toBe(false);
    expect(isWriteConflict("rate limit")).toBe(false);
    expect(isWriteConflict(undefined)).toBe(false);
  });
  it("denies after capacity is spent and reports a retry delay", async () => {
    const { t } = await setup();
    for (let i = 0; i < 3; i++) expect((await t.mutation(internal.rateLimit.take, { bucket: "test:x", capacity: 3, refillPerSec: 1 })).ok).toBe(true);
    const r = await t.mutation(internal.rateLimit.take, { bucket: "test:x", capacity: 3, refillPerSec: 1 });
    expect(r.ok).toBe(false);
    expect((r as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
    // another bucket is independent
    expect((await t.mutation(internal.rateLimit.take, { bucket: "test:y", capacity: 3, refillPerSec: 1 })).ok).toBe(true);
  });
});
