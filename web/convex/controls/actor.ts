// Who is acting. The signed-in user (Convex Auth) resolves to exactly one active operator row; role,
// audit identity and the foreign keys on approvals/screenings/apiKeys stay on `operators`.
//
// Transitional: a caller without a session may still name an `operatorId` (the pre-auth picker and
// older tests). That fallback is removed once every client signs in.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { operatorForUser } from "../authCallbacks";

export type Role = Doc<"operators">["role"];
export const roleV = v.union(v.literal("clerk"), v.literal("approver"), v.literal("admin"));

/** The active operator behind the current session, or null when signed out or unlinked. */
export async function currentActor(ctx: QueryCtx | MutationCtx): Promise<Doc<"operators"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return operatorForUser(ctx, userId);
}

export async function requireActor(ctx: QueryCtx | MutationCtx, roles?: Role[], fallbackOperatorId?: Id<"operators">): Promise<Doc<"operators">> {
  const userId = await getAuthUserId(ctx);
  let op: Doc<"operators"> | null = null;
  if (userId) {
    op = await operatorForUser(ctx, userId);
    if (!op) throw new ConvexError("operator_unknown_or_inactive");
  } else if (fallbackOperatorId) {
    op = await ctx.db.get(fallbackOperatorId);
    if (!op || !op.active) throw new ConvexError("operator_unknown_or_inactive");
  } else {
    throw new ConvexError("unauthenticated");
  }
  if (roles && !roles.includes(op.role)) throw new ConvexError(`role_${op.role}_cannot_do_this_requires_${roles.join("_or_")}`);
  return op;
}

/** For actions: the session identity propagates through ctx.runQuery, so actions resolve the actor here. */
export const resolve = internalQuery({
  args: { roles: v.optional(v.array(roleV)), operatorId: v.optional(v.id("operators")) },
  handler: async (ctx, { roles, operatorId }): Promise<{ _id: Id<"operators">; name: string; role: Role }> => {
    const op = await requireActor(ctx, roles, operatorId);
    return { _id: op._id, name: op.name, role: op.role };
  },
});
