// Named operators with roles. There is no authentication provider in this build: the browser
// picks an operator and passes its id; the server enforces role rules (who may approve, who may
// change policy) and segregation of duties (requester != approver). The audit log records the
// operator on every controls action. Production swaps the picker for SSO without changing rules.
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";

export type Role = Doc<"operators">["role"];

export const DEFAULT_OPERATORS: { name: string; initials: string; role: Role; email: string }[] = [
  { name: "Marisol Vega", initials: "MV", role: "clerk", email: "marisol@meridianoutdoor.example" },
  { name: "Devon Park", initials: "DP", role: "approver", email: "devon@meridianoutdoor.example" },
  { name: "Priya Natarajan", initials: "PN", role: "admin", email: "priya@meridianoutdoor.example" },
];

export async function seedOperators(ctx: MutationCtx) {
  const existing = await ctx.db.query("operators").collect();
  if (existing.length) return;
  for (const o of DEFAULT_OPERATORS) await ctx.db.insert("operators", { ...o, active: true });
}

export async function requireOperator(ctx: QueryCtx | MutationCtx, operatorId: Id<"operators">, roles?: Role[]): Promise<Doc<"operators">> {
  const op = await ctx.db.get(operatorId);
  if (!op || !op.active) throw new ConvexError("operator_unknown_or_inactive");
  if (roles && !roles.includes(op.role)) throw new ConvexError(`role_${op.role}_cannot_do_this_requires_${roles.join("_or_")}`);
  return op;
}

export const list = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("operators").collect()).filter((o) => o.active).sort((a, b) => a.name.localeCompare(b.name)),
});

export const create = mutation({
  args: { operatorId: v.id("operators"), name: v.string(), role: v.union(v.literal("clerk"), v.literal("approver"), v.literal("admin")), email: v.optional(v.string()) },
  handler: async (ctx, { operatorId, name, role, email }) => {
    await requireOperator(ctx, operatorId, ["admin"]);
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new ConvexError("name_too_short");
    const initials = trimmed.split(/\s+/).map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2);
    return ctx.db.insert("operators", { name: trimmed, initials, role, email: email?.trim() || undefined, active: true });
  },
});

export const deactivate = mutation({
  args: { operatorId: v.id("operators"), target: v.id("operators") },
  handler: async (ctx, { operatorId, target }) => {
    await requireOperator(ctx, operatorId, ["admin"]);
    if (operatorId === target) throw new ConvexError("cannot_deactivate_self");
    const admins = (await ctx.db.query("operators").collect()).filter((o) => o.active && o.role === "admin");
    const t = await ctx.db.get(target);
    if (t?.role === "admin" && admins.length <= 1) throw new ConvexError("last_admin");
    await ctx.db.patch(target, { active: false });
  },
});

/** Ensures operators exist on deployments seeded before this table existed. */
export const ensureSeeded = mutation({
  args: {},
  handler: async (ctx) => {
    await seedOperators(ctx);
    return (await ctx.db.query("operators").collect()).length;
  },
});
