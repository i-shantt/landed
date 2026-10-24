import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

export async function getSetting(ctx: QueryCtx | MutationCtx, key: string): Promise<string | null> {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return row?.value ?? null;
}

export async function setSetting(ctx: MutationCtx, key: string, value: string) {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("settings", { key, value });
}

export async function deleteSetting(ctx: MutationCtx, key: string) {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (row) await ctx.db.delete(row._id);
}

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => getSetting(ctx, key),
});

export const all = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("settings").collect();
    const out: Record<string, string> = {};
    for (const r of rows) {
      // Never expose simulated vendor statements (they may contain a probe amount).
      if (r.key.startsWith("simVendorStatement:")) continue;
      out[r.key] = r.value;
    }
    return out;
  },
});

const PUBLIC_SETTABLE = new Set(["extractorMode", "rail", "voice"]);

export const set = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    if (!PUBLIC_SETTABLE.has(key)) throw new Error(`setting ${key} is not settable from the client`);
    if (key === "extractorMode" && !["claude", "rules", "off"].includes(value)) throw new Error("bad extractorMode");
    if (key === "rail" && !["sim", "nessie"].includes(value)) throw new Error("bad rail");
    if (key === "voice" && !["sim", "vapi"].includes(value)) throw new Error("bad voice");
    await setSetting(ctx, key, value);
  },
});
