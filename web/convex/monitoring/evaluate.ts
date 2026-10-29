// Monitoring read model: ctx helpers that gather a candidate's inputs from Landed's own tables and hand
// them to the pure modules. Read-only by construction (tests/modelCannotRelease.test.ts walks this dir).
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { loadHistory } from "../risk/model/history";
import { assessSentPayment } from "../risk/model/assessPayment";
import { evaluateCandidate, type MonitoringResult } from "./signals";
import { trustScore, type TrustResult } from "./beneficiaryTrust";
import { buildTrend, localDate, type TrendDay } from "./trend";

type Ctx = QueryCtx | MutationCtx;

/** When was this destination verified (bound confirmation or exceptional release)? Null when never. */
export async function destinationVerifiedAt(ctx: Ctx, destinationId: Id<"bankAccounts">): Promise<number | null> {
  const cases = await ctx.db.query("cases").withIndex("by_newAccount", (q) => q.eq("newAccountId", destinationId)).collect();
  let latest: number | null = null;
  for (const c of cases) {
    const evs = await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect();
    for (const e of evs) if ((e.type === "account_verified" || e.type === "exceptional_release") && (latest === null || e.at > latest)) latest = e.at;
  }
  return latest;
}

async function companyTimezone(ctx: Ctx): Promise<string> {
  const company = await ctx.db.query("company").first();
  return company?.timezone ?? "America/Los_Angeles";
}

/**
 * Monitoring signals for a payment that would go out now (or went out at `at`). History is everything
 * strictly before `at`, so a sent payment is scored with the world as it was when it was sent.
 */
export async function evaluateCandidateFor(
  ctx: Ctx,
  args: { invoice: Doc<"invoices">; destination: Doc<"bankAccounts">; at: number; rail: "ach" | "wire"; thresholdCents: number | null },
): Promise<MonitoringResult> {
  const { invoice, destination, at, rail, thresholdCents } = args;
  const vendorHistory = await loadHistory(ctx, { vendorId: invoice.vendorId, before: at });
  const paidThisAccountBefore = (destination.firstPaidAt !== undefined && destination.firstPaidAt < at) || vendorHistory.some((r) => r.destinationAccountId === destination._id);
  return evaluateCandidate(
    {
      amountCents: invoice.amountCents,
      at,
      vendorId: invoice.vendorId,
      destinationAccountId: destination._id,
      rail,
      isFirstPaymentToAccount: !paidThisAccountBefore,
      verifiedAt: await destinationVerifiedAt(ctx, destination._id),
      timezone: await companyTimezone(ctx),
      thresholdCents,
    },
    vendorHistory,
  );
}

export type MonitoredPayment = {
  paymentId: Id<"payments">;
  invoiceId: Id<"invoices">;
  invoiceNumber: string;
  vendorId: Id<"vendors">;
  vendorName: string;
  amountCents: number;
  rail: "ach" | "wire";
  sentAt: number;
  landingState: Doc<"payments">["landingState"];
  caseId: Id<"cases"> | null;
  monitoring: MonitoringResult;
  modelProbability: number | null;
  modelVersion: string | null;
};

export const MONITOR_LIMIT = 500;

/** Every sent payment (newest first, capped), scored with the history that existed before it. */
export async function computeMonitoring(ctx: Ctx, thresholdCents: number | null): Promise<MonitoredPayment[]> {
  const payments = (await ctx.db.query("payments").collect()).sort((a, b) => b.sentAt - a.sentAt).slice(0, MONITOR_LIMIT);
  const vendors = new Map<string, Doc<"vendors">>();
  const invoices = new Map<string, Doc<"invoices">>();
  const accounts = new Map<string, Doc<"bankAccounts">>();
  const out: MonitoredPayment[] = [];
  for (const p of payments) {
    if (!vendors.has(p.vendorId)) { const v = await ctx.db.get(p.vendorId); if (v) vendors.set(p.vendorId, v); }
    if (!invoices.has(p.invoiceId)) { const i = await ctx.db.get(p.invoiceId); if (i) invoices.set(p.invoiceId, i); }
    if (!accounts.has(p.destinationAccountId)) { const a = await ctx.db.get(p.destinationAccountId); if (a) accounts.set(p.destinationAccountId, a); }
    const inv = invoices.get(p.invoiceId);
    const dest = accounts.get(p.destinationAccountId);
    if (!inv || !dest) continue;
    const candidate = { ...inv, amountCents: p.amountCents };
    const monitoring = await evaluateCandidateFor(ctx, { invoice: candidate, destination: dest, at: p.sentAt, rail: p.rail, thresholdCents });
    let modelProbability: number | null = null;
    let modelVersion: string | null = null;
    try {
      const m = await assessSentPayment(ctx, p);
      if (m) {
        modelProbability = m.probability;
        modelVersion = m.version;
      }
    } catch {
      /* model inputs missing: monitoring still stands on its own */
    }
    out.push({
      paymentId: p._id,
      invoiceId: p.invoiceId,
      invoiceNumber: inv.number,
      vendorId: p.vendorId,
      vendorName: vendors.get(p.vendorId)?.name ?? "unknown vendor",
      amountCents: p.amountCents,
      rail: p.rail,
      sentAt: p.sentAt,
      landingState: p.landingState,
      caseId: p.caseId ?? null,
      monitoring,
      modelProbability,
      modelVersion,
    });
  }
  return out;
}

/** Per-day trend over the last 7 or 30 local days. heldCents = invoices following the accounts of cases opened that day. */
export async function computeTrend(ctx: Ctx, args: { now: number; days: 7 | 30; rows: MonitoredPayment[] }): Promise<TrendDay[]> {
  const timezone = await companyTimezone(ctx);
  const since = args.now - args.days * 86_400_000;
  const cases = (await ctx.db.query("cases").collect()).filter((c) => c.openedAt >= since && c.openedAt <= args.now);
  const heldByDay: Record<string, number> = {};
  for (const c of cases) {
    const invs = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect();
    const held = invs.filter((i) => i.remitAccountId === c.newAccountId && i.status !== "paid").reduce((s, i) => s + i.amountCents, 0);
    const d = localDate(c.openedAt, timezone);
    heldByDay[d] = (heldByDay[d] ?? 0) + held;
  }
  return buildTrend({
    now: args.now,
    days: args.days,
    timezone,
    rows: args.rows.map((r) => ({ at: r.sentAt, flagged: r.monitoring.flagged, flagScore: r.monitoring.flagScore, amountCents: r.amountCents })),
    heldByDay,
  });
}

export type VendorTrust = TrustResult & { vendorId: Id<"vendors">; vendorName: string; computedAt: number };

export async function computeVendorTrust(ctx: Ctx, vendor: Doc<"vendors">, now: number): Promise<VendorTrust> {
  const payments = await ctx.db.query("payments").withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id)).collect();
  const history = await loadHistory(ctx, { vendorId: vendor._id, before: now });
  const landedPayments = history.filter((r) => r.source === "invoice_history").length + payments.filter((p) => p.landingState === "landed").length;
  const unconfirmedPayments = payments.filter((p) => p.landingState === "unconfirmed").length;
  const cases = await ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id)).collect();
  const lastBankChangeAt = cases.length ? Math.max(...cases.map((c) => c.openedAt)) : null;
  const openCases = cases.filter((c) => c.state !== "CLOSED").length;
  const screenings = (await ctx.db.query("screenings").withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id)).collect()).sort((a, b) => b._creationTime - a._creationTime);
  const s = screenings[0]?.status;
  const screening = !s ? "none" : s === "confirmed_match" ? "confirmed" : s === "potential_match" ? "potential" : "clear";
  let modelProbability: number | null = null;
  const latest = payments.sort((a, b) => b.sentAt - a.sentAt)[0];
  if (latest) {
    try { modelProbability = (await assessSentPayment(ctx, latest))?.probability ?? null; } catch { modelProbability = null; }
  }
  const t = trustScore({ now, vendorOnboardedAt: vendor.onboardedAt, landedPayments, unconfirmedPayments, lastBankChangeAt, screening, modelProbability, openCases });
  return { ...t, vendorId: vendor._id, vendorName: vendor.name, computedAt: now };
}
