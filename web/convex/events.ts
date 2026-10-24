// Append-only audit log. No update/delete is exported anywhere for `events`.
import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { now } from "./clock";

export type Actor = "agent" | "human" | "rail" | "vendor" | "system";

const ALWAYS_STRIP = new Set(["accountNumber", "accountCiphertext", "accountNumberPlain", "accountNumberFull"]);

/** Deletes secret keys recursively. Probe/confirmation amounts never reach the log. */
export function redact(type: string, payload: unknown): unknown {
  const stripAmounts = type.startsWith("probe_") || type.startsWith("confirmation_") || type.startsWith("sim_voice");
  const walk = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (ALWAYS_STRIP.has(k)) continue;
        if (stripAmounts && (k === "amountCents" || k === "statedAmountCents")) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return val;
  };
  return walk(payload ?? {});
}

export async function append(
  ctx: MutationCtx,
  args: { caseId?: Id<"cases">; actor: Actor; type: string; payload?: unknown }
) {
  const at = await now(ctx);
  return ctx.db.insert("events", {
    caseId: args.caseId,
    at,
    actor: args.actor,
    type: args.type,
    payload: redact(args.type, args.payload),
  });
}

export const listForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const rows = await ctx.db
      .query("events")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();
    return rows.sort((a, b) => a.at - b.at || a._creationTime - b._creationTime);
  },
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("events").order("desc").take(50);
    return rows;
  },
});
