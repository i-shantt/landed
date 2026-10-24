// Demo controls (additive). One-click "fast-forward the bank" for a case: advances the demo
// clock to the case's next meaningful timer (probe availability, or the landing check when
// PAID) and fires everything due on the way. Uses clock.advanceBy; touches no core file.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { advanceBy, now } from "./clock";

const ORDER = ["probe_settle", "probe_available", "landing_check", "landing_deadline", "confirmation_sla"] as const;

async function nextForCase(ctx: Parameters<typeof now>[0], caseId: import("./_generated/dataModel").Id<"cases">) {
  const timers = await ctx.db.query("timers").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const pending = timers.filter((t) => !t.fired).sort((a, b) => a.dueAt - b.dueAt);
  // Prefer the probe-availability target (settle fires on the way), then the landing check.
  const avail = pending.find((t) => t.kind === "probe_available");
  if (avail) return { kind: "probe_available", dueAt: avail.dueAt, label: "Probe available to the vendor" };
  const landing = pending.find((t) => t.kind === "landing_check");
  if (landing) return { kind: "landing_check", dueAt: landing.dueAt, label: "Landing check" };
  const first = pending[0];
  if (!first) return null;
  return { kind: first.kind, dueAt: first.dueAt, label: first.kind === "confirmation_sla" ? "Confirmation window expires" : first.kind === "landing_deadline" ? "Landing deadline" : first.kind };
}

export const nextStep = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const n = await nextForCase(ctx, caseId);
    if (!n) return null;
    const t = await now(ctx);
    return { ...n, inMs: Math.max(0, n.dueAt - t), order: ORDER.indexOf(n.kind as (typeof ORDER)[number]) };
  },
});

export const fastForward = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const n = await nextForCase(ctx, caseId);
    if (!n) return { advanced: false, reason: "no pending timer for this case" };
    const t = await now(ctx);
    const res = await advanceBy(ctx, Math.max(0, n.dueAt - t) + 1000);
    return { advanced: true, to: n.kind, label: n.label, now: res.now, fired: res.fired };
  },
});
