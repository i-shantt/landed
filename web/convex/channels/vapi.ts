// Vapi voice channel (optional; VOICE=vapi + VAPI_API_KEY + VAPI_PHONE_NUMBER_ID).
// Dials ONLY numbers listed in TEST_PHONE_NUMBERS. The assistant never receives the
// probe amount (I7): its prompt asks the vendor to read back what arrived and forbids
// stating or guessing any amount. The webhook (channels/vapiWebhook.ts) runs a leak
// check on the assistant's turns before any statement is recorded.
//
// Request shape checked against Vapi's OpenAPI spec (https://api.vapi.ai/api-json) on 2026-10-24:
// POST https://api.vapi.ai/call with an inline `assistant` whose webhooks go to `assistant.server.url`
// (`end-of-call-report`, `tool-calls`); the case binding rides on `assistant.metadata`.
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ConfirmationChannel } from "./types";

/** E.164 normalization: "(555) 010-0000", "555-010-0000", "1 555 010 0000", "+1 555 010 0000" all become "+15550100000". */
export function normalizePhone(raw: string): string | null {
  const s = (raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  if (s.startsWith("+")) return digits.length >= 8 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 8 ? `+${digits}` : null;
}

/** The dialing allow-list, normalized, so formatting differences never cause a refusal or an unintended match. */
export function allowedTestNumbers(): Set<string> {
  return new Set((process.env.TEST_PHONE_NUMBERS ?? "").split(",").map((s) => normalizePhone(s)).filter((x): x is string => !!x));
}

// Vapi validates the Anthropic model name against its own list (claude-sonnet-5, claude-haiku-5-5, ...);
// ANTHROPIC_MODEL (claude-sonnet-5-5, used by intake) is not on it, so the voice model is chosen separately.
export const VAPI_MODEL_DEFAULT = "claude-sonnet-5";
export function vapiModel(): string {
  return process.env.VAPI_MODEL ?? VAPI_MODEL_DEFAULT;
}

export type VapiCallMetadata = { caseId: string; contactId: string; mode: "probe" | "landing"; paymentId?: string | null };

export function buildAssistant(args: { companyName: string; vendorName: string; mode: "probe" | "landing"; expectedPaymentAmountCents?: number; serverUrl: string; metadata?: VapiCallMetadata }) {
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
      model: vapiModel(),
      messages: [{ role: "system", content: system }],
      tools: [
        {
          type: "function",
          async: false,
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
        { type: "endCall" },
      ],
    },
    // Current Vapi API: webhooks go to `server.url` (the old top-level `serverUrl` and `endCallFunctionEnabled`
    // are no longer accepted and make POST /call return 400); the call itself has no metadata field, so the
    // case binding travels on the assistant's metadata and comes back on every server message.
    server: { url: args.serverUrl },
    serverMessages: ["end-of-call-report", "tool-calls"],
    maxDurationSeconds: 180,
  };
  if (args.metadata) assistant.metadata = args.metadata;
  if (process.env.CARTESIA_VOICE_ID) {
    const voice: Record<string, unknown> = { provider: "cartesia", voiceId: process.env.CARTESIA_VOICE_ID };
    if (process.env.CARTESIA_MODEL) voice.model = process.env.CARTESIA_MODEL;
    assistant.voice = voice;
  }
  return assistant;
}

/** The exact POST https://api.vapi.ai/call body. Exported so a test can pin the shape. */
export function buildCallBody(args: { phoneNumberId: string; toNumber: string; vendorName: string; assistant: Record<string, unknown>; metadata: VapiCallMetadata }) {
  return {
    name: `landed:${args.metadata.caseId}:${args.metadata.mode}`,
    phoneNumberId: args.phoneNumberId,
    customer: { number: args.toNumber, name: args.vendorName },
    assistant: args.assistant,
  };
}

export class VapiVoice implements ConfirmationChannel {
  name = "voice" as const;
  constructor(private ctx: ActionCtx) {}
  async initiate(args: { caseId: string; contact: Doc<"contacts">; mode: "probe" | "landing"; expectedPaymentAmountCents?: number; paymentId?: string }) {
    const caseId = args.caseId as Id<"cases">;
    const allowed = allowedTestNumbers();
    const toNumber = normalizePhone(args.contact.value);
    if (!toNumber || !allowed.has(toNumber)) {
      await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_refused", payload: { reason: "number_not_in_TEST_PHONE_NUMBERS", contactId: args.contact._id, allowListSize: allowed.size } });
      return;
    }
    const metadata: VapiCallMetadata = { caseId, contactId: args.contact._id, mode: args.mode, paymentId: args.paymentId ?? null };
    const apiKey = process.env.VAPI_API_KEY;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    const siteUrl = process.env.CONVEX_SITE_URL;
    const dryRun = process.env.VAPI_DRY_RUN === "1";
    if (dryRun) {
      // Build the exact request, redact it, record it, do not dial. Flip VAPI_DRY_RUN off to go live.
      const info = await this.ctx.runQuery(internal.channels.vapiMutations.names, { caseId });
      const assistant = buildAssistant({ companyName: info?.companyName ?? "the company", vendorName: info?.vendorName ?? "the vendor", mode: args.mode, expectedPaymentAmountCents: args.mode === "landing" ? args.expectedPaymentAmountCents : undefined, serverUrl: `${siteUrl ?? "https://<convex-site>"}/vapi/webhook`, metadata });
      const leak = args.mode === "probe" && /\$?\d+\.\d{2}/.test(JSON.stringify(assistant));
      const full = buildCallBody({ phoneNumberId: phoneNumberId ? "<set>" : "<unset>", toNumber, vendorName: info?.vendorName ?? "the vendor", assistant, metadata });
      const request = { ...full, customer: { ...full.customer, number: toNumber.replace(/\d(?=\d{4})/g, "*") }, assistant: { ...assistant, model: { ...(assistant.model as object), messages: "[system prompt, " + JSON.stringify((assistant.model as { messages: { content: string }[] }).messages[0].content).length + " chars]" } } };
      await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_dry_run", payload: { request, assistantContainsAmount: leak, apiKeyPresent: !!apiKey, note: "VAPI_DRY_RUN=1: request built and logged, nothing dialed" } });
      return;
    }
    if (!apiKey || !phoneNumberId || !siteUrl) {
      await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_refused", payload: { reason: "vapi_env_missing", contactId: args.contact._id } });
      return;
    }
    const info = await this.ctx.runQuery(internal.channels.vapiMutations.names, { caseId });
    const assistant = buildAssistant({ companyName: info?.companyName ?? "the company", vendorName: info?.vendorName ?? "the vendor", mode: args.mode, expectedPaymentAmountCents: args.mode === "landing" ? args.expectedPaymentAmountCents : undefined, serverUrl: `${siteUrl}/vapi/webhook`, metadata });
    // Belt and braces: the assistant config must never contain a sub-dollar amount.
    if (args.mode === "probe" && /\$?\d+\.\d{2}/.test(JSON.stringify(assistant))) throw new Error("refusing to dial: assistant config contains an amount");
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(buildCallBody({ phoneNumberId, toNumber, vendorName: info?.vendorName ?? "the vendor", assistant, metadata })),
    });
    const text = await res.text();
    if (!res.ok) {
      // Redacted: Vapi error bodies echo field names, never the key; the dialed number is not included.
      await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_failed", payload: { status: res.status, body: text.slice(0, 300), hint: res.status === 401 ? "API key" : res.status === 400 ? "request shape: phone number id, customer number, or assistant config" : res.status === 402 || res.status === 403 ? "credits or number restrictions" : "see Vapi dashboard" } });
      return;
    }
    const call = JSON.parse(text) as { id?: string };
    await this.ctx.runMutation(internal.channels.vapiMutations.note, { caseId, type: "voice_call_placed", payload: { vapiCallId: call.id ?? null, contactId: args.contact._id, mode: args.mode } });
  }
}
