import { describe, it, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import { refill } from "../convex/rateLimit";
import { setup } from "./harness";

describe("rate limit token bucket", () => {
  it("refills linearly up to capacity", () => {
    const b = refill({ tokens: 0, updatedAt: 0 }, 10, 1, 5000);
    expect(b.tokens).toBe(5);
    expect(refill({ tokens: 0, updatedAt: 0 }, 10, 1, 60000).tokens).toBe(10);
    expect(refill(null, 10, 1, 0).tokens).toBe(10);
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
