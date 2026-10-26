// Simulated voice channel. Reads a scenario-provided vendor statement from
// settings (`simVendorStatement:{caseId}` / `simVendorStatement:landing:{paymentId}`)
// set by the eval harness or by a human on the case page ("Simulate vendor
// answer"). If none is set, it records `sim_voice_waiting` so the UI shows the control.
import { internalMutation, mutation } from "../_generated/server";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { assertDemoControls } from "../controls/demoGuard";
import { internal } from "../_generated/api";
import type { ConfirmationChannel } from "./types";
import { getSetting, setSetting } from "../settings";
import { append } from "../events";
import { recordFromChannel } from "../confirmations";
import { recordPhoneContact } from "../contacts";

export type SimStatement = { statedAmountCents: number | null; outcome: "stated" | "nothing_arrived" | "no_answer" };

export function parseStatement(raw: string | null): SimStatement | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<SimStatement>;
    const outcome = j.outcome ?? (j.statedAmountCents == null ? "nothing_arrived" : "stated");
    return { statedAmountCents: typeof j.statedAmountCents === "number" ? j.statedAmountCents : null, outcome };
  } catch {
    return null;
  }
}

export class SimVoice implements ConfirmationChannel {
  name = "sim_voice" as const;
  constructor(private ctx: ActionCtx) {}
  async initiate(args: { caseId: string; contact: Doc<"contacts">; mode: "probe" | "landing"; expectedPaymentAmountCents?: number; paymentId?: string }) {
    await this.ctx.runMutation(internal.channels.simVoice.deliver, {
      caseId: args.caseId as Id<"cases">,
      contactId: args.contact._id,
      mode: args.mode,
      paymentId: args.paymentId as Id<"payments"> | undefined,
    });
  }
}

export function statementKey(mode: "probe" | "landing", caseId: Id<"cases">, paymentId?: Id<"payments">) {
  return mode === "landing" ? `simVendorStatement:landing:${paymentId ?? caseId}` : `simVendorStatement:${caseId}`;
}

/** Called when the (simulated) call is placed. Uses a pre-set statement if any. */
export const deliver = internalMutation({
  args: { caseId: v.id("cases"), contactId: v.id("contacts"), mode: v.union(v.literal("probe"), v.literal("landing")), paymentId: v.optional(v.id("payments")) },
  handler: async (ctx, { caseId, contactId, mode, paymentId }) => {
    const key = statementKey(mode, caseId, paymentId);
    const stmt = parseStatement(await getSetting(ctx, key));
    await append(ctx, { caseId, actor: "agent", type: "sim_voice_call_placed", payload: { contactId, mode, note: "simulated call to the phone number of record; no real call is made" } });
    if (!stmt) {
      await append(ctx, { caseId, actor: "agent", type: "sim_voice_waiting", payload: { mode, note: "no scripted vendor statement; use 'Simulate vendor answer' on the case page" } });
      return { delivered: false };
    }
    await recordFromChannel(ctx, { caseId, channel: "sim_voice", contactId, statedAmountCents: stmt.statedAmountCents, outcome: stmt.outcome, mode, transcript: `[simulated] vendor stated: ${stmt.outcome === "stated" ? "an amount" : stmt.outcome}` });
    return { delivered: true };
  },
});

/**
 * Set the simulated vendor statement and deliver it now if the case is waiting.
 * Human/eval only. Labeled "simulated vendor answer" in the UI.
 */
export async function setStatementAndDeliver(
  ctx: MutationCtx,
  args: { caseId: Id<"cases">; statedAmountCents: number | null; outcome?: "stated" | "nothing_arrived" | "no_answer"; mode?: "probe" | "landing" }
) {
  const c = await ctx.db.get(args.caseId);
  if (!c) throw new ConvexError("case_not_found");
  const voice = (await getSetting(ctx, "voice")) ?? "sim";
  if (voice !== "sim") throw new ConvexError("voice_channel_is_not_sim");
  const mode = args.mode ?? (c.state === "PAID" ? "landing" : "probe");
  const outcome = args.outcome ?? (args.statedAmountCents == null ? "nothing_arrived" : "stated");
  const stmt: SimStatement = { statedAmountCents: args.statedAmountCents, outcome };
  await setSetting(ctx, statementKey(mode, c._id, c.paymentId), JSON.stringify(stmt));
  const contact = await recordPhoneContact(ctx, c.vendorId);
  if (!contact) {
    await append(ctx, { caseId: c._id, actor: "system", type: "sim_voice_no_record_contact", payload: {} });
    return { delivered: false, reason: "no_record_phone_contact" };
  }
  if (mode === "probe" && c.state !== "AWAITING_CONFIRMATION") {
    // Statement stored; it will be used when the probe becomes available.
    await append(ctx, { caseId: c._id, actor: "human", type: "sim_voice_statement_scripted", payload: { mode, outcome, note: "will be used when the simulated call is placed" } });
    return { delivered: false, reason: `case_state_${c.state}` };
  }
  if (mode === "landing" && c.state !== "PAID") {
    await append(ctx, { caseId: c._id, actor: "human", type: "sim_voice_statement_scripted", payload: { mode, outcome } });
    return { delivered: false, reason: `case_state_${c.state}` };
  }
  const res = await recordFromChannel(ctx, { caseId: c._id, channel: "sim_voice", contactId: contact._id, statedAmountCents: args.statedAmountCents, outcome, mode, transcript: `[simulated] vendor stated: ${outcome === "stated" ? "an amount" : outcome}` });
  return { delivered: true, accepted: res.accepted, rejectReason: res.rejectReason };
}

export const answer = mutation({
  args: {
    caseId: v.id("cases"),
    statedAmountCents: v.union(v.number(), v.null()),
    outcome: v.optional(v.union(v.literal("stated"), v.literal("nothing_arrived"), v.literal("no_answer"))),
    mode: v.optional(v.union(v.literal("probe"), v.literal("landing"))),
  },
  handler: async (ctx, args) => {
    await assertDemoControls(ctx);
    return setStatementAndDeliver(ctx, args);
  },
});

export const answerInternal = internalMutation({
  args: {
    caseId: v.id("cases"),
    statedAmountCents: v.union(v.number(), v.null()),
    outcome: v.optional(v.union(v.literal("stated"), v.literal("nothing_arrived"), v.literal("no_answer"))),
    mode: v.optional(v.union(v.literal("probe"), v.literal("landing"))),
  },
  handler: async (ctx, args) => setStatementAndDeliver(ctx, args),
});
