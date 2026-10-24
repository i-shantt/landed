// Deterministic timers (I8). Every case timeout is a row here with dueAt on the
// application Clock. `runTick` fires due timers; nothing else schedules by delay.
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { now } from "./clock";
import { markSettled, markAvailable } from "./probes";
import { transition } from "./cases";

export type TimerKind = "probe_settle" | "probe_available" | "confirmation_sla" | "landing_check" | "landing_deadline";

export async function createTimer(
  ctx: MutationCtx,
  args: { caseId?: Id<"cases">; kind: TimerKind; dueAt: number; payload?: unknown }
) {
  return ctx.db.insert("timers", { caseId: args.caseId, kind: args.kind, dueAt: args.dueAt, fired: false, payload: args.payload });
}

export async function runTick(ctx: MutationCtx): Promise<number> {
  const t = await now(ctx);
  const due = await ctx.db
    .query("timers")
    .withIndex("by_due", (q) => q.eq("fired", false).lte("dueAt", t))
    .order("asc")
    .take(100);
  let fired = 0;
  for (const timer of due) {
    await ctx.db.patch(timer._id, { fired: true });
    fired++;
    const payload = (timer.payload ?? {}) as Record<string, unknown>;
    switch (timer.kind) {
      case "probe_settle": {
        if (payload.probeId) await markSettled(ctx, payload.probeId as Id<"probes">);
        break;
      }
      case "probe_available": {
        if (payload.probeId) await markAvailable(ctx, payload.probeId as Id<"probes">);
        break;
      }
      case "confirmation_sla": {
        if (!timer.caseId) break;
        const c = await ctx.db.get(timer.caseId);
        if (c && c.state === "AWAITING_CONFIRMATION") {
          await transition(ctx, c._id, "NEEDS_HUMAN", { actor: "system", type: "sla_expired", payload: { reason: "sla_expired" } }, "sla_expired");
        }
        break;
      }
      case "landing_check": {
        if (timer.caseId && payload.paymentId) {
          const p = await ctx.db.get(payload.paymentId as Id<"payments">);
          if (p && p.landingState === "pending") {
            await ctx.scheduler.runAfter(0, internal.channels.initiate.initiateLanding, { caseId: timer.caseId, paymentId: p._id });
          }
        }
        break;
      }
      case "landing_deadline": {
        if (!timer.caseId || !payload.paymentId) break;
        const p = await ctx.db.get(payload.paymentId as Id<"payments">);
        const c = await ctx.db.get(timer.caseId);
        if (p && p.landingState === "pending" && c && c.state === "PAID") {
          await ctx.db.patch(p._id, { landingState: "unconfirmed" });
          await transition(ctx, c._id, "UNCONFIRMED", { actor: "system", type: "landing_unconfirmed", payload: { paymentId: p._id, reason: "landing_deadline_passed" } });
          await ctx.scheduler.runAfter(0, internal.package.generate, { caseId: c._id, thenRecovery: true });
        }
        break;
      }
      default:
        break;
    }
  }
  return fired;
}

export const tick = internalMutation({
  args: {},
  handler: async (ctx) => ({ fired: await runTick(ctx) }),
});

export const pendingForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const rows = await ctx.db.query("timers").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    return rows.map((r) => ({ _id: r._id, kind: r.kind, dueAt: r.dueAt, fired: r.fired }));
  },
});

export const nextDue = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("timers").withIndex("by_due", (q) => q.eq("fired", false)).order("asc").first();
    return row ? { kind: row.kind, dueAt: row.dueAt, caseId: row.caseId } : null;
  },
});
