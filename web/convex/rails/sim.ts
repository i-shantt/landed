// Simulated bank rail. Writes a ledger row per destination account. Idempotent by
// key. Works with zero network access. Settlement/availability are decided by the
// engine's timers, not by the rail.
import { internalMutation, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Rail, RailStatus } from "./types";
import { now } from "../clock";

export const credit = internalMutation({
  args: {
    accountKey: v.string(),
    amountCents: v.number(),
    memo: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const t = await now(ctx);
    const row = await ctx.db.query("simLedger").withIndex("by_account", (q) => q.eq("accountKey", args.accountKey)).unique();
    const ref = `SIM-${args.idempotencyKey}`;
    if (row) {
      const existing = row.entries.find((e) => e.ref === ref);
      if (existing) return { railRef: ref, duplicate: true };
      await ctx.db.patch(row._id, {
        entries: [...row.entries, { ref, amountCents: args.amountCents, memo: args.memo, submittedAt: t, state: "submitted" }],
      });
    } else {
      await ctx.db.insert("simLedger", {
        accountKey: args.accountKey,
        entries: [{ ref, amountCents: args.amountCents, memo: args.memo, submittedAt: t, state: "submitted" }],
      });
    }
    return { railRef: ref, duplicate: false };
  },
});

export const setEntryState = internalMutation({
  args: { railRef: v.string(), state: v.string() },
  handler: async (ctx, { railRef, state }) => {
    const t = await now(ctx);
    const rows = await ctx.db.query("simLedger").collect();
    for (const row of rows) {
      const idx = row.entries.findIndex((e) => e.ref === railRef);
      if (idx >= 0) {
        const entries = [...row.entries];
        entries[idx] = {
          ...entries[idx],
          state,
          settledAt: state === "settled" || state === "available" ? (entries[idx].settledAt ?? t) : entries[idx].settledAt,
          availableAt: state === "available" ? t : entries[idx].availableAt,
        };
        await ctx.db.patch(row._id, { entries });
        return;
      }
    }
  },
});

export const statusByRef = internalQuery({
  args: { railRef: v.string() },
  handler: async (ctx, { railRef }) => {
    const rows = await ctx.db.query("simLedger").collect();
    for (const row of rows) {
      const e = row.entries.find((e) => e.ref === railRef);
      if (e) return e.state as RailStatus;
    }
    return "submitted" as RailStatus;
  },
});

export class SimRail implements Rail {
  name = "sim" as const;
  constructor(private ctx: ActionCtx) {}
  async sendCredit(args: { routing: string; accountNumber: string; amountCents: number; memo: string; idempotencyKey: string }) {
    // The sim ledger is keyed by routing + last4 only; the full account number is never stored.
    const accountKey = `${args.routing}:${args.accountNumber.slice(-4)}`;
    const res = await this.ctx.runMutation(internal.rails.sim.credit, {
      accountKey,
      amountCents: args.amountCents,
      memo: args.memo,
      idempotencyKey: args.idempotencyKey,
    });
    return { railRef: res.railRef };
  }
  async getStatus(railRef: string) {
    return this.ctx.runQuery(internal.rails.sim.statusByRef, { railRef });
  }
}
