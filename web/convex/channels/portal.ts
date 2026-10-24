// Vendor portal confirmation path. Tokens are never emailed and never shown in
// the AP dashboard. The vendor logs in with onboarding-issued credentials.
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { now, HOUR, DAY } from "../clock";
import { append } from "../events";
import { recordFromChannel } from "../confirmations";
import { transition } from "../cases";
import { randomToken } from "../crypto";

export async function createConfirmToken(ctx: MutationCtx, caseId: Id<"cases">, vendorId: Id<"vendors">) {
  const existing = await ctx.db.query("confirmTokens").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const live = existing.find((t) => t.usedAt === undefined);
  if (live) return live.token;
  const t = await now(ctx);
  const token = randomToken(16);
  await ctx.db.insert("confirmTokens", { caseId, vendorId, token, attemptsLeft: 3, expiresAt: t + 2 * DAY });
  await append(ctx, { caseId, actor: "system", type: "portal_confirmation_opened", payload: { attempts: 3, expiresAt: t + 2 * DAY, note: "token visible only inside the vendor portal after login" } });
  return token;
}

/** Vendor-side: after portal login, list open confirmation requests for that vendor. */
export const openRequestsForSession = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const s = await ctx.db.query("portalSessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique();
    if (!s || s.expiresAt < Date.now()) return null;
    const vendor = await ctx.db.get(s.vendorId);
    const tokens = await ctx.db.query("confirmTokens").collect();
    const mine = tokens.filter((t) => t.vendorId === s.vendorId && t.usedAt === undefined);
    const out = [];
    for (const t of mine) {
      const c = await ctx.db.get(t.caseId);
      if (!c || c.state !== "AWAITING_CONFIRMATION") continue;
      const acct = await ctx.db.get(c.newAccountId);
      out.push({ token: t.token, attemptsLeft: t.attemptsLeft, expiresAt: t.expiresAt, accountLast4: acct?.accountLast4 ?? "????", routing: acct?.routing ?? "" });
    }
    const company = await ctx.db.query("company").first();
    return { vendorName: vendor?.name ?? "", companyName: company?.name ?? "", requests: out };
  },
});

export const tokenInfo = query({
  args: { sessionToken: v.string(), token: v.string() },
  handler: async (ctx, { sessionToken, token }) => {
    const s = await ctx.db.query("portalSessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique();
    if (!s || s.expiresAt < Date.now()) return { error: "not_logged_in" as const };
    const t = await ctx.db.query("confirmTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!t || t.vendorId !== s.vendorId) return { error: "not_found" as const };
    const c = await ctx.db.get(t.caseId);
    const acct = c ? await ctx.db.get(c.newAccountId) : null;
    const company = await ctx.db.query("company").first();
    const vendor = await ctx.db.get(s.vendorId);
    return {
      error: null,
      attemptsLeft: t.attemptsLeft,
      usedAt: t.usedAt ?? null,
      expiresAt: t.expiresAt,
      caseState: c?.state ?? null,
      accountLast4: acct?.accountLast4 ?? "????",
      companyName: company?.name ?? "",
      vendorName: vendor?.name ?? "",
    };
  },
});

export async function confirmWithToken(
  ctx: MutationCtx,
  args: { sessionToken: string; token: string; statedAmountCents: number | null }
) {
  const s = await ctx.db.query("portalSessions").withIndex("by_token", (q) => q.eq("token", args.sessionToken)).unique();
  if (!s || s.expiresAt < Date.now()) throw new ConvexError("portal_not_logged_in");
  const tok = await ctx.db.query("confirmTokens").withIndex("by_token", (q) => q.eq("token", args.token)).unique();
  if (!tok) throw new ConvexError("token_not_found");
  if (tok.vendorId !== s.vendorId) throw new ConvexError("token_vendor_mismatch");
  if (tok.usedAt !== undefined) throw new ConvexError("token_used");
  const t = await now(ctx);
  if (tok.expiresAt < t) throw new ConvexError("token_expired");
  if (tok.attemptsLeft <= 0) throw new ConvexError("no_attempts_left");
  await ctx.db.patch(tok._id, { attemptsLeft: tok.attemptsLeft - 1 });
  const res = await recordFromChannel(ctx, {
    caseId: tok.caseId,
    channel: "portal",
    contactId: s.contactId,
    statedAmountCents: args.statedAmountCents,
    outcome: args.statedAmountCents == null ? "nothing_arrived" : "stated",
    transcript: "[portal] vendor entered an amount after login",
  });
  const c = await ctx.db.get(tok.caseId);
  if (c?.state === "VERIFIED") {
    await ctx.db.patch(tok._id, { usedAt: t });
    return { ok: true, verified: true, attemptsLeft: tok.attemptsLeft - 1 };
  }
  if (tok.attemptsLeft - 1 <= 0 && c && c.state === "AWAITING_CONFIRMATION") {
    await transition(ctx, c._id, "NEEDS_HUMAN", { actor: "system", type: "escalated", payload: { reason: "portal_attempts_exhausted" } }, "portal_attempts_exhausted");
  }
  return { ok: true, verified: false, attemptsLeft: tok.attemptsLeft - 1, decision: res.decision };
}

export const confirm = mutation({
  args: { sessionToken: v.string(), token: v.string(), statedAmountCents: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => confirmWithToken(ctx, args),
});

export const confirmInternal = internalMutation({
  args: { sessionToken: v.string(), token: v.string(), statedAmountCents: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => confirmWithToken(ctx, args),
});

/** Creates a portal session; password check happens in the action (bcrypt). */
export const createSession = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const cred = await ctx.db.query("portalCredentials").withIndex("by_username", (q) => q.eq("username", username)).unique();
    if (!cred) throw new ConvexError("bad_credentials");
    const token = randomToken(24);
    await ctx.db.insert("portalSessions", { vendorId: cred.vendorId, contactId: cred.contactId, token, expiresAt: Date.now() + 12 * HOUR });
    return { token, vendorId: cred.vendorId };
  },
});

export const credentialHash = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const cred = await ctx.db.query("portalCredentials").withIndex("by_username", (q) => q.eq("username", username)).unique();
    return cred ? cred.passwordHash : null;
  },
});
