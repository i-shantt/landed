// Vapi webhook handling: extracts the stated amount from the `tool-calls` message or
// the `end-of-call-report`, runs the LEAK CHECK on assistant turns, and only then
// records a confirmation through the normal channel path. A leaked amount means the
// probe is burned: the confirmation is recorded as rejected and a fresh probe is created.
import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { append } from "../events";
import { createProbe } from "../probes";
import { transition } from "../cases";
import { now } from "../clock";
import { HOUR } from "../clock";

export const AMOUNT_LEAK = /\$?\d+\.\d{2}/;

export type Turn = { role: string; message?: string; content?: string };

export function assistantLeakedAmount(turns: Turn[]): boolean {
  return turns.some((t) => (t.role === "assistant" || t.role === "bot") && AMOUNT_LEAK.test(t.message ?? t.content ?? ""));
}

/** Pull {statedAmountCents, reachedRecordContact, notes, transcriptTurns} out of either Vapi message shape. */
export function parseVapiMessage(msg: Record<string, unknown>): { kind: string; stated?: number | null; reached?: boolean; notes?: string; turns: Turn[]; caseId?: string; contactId?: string; mode?: string; paymentId?: string; callId?: string; malformed?: string } {
  const kind = String(msg.type ?? "");
  const call = (msg.call ?? {}) as Record<string, unknown>;
  const callId = typeof call.id === "string" ? call.id : undefined;
  let malformed: string | undefined;
  const parseArgs = (raw: unknown): Record<string, unknown> => {
    if (typeof raw !== "string") return (raw ?? {}) as Record<string, unknown>;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      malformed = "tool arguments are not valid JSON";
      return {};
    }
  };
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
    const a = parseArgs(tc.function.arguments);
    if (malformed) continue;
    stated = typeof a.statedAmountCents === "number" ? a.statedAmountCents : null;
    reached = !!a.reachedRecordContact;
    notes = typeof a.notes === "string" ? a.notes : undefined;
  }
  if (stated === undefined && kind === "end-of-call-report") {
    // Some configurations deliver the tool call only inside the artifact.
    for (const t of turns as (Turn & { toolCalls?: { function?: { name?: string; arguments?: unknown } }[] })[]) {
      for (const tc of t.toolCalls ?? []) {
        if (tc.function?.name !== "recordStatedAmount") continue;
        const a = parseArgs(tc.function.arguments);
        if (malformed) continue;
        stated = typeof a.statedAmountCents === "number" ? a.statedAmountCents : null;
        reached = !!a.reachedRecordContact;
      }
    }
  }
  return { kind, stated, reached, notes, turns, caseId: metadata.caseId as string | undefined, contactId: metadata.contactId as string | undefined, mode: metadata.mode as string | undefined, paymentId: (metadata.paymentId as string | undefined) ?? undefined, callId, malformed };
}

/** Did the assistant (or the tool-call notes it wrote) carry a dollar amount? */
export function leakedAmount(turns: Turn[], notes?: string): boolean {
  return assistantLeakedAmount(turns) || (!!notes && AMOUNT_LEAK.test(notes));
}

export const handle = internalAction({
  args: { payload: v.any() },
  handler: async (ctx, { payload }) => {
    const p = payload as Record<string, unknown>;
    const msg = (p.message ?? p) as Record<string, unknown>;
    const parsed = parseVapiMessage(msg);
    // Binding: only a call Landed placed, and only while the voice channel is Vapi. Body metadata is forensic only.
    const bound = parsed.callId ? await ctx.runQuery(internal.channels.vapiMutations.resolveCall, { vapiCallId: parsed.callId }) : { call: null, voice: "sim" };
    if (!bound.call) {
      await ctx.runMutation(internal.channels.vapiMutations.noteUnbound, { claimedCaseId: parsed.caseId, callId: parsed.callId, type: "voice_webhook_unbound" });
      return;
    }
    if (bound.voice !== "vapi") {
      await ctx.runMutation(internal.channels.vapiMutations.noteUnbound, { claimedCaseId: bound.call.caseId, callId: parsed.callId, type: "voice_webhook_ignored", detail: `voice channel is ${bound.voice}` });
      return;
    }
    const caseId = bound.call.caseId;
    const contactId = bound.call.contactId;
    const mode = bound.call.mode;
    if (parsed.malformed) {
      await ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_webhook_malformed", payload: { type: parsed.kind, detail: parsed.malformed } });
      return;
    }
    if (parsed.kind !== "tool-calls" && parsed.kind !== "end-of-call-report") {
      await ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_webhook_received", payload: { type: parsed.kind } });
      return;
    }
    if (parsed.stated === undefined) {
      await ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_no_statement", payload: { type: parsed.kind, note: "call ended without a recordStatedAmount tool call" } });
      return;
    }
    if (mode === "probe" && leakedAmount(parsed.turns, parsed.notes)) {
      await ctx.runMutation(internal.channels.vapiWebhook.burnProbe, { caseId, contactId });
      return;
    }
    await ctx.runMutation(internal.confirmations.recordFromChannelInternal, {
      caseId,
      channel: "voice",
      contactId,
      statedAmountCents: parsed.stated,
      outcome: parsed.reached === false ? "no_answer" : parsed.stated === null ? "nothing_arrived" : "stated",
      transcript: `[vapi] ${parsed.notes ?? ""}`.slice(0, 2000),
      mode,
    });
  },
});

/** How many times a probe may be re-issued after an assistant leak before a human takes over. */
export const MAX_REISSUES = 1;

/**
 * The assistant said a dollar amount out loud: record a rejected confirmation, return the case to
 * PROBE_SENT and issue a fresh probe (bounded). The old probe is useless because whoever was on the
 * call now knows its amount. On a repeated leak the case goes to a human instead of burning more probes.
 */
export const burnProbe = internalMutation({
  args: { caseId: v.id("cases"), contactId: v.optional(v.id("contacts")) },
  handler: async (ctx, { caseId, contactId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return;
    const account = await ctx.db.get(c.newAccountId);
    if (!account) return;
    if (c.state !== "AWAITING_CONFIRMATION") {
      await append(ctx, { caseId, actor: "system", type: "agent_leaked_amount", payload: { note: `leak reported while case is ${c.state}; nothing re-issued` } });
      return;
    }
    const t = await now(ctx);
    const confirmationId = await ctx.db.insert("confirmations", {
      caseId, vendorId: c.vendorId, accountHash: account.accountHash, accountVersion: account.version, probeId: c.probeId,
      channel: "voice", contactId, receivedAt: t, expiresAt: t + 2 * HOUR, accepted: false, rejectReason: "agent_leaked_amount", mode: "probe",
    });
    const existing = await ctx.db.query("probes").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    if (existing.length > MAX_REISSUES) {
      await append(ctx, { caseId, actor: "system", type: "agent_leaked_amount", payload: { confirmationId, note: "assistant leaked an amount again; escalating instead of issuing another probe" } });
      await transition(ctx, caseId, "NEEDS_HUMAN", { actor: "system", type: "escalated", payload: { reason: "repeated_assistant_leak" } }, "repeated_assistant_leak");
      return;
    }
    await append(ctx, { caseId, actor: "system", type: "agent_leaked_amount", payload: { confirmationId, note: "assistant turn contained a dollar amount; statement discarded and probe re-issued" } });
    // Back to PROBE_SENT so the new probe's availability re-runs confirmation and a fresh SLA.
    await ctx.db.patch(caseId, { slaDeadlineAt: undefined });
    await transition(ctx, caseId, "PROBE_SENT", { actor: "system", type: "probe_reissued", payload: { previousProbeId: c.probeId ?? null } });
    await createProbe(ctx, caseId, existing.length);
  },
});
