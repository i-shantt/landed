// Vapi voice channel (optional; VOICE=vapi + VAPI_API_KEY). Dials ONLY numbers in
// TEST_PHONE_NUMBERS. The assistant never receives the probe amount. Wired in
// Tier 3 (section 9 step 17); until then initiate() records a refusal event.
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ConfirmationChannel } from "./types";

export function allowedTestNumbers(): Set<string> {
  return new Set((process.env.TEST_PHONE_NUMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export class VapiVoice implements ConfirmationChannel {
  name = "voice" as const;
  constructor(private ctx: ActionCtx) {}
  async initiate(args: { caseId: string; contact: Doc<"contacts">; mode: "probe" | "landing"; expectedPaymentAmountCents?: number; paymentId?: string }) {
    const allowed = allowedTestNumbers();
    if (!allowed.has(args.contact.value)) {
      await this.ctx.runMutation(internal.channels.vapiMutations.note, {
        caseId: args.caseId as Id<"cases">,
        type: "voice_call_refused",
        payload: { reason: "number_not_in_TEST_PHONE_NUMBERS", contactId: args.contact._id },
      });
      return;
    }
    await this.ctx.runMutation(internal.channels.vapiMutations.note, {
      caseId: args.caseId as Id<"cases">,
      type: "voice_call_not_implemented",
      payload: { reason: "VapiVoice.initiate is not wired yet; see OPEN_QUESTIONS.md", contactId: args.contact._id },
    });
  }
}
