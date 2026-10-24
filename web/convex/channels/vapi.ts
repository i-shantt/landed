// Vapi voice channel (optional; VOICE=vapi + VAPI_API_KEY + VAPI_PHONE_NUMBER_ID).
// Dials ONLY numbers listed in TEST_PHONE_NUMBERS. The assistant never receives the
// probe amount (I7): its prompt asks the vendor to read back what arrived and forbids
// stating or guessing any amount. The webhook (channels/vapiWebhook.ts) runs a leak
// check on the assistant's turns before any statement is recorded.
//
// Status: written against the public Vapi REST shape (POST https://api.vapi.ai/call
// with an inline `assistant`, server-url webhooks delivering `end-of-call-report` and
// `tool-calls` messages). No VAPI_API_KEY was available during the build, so this path
// is NOT verified against the live service. See OPEN_QUESTIONS.md.
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ConfirmationChannel } from "./types";

export function allowedTestNumbers(): Set<string> {
  return new Set((process.env.TEST_PHONE_NUMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function buildAssistant(args: { companyName: string; vendorName: string; mode: "probe" | "landing"; expectedPaymentAmountCents?: number; serverUrl: string }) {
  const landing = args.mode === "landing";
  const expected = landing && args.expectedPaymentAmountCents !== undefined ? `$${(args.expectedPaymentAmountCents / 100).toFixed(2)}` : undefined;
  const system = [
    `You are calling on behalf of the accounts payable team at ${args.companyName}. You are speaking with ${args.vendorName}, a vendor.`,
    landing
      ? `Purpose: confirm that a payment of ${expected} from ${args.companyName} has arrived in their bank account. Ask them to check today's incoming payments and read back the exact amount that arrived.`
      : `Purpose: verify a new bank account before any payment is sent. Ask the person to check today's incoming deposits from ${args.companyName} and read back the exact amount of the small test deposit.`,
    `Rules: never state, suggest, confirm, or guess any amount yourself${landing ? " other than the expected payment amount above" : ""}. Do not say what the deposit "should" be. If they cannot check right now, politely offer to call back and end the call.`,
    `When the person states an amount (or says nothing arrived), call the recordStatedAmount tool exactly once with the amount in cents (or null) and then end the call. Do not call the tool more than once.`,
    `Keep the call under two minutes. Be courteous and plain.`,
  ].join(" ");
  const assistant: Record<string, unknown> = {
    name: "Landed verification",
    firstMessage: `Hello, this is the accounts payable team at ${args.companyName} calling about ${landing ? "confirming a payment we sent" : "verifying a deposit to your bank account"}. Do you have a moment?`,
    model: {
      provider: "anthropic",
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      messages: [{ role: "system", content: system }],
      tools: [
        {
          type: "function",
          function: {
            name: "recordStatedAmount",
            description: "Record what the vendor said arrived in their account. Call exactly once.",
            parameters: {
              type: "object",
              properties: {
                statedAmountCents: { type: ["integer", "null"], description: "Amount the vendor read back, in cents; null if they said nothing arrived" },
                reachedRecordContact: { type: "boolean", description: "true if you spoke with the vendor's accounts receivable or finance contact" },
                notes: { type: "string" },
              },
              required: ["statedAmountCents", "reachedRecordContact", "notes"],
            },
          },
          server: { url: args.serverUrl },
        },
      ],
    },
    serverUrl: args.serverUrl,
    serverMessages: ["end-of-call-report", "tool-calls"],
    endCallFunctionEnabled: true,
    maxDurationSeconds: 180,
  };
  if (process.env.CARTESIA_VOICE_ID) assistant.voice = { provider: "cartesia", voiceId: process.env.CARTESIA_VOICE_ID };
  return assistant;
}

export class VapiVoice implements ConfirmationChannel {
  name = "voice" as const;
  constructor(private ctx: ActionCtx) {}
  async initiate(args: { caseId: string; contact: Doc<"contacts">; mode: "probe" | "landing"; expectedPaymentAmountCents?: number; paymentId?: string }) {
    const caseId = args.caseId as Id<"cases">;
    const allowed = allowedTestNumbers();
    if (!allowed.has(args.contact.value)) {
      await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_refused", payload: { reason: "number_not_in_TEST_PHONE_NUMBERS", contactId: args.contact._id } });
      return;
    }
    const apiKey = process.env.VAPI_API_KEY;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!apiKey || !phoneNumberId || !siteUrl) {
      await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_refused", payload: { reason: "vapi_env_missing", contactId: args.contact._id } });
      return;
    }
    const info = await this.ctx.runQuery(internal.channels.vapiMutations.names, { caseId });
    const assistant = buildAssistant({ companyName: info?.companyName ?? "the company", vendorName: info?.vendorName ?? "the vendor", mode: args.mode, expectedPaymentAmountCents: args.mode === "landing" ? args.expectedPaymentAmountCents : undefined, serverUrl: `${siteUrl}/vapi/webhook` });
    // Belt and braces: the assistant config must never contain a sub-dollar amount.
    if (args.mode === "probe" && /\$?\d+\.\d{2}/.test(JSON.stringify(assistant))) throw new Error("refusing to dial: assistant config contains an amount");
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        phoneNumberId,
        customer: { number: args.contact.value },
        assistant,
        metadata: { caseId, contactId: args.contact._id, mode: args.mode, paymentId: args.paymentId ?? null },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_failed", payload: { status: res.status, body: text.slice(0, 300) } });
      return;
    }
    const call = JSON.parse(text) as { id?: string };
    await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_placed", payload: { vapiCallId: call.id ?? null, contactId: args.contact._id, mode: args.mode } });
  }
}
