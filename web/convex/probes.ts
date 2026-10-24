// Probe deposits (Nacha Micro-Entry pattern, "ACCTVERIFY"). The amount is secret:
// only internal functions read it, public queries project it away (I7).
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { append } from "./events";
import { now, nextAchWindow, availabilityFor, HOUR } from "./clock";
import { createTimer } from "./timers";
import { transition } from "./cases";
import { decryptAccount } from "./crypto";
import { selectRail } from "./rails/select";

export const PROBE_MIN_CENTS = 11;
export const PROBE_MAX_CENTS = 99;

export function drawProbeAmount(rand: () => number = Math.random): number {
  return PROBE_MIN_CENTS + Math.floor(rand() * (PROBE_MAX_CENTS - PROBE_MIN_CENTS + 1));
}

/** Idempotent by `probe:{caseId}` (or `probe:{caseId}:r{n}` for a re-probe). */
export async function createProbe(ctx: MutationCtx, caseId: Id<"cases">, retry = 0): Promise<Id<"probes">> {
  const idempotencyKey = retry === 0 ? `probe:${caseId}` : `probe:${caseId}:r${retry}`;
  const existing = await ctx.db.query("probes").withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey)).unique();
  if (existing) return existing._id;
  const c = await ctx.db.get(caseId);
  if (!c) throw new Error("case not found");
  const account = await ctx.db.get(c.newAccountId);
  if (!account) throw new Error("account not found");
  const t = await now(ctx);
  const amountCents = drawProbeAmount();
  const probeId = await ctx.db.insert("probes", {
    caseId,
    accountId: account._id,
    accountHash: account.accountHash,
    amountCents,
    idempotencyKey,
    state: "submitted",
    submittedAt: t,
  });
  await ctx.db.patch(caseId, { probeId });
  if (account.status === "unverified") await ctx.db.patch(account._id, { status: "probing" });
  const window = nextAchWindow(t);
  const availableAt = availabilityFor(window);
  await createTimer(ctx, { caseId, kind: "probe_settle", dueAt: window, payload: { probeId } });
  await createTimer(ctx, { caseId, kind: "probe_available", dueAt: availableAt, payload: { probeId } });
  if (c.state === "HELD") {
    await transition(ctx, caseId, "PROBE_SENT", {
      actor: "system",
      type: "probe_submitted",
      payload: { probeId, memo: "ACCTVERIFY", expectedSettleAt: window, expectedAvailableAt: availableAt, retry },
    });
  } else {
    await append(ctx, { caseId, actor: "system", type: "probe_resubmitted", payload: { probeId, expectedSettleAt: window, expectedAvailableAt: availableAt, retry } });
  }
  await ctx.scheduler.runAfter(0, internal.probes.submitToRail, { probeId });
  return probeId;
}

export const createInternal = internalMutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => createProbe(ctx, caseId),
});

export const getForRail = internalQuery({
  args: { probeId: v.id("probes") },
  handler: async (ctx, { probeId }) => {
    const p = await ctx.db.get(probeId);
    if (!p) return null;
    const a = await ctx.db.get(p.accountId);
    if (!a) return null;
    return { probe: p, routing: a.routing, accountCiphertext: a.accountCiphertext };
  },
});

export const setRailRef = internalMutation({
  args: { probeId: v.id("probes"), railRef: v.string(), railName: v.string() },
  handler: async (ctx, { probeId, railRef, railName }) => {
    const p = await ctx.db.get(probeId);
    if (!p) return;
    if (p.railRef) return;
    await ctx.db.patch(probeId, { railRef });
    await append(ctx, { caseId: p.caseId, actor: "rail", type: "probe_accepted_by_rail", payload: { probeId, rail: railName, railRef } });
  },
});

export const recordRailError = internalMutation({
  args: { probeId: v.id("probes"), error: v.string() },
  handler: async (ctx, { probeId, error }) => {
    const p = await ctx.db.get(probeId);
    if (!p) return;
    await append(ctx, { caseId: p.caseId, actor: "rail", type: "probe_rail_error", payload: { probeId, error } });
  },
});

export const submitToRail = internalAction({
  args: { probeId: v.id("probes") },
  handler: async (ctx, { probeId }) => {
    const data = await ctx.runQuery(internal.probes.getForRail, { probeId });
    if (!data) return;
    if (data.probe.railRef) return; // already submitted
    try {
      const accountNumber = await decryptAccount(data.accountCiphertext);
      const rail = await selectRail(ctx);
      const { railRef } = await rail.sendCredit({
        routing: data.routing,
        accountNumber,
        amountCents: data.probe.amountCents,
        memo: "ACCTVERIFY",
        idempotencyKey: data.probe.idempotencyKey,
      });
      await ctx.runMutation(internal.probes.setRailRef, { probeId, railRef, railName: rail.name });
    } catch (e) {
      await ctx.runMutation(internal.probes.recordRailError, { probeId, error: String((e as Error)?.message ?? e) });
    }
  },
});

export async function markSettled(ctx: MutationCtx, probeId: Id<"probes">) {
  const p = await ctx.db.get(probeId);
  if (!p || p.state !== "submitted") return;
  const t = await now(ctx);
  await ctx.db.patch(probeId, { state: "settled", settledAt: t });
  const owner = await ctx.db.get(p.caseId);
  if (owner && owner.state !== "CLOSED") await append(ctx, { caseId: p.caseId, actor: "rail", type: "probe_settled", payload: { probeId } });
  if (p.railRef) await ctx.scheduler.runAfter(0, internal.rails.sim.setEntryState, { railRef: p.railRef, state: "settled" });
}

export async function markAvailable(ctx: MutationCtx, probeId: Id<"probes">) {
  const p = await ctx.db.get(probeId);
  if (!p || p.state === "available" || p.state === "returned") return;
  const t = await now(ctx);
  await ctx.db.patch(probeId, { state: "available", availableAt: t, settledAt: p.settledAt ?? t });
  const c = await ctx.db.get(p.caseId);
  if (c && c.state !== "CLOSED") await append(ctx, { caseId: p.caseId, actor: "rail", type: "probe_available", payload: { probeId } });
  if (p.railRef) await ctx.scheduler.runAfter(0, internal.rails.sim.setEntryState, { railRef: p.railRef, state: "available" });
  if (!c || c.state !== "PROBE_SENT" || c.probeId !== probeId) return;
  const slaAt = t + 24 * HOUR;
  await ctx.db.patch(c._id, { slaDeadlineAt: slaAt });
  await createTimer(ctx, { caseId: c._id, kind: "confirmation_sla", dueAt: slaAt });
  await transition(ctx, c._id, "AWAITING_CONFIRMATION", { actor: "system", type: "awaiting_confirmation", payload: { slaDeadlineAt: slaAt } });
  await ctx.scheduler.runAfter(0, internal.channels.initiate.initiateConfirmation, { caseId: c._id });
}

export const markSettledInternal = internalMutation({
  args: { probeId: v.id("probes") },
  handler: async (ctx, { probeId }) => markSettled(ctx, probeId),
});
export const markAvailableInternal = internalMutation({
  args: { probeId: v.id("probes") },
  handler: async (ctx, { probeId }) => markAvailable(ctx, probeId),
});

/** Public projection. Never includes amountCents. */
export const getPublic = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c || !c.probeId) return null;
    const p = await ctx.db.get(c.probeId);
    if (!p) return null;
    return { state: p.state, submittedAt: p.submittedAt, settledAt: p.settledAt, availableAt: p.availableAt, railRef: p.railRef };
  },
});

/** TEST-ONLY. Served by GET /eval/probeAmount/{caseId} behind EVAL_KEY. Never call from UI. */
export const amountForTest = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c || !c.probeId) return null;
    const p = await ctx.db.get(c.probeId);
    return p ? p.amountCents : null;
  },
});
