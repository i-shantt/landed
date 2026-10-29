// Operator onboarding for deployments: invite an admin by email (they choose their own password at /signin),
// scripted admin creation, and the two public demo accounts shown on the sign-in page.
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { initialsOf } from "./authCallbacks";

export type DemoAccount = { email: string; name: string; role: "approver" | "clerk"; password: string; blurb: string };

/** Public by design: reviewers use these. An approver cannot change policy, mint keys, manage webhooks or operators. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "demo@landed.example", name: "Demo Approver", role: "approver", password: "landed-demo-approver", blurb: "Approve requests, review screening hits, attest landings, build payment files." },
  { email: "clerk@landed.example", name: "Demo Clerk", role: "clerk", password: "landed-demo-clerk-2026", blurb: "Request approvals and run the payment run; a second browser for maker-checker." },
];

const roleV = v.union(v.literal("clerk"), v.literal("approver"), v.literal("admin"));

/** Create or revive the operator row for an email. Upgrades the role only when asked for admin. */
export const ensureOperator = internalMutation({
  args: { email: v.string(), name: v.string(), role: roleV },
  handler: async (ctx, { email, name, role }): Promise<Id<"operators">> => {
    const e = email.trim().toLowerCase();
    const existing = await ctx.db.query("operators").withIndex("by_email", (q) => q.eq("email", e)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { active: true, ...(role === "admin" && existing.role !== "admin" ? { role } : {}) });
      return existing._id;
    }
    return ctx.db.insert("operators", { name: name.trim(), initials: initialsOf(name), role, email: e, active: true });
  },
});

export const accountExists = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    (await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email.trim().toLowerCase())).first()) !== null,
});

/** Invite an administrator: operator row only; they sign up at /signin and pick their own password. */
export const inviteAdmin = internalAction({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, { email, name }): Promise<{ operatorId: Id<"operators"> }> => {
    const operatorId = await ctx.runMutation(internal.authSetup.ensureOperator, { email, name, role: "admin" });
    return { operatorId };
  },
});

async function ensureAccount(ctx: ActionCtx, a: { email: string; name: string; role: "clerk" | "approver" | "admin"; password: string }): Promise<"created" | "exists"> {
  const email = a.email.trim().toLowerCase();
  await ctx.runMutation(internal.authSetup.ensureOperator, { email, name: a.name, role: a.role });
  if (await ctx.runQuery(internal.authSetup.accountExists, { email })) return "exists";
  await createAccount<DataModel>(ctx, { provider: "password", account: { id: email, secret: a.password }, profile: { email, name: a.name } });
  return "created";
}

/** Scripted environments only (CI, a throwaway deployment). People use inviteAdmin + /signin. */
export const setupAdmin = internalAction({
  args: { email: v.string(), name: v.string(), password: v.string() },
  handler: async (ctx, a) => ensureAccount(ctx, { ...a, role: "admin" }),
});

/** Idempotent; run after every prod deploy. Demo accounts live in auth tables that reseed never touches. */
export const ensureDemoAccounts = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, "created" | "exists">> => {
    const out: Record<string, "created" | "exists"> = {};
    for (const a of DEMO_ACCOUNTS) out[a.email] = await ensureAccount(ctx, a);
    return out;
  },
});
