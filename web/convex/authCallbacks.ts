// Library-free pieces of the sign-in flow, so they can be unit-tested with convex-test without minting tokens.
//
// Invite = an active operator row with the sign-up email. Sign-up with an email nobody invited fails, except
// for the very first user on an empty `users` table, who becomes the bootstrap admin (mutations are
// serializable, so two first sign-ups cannot both win). A session can only start for an active operator.
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { append } from "./events";

export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "??";
}

export async function onUserCreatedOrUpdated(
  ctx: MutationCtx,
  args: { userId: Id<"users">; existingUserId: Id<"users"> | null; profile: { email?: string | null; name?: string | null } },
): Promise<void> {
  if (args.existingUserId !== null) return; // sign-in to an existing account: nothing to link
  const email = (args.profile.email ?? "").trim().toLowerCase();
  if (!email) throw new ConvexError("email_required");
  const invited = (await ctx.db.query("operators").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((o) => o.active);
  let operator: Doc<"operators"> | null = invited[0] ?? null;
  let bootstrap = false;
  if (!operator) {
    const users = await ctx.db.query("users").take(2);
    const onlyMe = users.length === 1 && users[0]._id === args.userId;
    if (!onlyMe) throw new ConvexError("signup_not_invited");
    const name = (args.profile.name ?? "").trim() || email.split("@")[0];
    const id = await ctx.db.insert("operators", { name, initials: initialsOf(name), role: "admin", email, active: true });
    operator = (await ctx.db.get(id))!;
    bootstrap = true;
  }
  const linked = await ctx.db.query("users").withIndex("by_operatorId", (q) => q.eq("operatorId", operator!._id)).collect();
  if (linked.some((u) => u._id !== args.userId)) throw new ConvexError("operator_already_linked");
  await ctx.db.patch(args.userId, { operatorId: operator._id });
  await append(ctx, { actor: "human", type: "operator_account_linked", payload: { operatorId: operator._id, by: operator.name, role: operator.role, email, bootstrap } });
}

/** Resolve the operator behind a user; null when unlinked or inactive. */
export async function operatorForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<Doc<"operators"> | null> {
  const user = await ctx.db.get(userId);
  if (!user?.operatorId) return null;
  const op = await ctx.db.get(user.operatorId);
  return op && op.active ? op : null;
}

export async function assertCanStartSession(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  if (!(await operatorForUser(ctx, userId))) throw new ConvexError("operator_unknown_or_inactive");
}
