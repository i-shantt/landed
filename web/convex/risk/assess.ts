// Risk assessment for a case, derived on read from stored facts (additive; nothing is written).
// `assessCase` is shared by the public query (case page, case list) and by the policy engine,
// which may require a human sign-off above a configurable score.
import { query } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { scoreRisk, type RiskAssessment } from "./score";

const DAY = 86_400_000;

export async function assessCase(ctx: QueryCtx | MutationCtx, c: Doc<"cases">): Promise<RiskAssessment> {
  const [vendor, company, newAccount, oldAccount, msg, events, confirmations, vendorCases, invoices] = await Promise.all([
    ctx.db.get(c.vendorId),
    ctx.db.query("company").first(),
    ctx.db.get(c.newAccountId),
    c.oldAccountId ? ctx.db.get(c.oldAccountId) : Promise.resolve(null),
    c.triggerMessageId ? ctx.db.get(c.triggerMessageId) : Promise.resolve(null),
    ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect(),
    ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect(),
    ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect(),
    ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect(),
  ]);

  const mismatch = events.find((e) => e.type === "sender_domain_mismatch");
  const mismatchPayload = (mismatch?.payload ?? {}) as { reason?: string };
  // The intake event for the message (not bound to a case) carries the reason; the case-bound one may not.
  let senderMismatchReason: string | null = mismatchPayload.reason ?? null;
  if (mismatch && !senderMismatchReason && c.triggerMessageId) {
    const msgEvents = await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", undefined)).collect();
    const hit = msgEvents.find((e) => e.type === "sender_domain_mismatch" && (e.payload as { messageId?: string })?.messageId === c.triggerMessageId);
    senderMismatchReason = ((hit?.payload ?? {}) as { reason?: string }).reason ?? "lookalike_domain";
  }
  const eml = events.find((e) => e.type === "eml_ingested");
  const replyTo = ((eml?.payload ?? {}) as { replyTo?: string | null }).replyTo ?? null;

  const amountAtStakeCents = invoices.filter((i) => i.status !== "paid" && i.remitAccountId === c.newAccountId).reduce((s, i) => s + i.amountCents, 0);
  const priorCasesLast90Days = vendorCases.filter((x) => x._id !== c._id && x.openedAt < c.openedAt && c.openedAt - x.openedAt <= 90 * DAY).length;

  let accountUsedByOtherVendors = 0;
  if (newAccount) {
    const sameHash = await ctx.db.query("bankAccounts").withIndex("by_hash", (q) => q.eq("accountHash", newAccount.accountHash)).collect();
    accountUsedByOtherVendors = new Set(sameHash.filter((a) => a.vendorId !== newAccount.vendorId).map((a) => a.vendorId as string)).size;
  }

  return scoreRisk({
    triggerType: c.triggerType,
    message: msg ? { from: msg.from, subject: msg.subject, body: msg.body, sentAt: msg.sentAt, authResult: msg.authResult, replyTo } : null,
    senderMismatchReason,
    contactAlsoChanged: c.contactAlsoChanged,
    amountAtStakeCents,
    vendorOnboardedAt: vendor?.onboardedAt ?? c.openedAt,
    priorCasesLast90Days,
    newRouting: newAccount?.routing ?? "",
    oldRouting: oldAccount?.routing ?? null,
    receiptClaimByEmail: confirmations.some((k) => k.channel === "email"),
    validationProviderResult: c.validationProviderResult ?? null,
    accountUsedByOtherVendors,
    caseOpenedAt: c.openedAt,
    timezone: company?.timezone ?? "America/Los_Angeles",
  });
}

export const forCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    return assessCase(ctx, c);
  },
});

/** Score for every case, keyed by id; used by the case queue and the dashboard. */
export const forAll = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("cases").collect();
    const out: Record<string, { score: number; tier: RiskAssessment["tier"]; top: string | null }> = {};
    for (const c of rows) {
      const a = await assessCase(ctx, c);
      out[c._id as string] = { score: a.score, tier: a.tier, top: a.signals[0]?.title ?? null };
    }
    return out as Record<Id<"cases">, { score: number; tier: RiskAssessment["tier"]; top: string | null }>;
  },
});
