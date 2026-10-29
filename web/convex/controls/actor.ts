// Who is acting. The signed-in user (Convex Auth) resolves to exactly one active operator row; role,
// audit identity and the foreign keys on approvals/screenings/apiKeys stay on `operators`. No function
// accepts a client-supplied operator id (tests/security.test.ts enforces it).
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

export async function requireActor(ctx: QueryCtx | MutationCtx, roles?: Role[]): Promise<Doc<"operators">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("unauthenticated");
  const op = await operatorForUser(ctx, userId);
  if (!op) throw new ConvexError("operator_unknown_or_inactive");
  if (roles && !roles.includes(op.role)) throw new ConvexError(`role_${op.role}_cannot_do_this_requires_${roles.join("_or_")}`);
  return op;
}

/** For actions: the session identity propagates through ctx.runQuery, so actions resolve the actor here. */
export const resolve = internalQuery({
  args: { roles: v.optional(v.array(roleV)) },
  handler: async (ctx, { roles }): Promise<{ _id: Id<"operators">; name: string; role: Role }> => {
    const op = await requireActor(ctx, roles);
    return { _id: op._id, name: op.name, role: op.role };
  },
});
