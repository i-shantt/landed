// Additive queries over timers (timers.ts is frozen core). Used by the Settings jump buttons.
import { query } from "./_generated/server";
import { v } from "convex/values";

/** Next unfired timer of a given kind, by due time. */
export const nextOfKind = query({
  args: { kind: v.string() },
  handler: async (ctx, { kind }) => {
    const rows = await ctx.db.query("timers").withIndex("by_due", (q) => q.eq("fired", false)).order("asc").take(500);
    const row = rows.find((r) => r.kind === kind);
    return row ? { kind: row.kind, dueAt: row.dueAt, caseId: row.caseId ?? null } : null;
  },
});

/** Next unfired timer per kind, for the Settings page. */
export const nextByKind = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("timers").withIndex("by_due", (q) => q.eq("fired", false)).order("asc").take(500);
    const out: Record<string, { dueAt: number; caseId: string | null }> = {};
    for (const r of rows) if (!out[r.kind]) out[r.kind] = { dueAt: r.dueAt, caseId: r.caseId ?? null };
    return out;
  },
});
