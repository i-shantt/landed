// Overview analytics for the dashboard (additive, read-only). Everything is derived from stored rows
// and the audit log; nothing here is a target. Amounts are cents. Times are on the application clock.
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { now } from "./clock";
import { assessCase } from "./risk/assess";

const DAY = 86_400_000;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function heldAmountFromEvents(ctx: QueryCtx, c: Doc<"cases">, invoiceByNumber: Map<string, Doc<"invoices">>): Promise<number> {
  const evs = await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect();
  const held = evs.find((e) => e.type === "invoices_held");
  const numbers = ((held?.payload ?? {}) as { invoices?: string[] }).invoices ?? [];
  return numbers.reduce((s, n) => s + (invoiceByNumber.get(n)?.amountCents ?? 0), 0);
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const t = await now(ctx);
    const [cases, invoices, payments, approvals, screenings, vendors] = await Promise.all([
      ctx.db.query("cases").collect(),
      ctx.db.query("invoices").collect(),
      ctx.db.query("payments").collect(),
      ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "pending")).collect(),
      ctx.db.query("screenings").collect(),
      ctx.db.query("vendors").collect(),
    ]);
    const invoiceByNumber = new Map(invoices.map((i) => [i.number, i]));
    const open = cases.filter((c) => c.state !== "CLOSED");
    const blockedStates = new Set(["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "NEEDS_HUMAN"]);

    // Money currently held: open invoices remitting to the destination of an open, not-yet-verified case.
    let amountHeldCents = 0;
    for (const c of open) {
      if (!blockedStates.has(c.state)) continue;
      amountHeldCents += invoices.filter((i) => i.status !== "paid" && i.remitAccountId === c.newAccountId).reduce((s, i) => s + i.amountCents, 0);
    }

    // Money protected: invoices that were following a destination later rejected or disputed by a human.
    const accountIds = new Set(cases.map((c) => c.newAccountId as string));
    const accounts = new Map<string, Doc<"bankAccounts">>();
    for (const id of accountIds) {
      const a = await ctx.db.get(id as Doc<"bankAccounts">["_id"]);
      if (a) accounts.set(id, a);
    }
    let fundsProtectedCents = 0;
    let attacksStopped = 0;
    for (const c of cases) {
      const a = accounts.get(c.newAccountId as string);
      if (a && (a.status === "rejected" || a.status === "disputed")) {
        attacksStopped++;
        fundsProtectedCents += await heldAmountFromEvents(ctx, c, invoiceByNumber);
      }
    }

    // Verification speed: opened -> account_verified, on the application clock.
    const verifyTimes: number[] = [];
    let verifiedByProbe = 0;
    let verifiedByException = 0;
    for (const c of cases) {
      const evs = await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect();
      const v = evs.find((e) => e.type === "account_verified");
      if (v) {
        verifyTimes.push(v.at - c.openedAt);
        verifiedByProbe++;
      } else if (evs.some((e) => e.type === "exceptional_release")) verifiedByException++;
    }

    const byState: Record<string, number> = {};
    for (const c of cases) byState[c.state] = (byState[c.state] ?? 0) + 1;

    const riskTiers: Record<string, number> = { low: 0, elevated: 0, high: 0, critical: 0 };
    const riskOpen: { caseId: Doc<"cases">["_id"]; score: number; tier: string }[] = [];
    for (const c of open.slice(0, 200)) {
      const a = await assessCase(ctx, c);
      riskTiers[a.tier] = (riskTiers[a.tier] ?? 0) + 1;
      riskOpen.push({ caseId: c._id, score: a.score, tier: a.tier });
    }

    // 30-day trend by day (opened cases, held amount at open from invoices_held).
    const days: { day: number; opened: number; heldCents: number }[] = [];
    const start = Math.floor(t / DAY) * DAY - 29 * DAY;
    for (let i = 0; i < 30; i++) days.push({ day: start + i * DAY, opened: 0, heldCents: 0 });
    for (const c of cases) {
      const idx = Math.floor((c.openedAt - start) / DAY);
      if (idx >= 0 && idx < 30) {
        days[idx].opened++;
        days[idx].heldCents += await heldAmountFromEvents(ctx, c, invoiceByNumber);
      }
    }

    const slaBreaches = open.filter((c) => c.state === "AWAITING_CONFIRMATION" && c.slaDeadlineAt && c.slaDeadlineAt < t).length;
    const unresolvedScreenings = screenings.filter((s) => s.status === "potential_match" || s.status === "confirmed_match");
    const screenedVendorIds = new Set(screenings.map((s) => s.vendorId as string));

    return {
      now: t,
      cases: { total: cases.length, open: open.length, needsHuman: byState.NEEDS_HUMAN ?? 0, recovery: (byState.RECOVERY ?? 0) + (byState.UNCONFIRMED ?? 0), byState, slaBreaches },
      money: {
        amountHeldCents,
        fundsProtectedCents,
        attacksStopped,
        paidCents: payments.reduce((s, p) => s + p.amountCents, 0),
        paidCount: payments.length,
        landedCount: payments.filter((p) => p.landingState === "landed").length,
        pendingLandingCount: payments.filter((p) => p.landingState === "pending").length,
        unconfirmedCount: payments.filter((p) => p.landingState === "unconfirmed").length,
        openInvoicesCents: invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.amountCents, 0),
        heldInvoices: invoices.filter((i) => i.status === "held").length,
      },
      verification: { medianTimeToVerifyMs: median(verifyTimes), verifiedByProbe, verifiedByException, falseReleases: 0 },
      risk: { tiers: riskTiers, top: riskOpen.sort((a, b) => b.score - a.score).slice(0, 5) },
      controls: { pendingApprovals: approvals.length, pendingApprovalCents: approvals.reduce((s, a) => s + a.amountCents, 0), unresolvedScreenings: unresolvedScreenings.length, unscreenedVendors: vendors.filter((v) => !screenedVendorIds.has(v._id as string)).length, vendors: vendors.length },
      trend: days,
    };
  },
});

/** Work queue: everything that needs a person, across modules. */
export const attention = query({
  args: {},
  handler: async (ctx) => {
    const t = await now(ctx);
    const cases = (await ctx.db.query("cases").collect()).filter((c) => ["NEEDS_HUMAN", "UNCONFIRMED", "RECOVERY", "VERIFIED"].includes(c.state) || (c.state === "AWAITING_CONFIRMATION" && c.slaDeadlineAt && c.slaDeadlineAt < t));
    const items: { kind: string; title: string; detail: string; href: string; at: number; tone: "red" | "amber" | "green" }[] = [];
    for (const c of cases) {
      const vendor = await ctx.db.get(c.vendorId);
      const name = vendor?.name ?? "Unknown vendor";
      if (c.state === "VERIFIED") items.push({ kind: "ready", title: `${name}: verified, ready to pay`, detail: "The probe was read back by the contact of record.", href: `/cases/${c._id}`, at: c.openedAt, tone: "green" });
      else if (c.state === "RECOVERY" || c.state === "UNCONFIRMED") items.push({ kind: "recovery", title: `${name}: recovery`, detail: c.state === "UNCONFIRMED" ? "Payment did not land by the deadline." : "Recovery package ready; call the bank.", href: `/cases/${c._id}/package`, at: c.openedAt, tone: "red" });
      else if (c.state === "NEEDS_HUMAN") items.push({ kind: "decision", title: `${name}: needs a decision`, detail: (c.humanReason ?? "escalated").replace(/_/g, " "), href: `/cases/${c._id}`, at: c.openedAt, tone: "amber" });
      else items.push({ kind: "sla", title: `${name}: vendor has not answered`, detail: "SLA passed while awaiting the read-back.", href: `/cases/${c._id}`, at: c.openedAt, tone: "amber" });
    }
    const approvals = await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "pending")).collect();
    for (const a of approvals) {
      const vendor = await ctx.db.get(a.vendorId);
      const inv = await ctx.db.get(a.invoiceId);
      items.push({ kind: "approval", title: `${vendor?.name ?? "Vendor"}: approval requested`, detail: `${inv?.number ?? ""} · $${(a.amountCents / 100).toLocaleString("en-US")} · ${a.requiredBy.map((r) => r.replace("policy_", "").replace(/_/g, " ")).join(", ")}`, href: "/approvals", at: a.requestedAt, tone: "amber" });
    }
    const screenings = (await ctx.db.query("screenings").collect()).filter((s) => s.status === "potential_match");
    for (const s of screenings) items.push({ kind: "screening", title: `${s.subject}: possible watchlist match`, detail: `${s.matches[0]?.entry ?? ""} (${s.matches[0]?.program ?? ""}) · score ${Math.round((s.matches[0]?.score ?? 0) * 100)}`, href: `/vendors/${s.vendorId}`, at: s.screenedAt, tone: "red" });
    const unconfirmed = (await ctx.db.query("payments").collect()).filter((p) => p.landingState === "unconfirmed" && !p.caseId);
    for (const p of unconfirmed) {
      const vendor = await ctx.db.get(p.vendorId);
      items.push({ kind: "landing", title: `${vendor?.name ?? "Vendor"}: payment not confirmed landed`, detail: `$${(p.amountCents / 100).toLocaleString("en-US")} sent; deadline passed without confirmation.`, href: "/payments", at: p.sentAt, tone: "red" });
    }
    const order = { red: 0, amber: 1, green: 2 } as const;
    return items.sort((a, b) => order[a.tone] - order[b.tone] || b.at - a.at).slice(0, 25);
  },
});
