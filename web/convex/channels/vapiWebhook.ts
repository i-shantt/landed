// Vapi webhook handling: extracts the stated amount from the `tool-calls` message or
// the `end-of-call-report`, runs the LEAK CHECK on assistant turns, and only then
// records a confirmation through the normal channel path. A leaked amount means the
// probe is burned: the confirmation is recorded as rejected and a fresh probe is created.
import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { append } from "../events";
import { createProbe } from "../probes";
import { now } from "../clock";
import { HOUR } from "../clock";

export const AMOUNT_LEAK = /\$?\d+\.\d{2}/;

export type Turn = { role: string; message?: string; content?: string };

export function assistantLeakedAmount(turns: Turn[]): boolean {
  return turns.some((t) => (t.role === "assistant" || t.role === "bot") && AMOUNT_LEAK.test(t.message ?? t.content ?? ""));
}

/** Pull {statedAmountCents, reachedRecordContact, notes, transcriptTurns} out of either Vapi message shape. */
export function parseVapiMessage(msg: Record<string, unknown>): { kind: string; stated?: number | null; reached?: boolean; notes?: string; turns: Turn[]; caseId?: string; contactId?: string; mode?: string; paymentId?: string } {
  const kind = String(msg.type ?? "");
  const call = (msg.call ?? {}) as Record<string, unknown>;
  // Current Vapi shape: the assistant (with our metadata) is echoed on every server message and on the call.
  const assistantMeta = ((msg.assistant as Record<string, unknown> | undefined)?.metadata ?? (call.assistant as Record<string, unknown> | undefined)?.metadata ?? ((call.assistantOverrides as Record<string, unknown> | undefined)?.metadata)) as Record<string, unknown> | undefined;
  const metadata: Record<string, unknown> = { ...((call.metadata as Record<string, unknown>) ?? {}), ...((msg.metadata as Record<string, unknown>) ?? {}), ...(assistantMeta ?? {}) };
  // Last resort: the call name is `landed:<caseId>:<mode>` (buildCallBody).
  const nm = typeof call.name === "string" ? /^landed:([^:]+):(probe|landing)$/.exec(call.name) : null;
  if (!metadata.caseId && nm) { metadata.caseId = nm[1]; metadata.mode = nm[2]; }
  const artifact = (msg.artifact ?? {}) as Record<string, unknown>;
  const turns = ((artifact.messages ?? msg.messages ?? []) as Turn[]).filter((t) => t && typeof t === "object");
  let stated: number | null | undefined;
  let reached: boolean | undefined;
  let notes: string | undefined;
  const toolCalls = (msg.toolCallList ?? msg.toolCalls ?? []) as { function?: { name?: string; arguments?: unknown } }[];
  for (const tc of toolCalls) {
    if (tc.function?.name !== "recordStatedAmount") continue;
    const a = typeof tc.function.arguments === "string" ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : ((tc.function.arguments ?? {}) as Record<string, unknown>);
    stated = typeof a.statedAmountCents === "number" ? a.statedAmountCents : null;
    reached = !!a.reachedRecordContact;
    notes = typeof a.notes === "string" ? a.notes : undefined;
  }
  if (stated === undefined && kind === "end-of-call-report") {
    // Some configurations deliver the tool call only inside the artifact.
    for (const t of turns as (Turn & { toolCalls?: { function?: { name?: string; arguments?: unknown } }[] })[]) {
      for (const tc of t.toolCalls ?? []) {
        if (tc.function?.name !== "recordStatedAmount") continue;
        const a = typeof tc.function.arguments === "string" ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : ((tc.function.arguments ?? {}) as Record<string, unknown>);
        stated = typeof a.statedAmountCents === "number" ? a.statedAmountCents : null;
        reached = !!a.reachedRecordContact;
      }
    }
  }
  return { kind, stated, reached, notes, turns, caseId: metadata.caseId as string | undefined, contactId: metadata.contactId as string | undefined, mode: metadata.mode as string | undefined, paymentId: (metadata.paymentId as string | undefined) ?? undefined };
}

export const handle = internalAction({
  args: { payload: v.any() },
  handler: async (ctx, { payload }) => {
    const p = payload as Record<string, unknown>;
    const msg = (p.message ?? p) as Record<string, unknown>;
    const parsed = parseVapiMessage(msg);
    if (!parsed.caseId) return;
    const caseId = parsed.caseId as Id<"cases">;
    if (parsed.kind !== "tool-calls" && parsed.kind !== "end-of-call-report") {
      await ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_webhook_received", payload: { type: parsed.kind } });
      return;
    }
    if (parsed.stated === undefined) {
      await ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_no_statement", payload: { type: parsed.kind, note: "call ended without a recordStatedAmount tool call" } });
      return;
    }
    if (assistantLeakedAmount(parsed.turns)) {
      await ctx.runMutation(internal.channels.vapiWebhook.burnProbe, { caseId, contactId: parsed.contactId as Id<"contacts"> | undefined });
      return;
    }
    await ctx.runMutation(internal.confirmations.recordFromChannelInternal, {
      caseId,
      channel: "voice",
      contactId: parsed.contactId as Id<"contacts"> | undefined,
      statedAmountCents: parsed.stated,
      outcome: parsed.reached === false ? "no_answer" : parsed.stated === null ? "nothing_arrived" : "stated",
      transcript: `[vapi] ${parsed.notes ?? ""}`.slice(0, 2000),
      mode: parsed.mode === "landing" ? "landing" : "probe",
    });
  },
});

/** The assistant said a dollar amount out loud: record a rejected confirmation and issue a fresh probe. */
export const burnProbe = internalMutation({
  args: { caseId: v.id("cases"), contactId: v.optional(v.id("contacts")) },
  handler: async (ctx, { caseId, contactId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return;
    const account = await ctx.db.get(c.newAccountId);
    if (!account) return;
    const t = await now(ctx);
    const confirmationId = await ctx.db.insert("confirmations", {
      caseId, vendorId: c.vendorId, accountHash: account.accountHash, accountVersion: account.version, probeId: c.probeId,
      channel: "voice", contactId, receivedAt: t, expiresAt: t + 2 * HOUR, accepted: false, rejectReason: "agent_leaked_amount", mode: "probe",
    });
    await append(ctx, { caseId, actor: "system", type: "agent_leaked_amount", payload: { confirmationId, note: "assistant turn contained a dollar amount; statement discarded and probe re-issued" } });
    const existing = await ctx.db.query("probes").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    await createProbe(ctx, caseId, existing.length);
  },
});
