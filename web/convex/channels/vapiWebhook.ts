// Vapi webhook handling. Leak check + recordFromChannel. Tier 3; until wired,
// payloads are logged as events with no effect on any case.
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const AMOUNT_LEAK = /\$?\d+\.\d{2}/;

export function assistantLeakedAmount(transcriptTurns: { role: string; message: string }[]): boolean {
  return transcriptTurns.some((t) => (t.role === "assistant" || t.role === "bot") && AMOUNT_LEAK.test(t.message));
}

export const handle = internalAction({
  args: { payload: v.any() },
  handler: async (ctx, { payload }) => {
    const p = payload as Record<string, unknown>;
    const msg = (p.message ?? p) as Record<string, unknown>;
    console.log("[vapi] webhook received type=", msg.type);
    const caseId = ((msg.call as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined)?.caseId;
    if (!caseId) return;
    await ctx.runMutation(internal.channels.vapiMutations.note, { caseId: caseId as never, type: "voice_webhook_received", payload: { type: msg.type } });
  },
});
