// API keys for the public REST API. The key is shown once; only its SHA-256 lives in the database.
// Format: `ld_live_sk_<48 hex>` (prefix kept for display). Scopes gate each route.
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { append } from "../events";
import { requireOperator } from "../controls/operators";
import { randomHex, sha256Hex } from "./util";

export const SCOPES = ["read", "write:changes", "write:payments", "write:vendors", "files:read", "webhooks:manage"] as const;
export type Scope = (typeof SCOPES)[number];

export const insert = internalMutation({
  args: { name: v.string(), prefix: v.string(), keyHash: v.string(), scopes: v.array(v.string()), createdBy: v.optional(v.id("operators")) },
  handler: async (ctx, a) => {
    const id = await ctx.db.insert("apiKeys", { ...a, createdAt: Date.now() });
    const op = a.createdBy ? await ctx.db.get(a.createdBy) : null;
    await append(ctx, { actor: "human", type: "api_key_created", payload: { apiKeyId: id, name: a.name, prefix: a.prefix, scopes: a.scopes, by: op?.name ?? null } });
    return id;
  },
});

/** Admin creates a key; the plaintext is returned exactly once. */
export const create = action({
  args: { operatorId: v.id("operators"), name: v.string(), scopes: v.array(v.string()) },
  handler: async (ctx, { operatorId, name, scopes }): Promise<{ id: Id<"apiKeys">; key: string; prefix: string }> => {
    const op = await ctx.runQuery(internal.api.keys.operatorRole, { operatorId });
    if (op !== "admin") throw new ConvexError("role_admin_required");
    if (!name.trim()) throw new ConvexError("name_required");
    const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
    if (bad.length) throw new ConvexError(`unknown_scopes_${bad.join(",")}`);
    const key = `ld_live_sk_${randomHex(24)}`;
    const prefix = key.slice(0, 16);
    const keyHash = await sha256Hex(key);
    const id = await ctx.runMutation(internal.api.keys.insert, { name: name.trim(), prefix, keyHash, scopes, createdBy: operatorId });
    return { id, key, prefix };
  },
});

export const operatorRole = internalQuery({
  args: { operatorId: v.id("operators") },
  handler: async (ctx, { operatorId }) => (await ctx.db.get(operatorId))?.role ?? null,
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("apiKeys").collect();
    const out = [];
    for (const k of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const op = k.createdBy ? await ctx.db.get(k.createdBy) : null;
      out.push({ _id: k._id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, createdBy: op?.name ?? null, lastUsedAt: k.lastUsedAt ?? null, revokedAt: k.revokedAt ?? null });
    }
    return out;
  },
});

export const revoke = mutation({
  args: { operatorId: v.id("operators"), apiKeyId: v.id("apiKeys") },
  handler: async (ctx, { operatorId, apiKeyId }) => {
    const op = await requireOperator(ctx, operatorId, ["admin"]);
    const k = await ctx.db.get(apiKeyId);
    if (!k) throw new ConvexError("key_not_found");
    if (k.revokedAt) return;
    await ctx.db.patch(apiKeyId, { revokedAt: Date.now() });
    await append(ctx, { actor: "human", type: "api_key_revoked", payload: { apiKeyId, prefix: k.prefix, by: op.name } });
  },
});

/** Used by HTTP routes: resolve a hashed key to its scopes. */
export const byHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => {
    const k = await ctx.db.query("apiKeys").withIndex("by_hash", (q) => q.eq("keyHash", keyHash)).unique();
    if (!k || k.revokedAt) return null;
    return { _id: k._id, name: k.name, prefix: k.prefix, scopes: k.scopes };
  },
});

export const touch = internalMutation({
  args: { apiKeyId: v.id("apiKeys") },
  handler: async (ctx, { apiKeyId }) => {
    const k = await ctx.db.get(apiKeyId);
    // At most one write per minute per key to keep the audit of use cheap.
    if (k && (!k.lastUsedAt || Date.now() - k.lastUsedAt > 60_000)) await ctx.db.patch(apiKeyId, { lastUsedAt: Date.now() });
  },
});

// ---- idempotency (POST only; 24h) ----
export const idempotencyLookup = internalQuery({
  args: { scopeKey: v.string() },
  handler: async (ctx, { scopeKey }) => {
    const row = await ctx.db.query("apiRequests").withIndex("by_scopeKey", (q) => q.eq("scopeKey", scopeKey)).unique();
    if (!row || Date.now() - row.createdAt > 24 * 3600_000) return null;
    return row;
  },
});

export const idempotencyStore = internalMutation({
  args: { scopeKey: v.string(), requestHash: v.string(), status: v.number(), body: v.string() },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("apiRequests").withIndex("by_scopeKey", (q) => q.eq("scopeKey", a.scopeKey)).unique();
    if (existing) return existing._id;
    return ctx.db.insert("apiRequests", { ...a, createdAt: Date.now() });
  },
});
