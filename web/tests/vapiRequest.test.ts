import { describe, it, expect, afterEach } from "vitest";
import { buildAssistant, buildCallBody, normalizePhone, allowedTestNumbers, vapiModel, VAPI_MODEL_DEFAULT } from "../convex/channels/vapi";
import { parseVapiMessage, assistantLeakedAmount } from "../convex/channels/vapiWebhook";

// Model names Vapi's OpenAPI spec (2026-10-24) accepts for provider "anthropic".
const VAPI_ANTHROPIC_MODELS = ["claude-sonnet-5", "claude-haiku-5-5", "claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"];

describe("Vapi request shape (checked against Vapi's OpenAPI spec)", () => {
  afterEach(() => { delete process.env.CARTESIA_VOICE_ID; delete process.env.CARTESIA_MODEL; delete process.env.VAPI_MODEL; delete process.env.TEST_PHONE_NUMBERS; });

  it("builds an assistant with server.url, serverMessages, a Cartesia voice, an allowed Anthropic model and no removed fields", () => {
    process.env.CARTESIA_VOICE_ID = "voice-123";
    const a = buildAssistant({ companyName: "Meridian", vendorName: "CleanCo", mode: "probe", serverUrl: "https://x.convex.site/vapi/webhook", metadata: { caseId: "c1", contactId: "k1", mode: "probe", paymentId: null } });
    expect(a).not.toHaveProperty("serverUrl");
    expect(a).not.toHaveProperty("endCallFunctionEnabled");
    expect(a.server).toEqual({ url: "https://x.convex.site/vapi/webhook" });
    expect(a.serverMessages).toEqual(["end-of-call-report", "tool-calls"]);
    expect(a.voice).toEqual({ provider: "cartesia", voiceId: "voice-123" });
    expect(a.metadata).toEqual({ caseId: "c1", contactId: "k1", mode: "probe", paymentId: null });
    const model = a.model as { provider: string; model: string; messages: { role: string }[]; tools: { type: string; server?: { url: string }; async?: boolean }[] };
    expect(model.provider).toBe("anthropic");
    expect(VAPI_ANTHROPIC_MODELS).toContain(model.model);
    expect(model.messages[0].role).toBe("system");
    expect(model.tools.map((t) => t.type)).toEqual(["function", "endCall"]);
    expect(model.tools[0].server).toEqual({ url: "https://x.convex.site/vapi/webhook" });
    expect(model.tools[0].async).toBe(false);
    expect(assistantLeakedAmount([{ role: "assistant", message: JSON.stringify(a) }])).toBe(false);
  });

  it("VAPI_MODEL overrides the voice model; the default is on Vapi's list and is not the intake model", () => {
    expect(vapiModel()).toBe(VAPI_MODEL_DEFAULT);
    expect(VAPI_ANTHROPIC_MODELS).toContain(VAPI_MODEL_DEFAULT);
    expect(VAPI_MODEL_DEFAULT).not.toBe("claude-sonnet-5-5");
    process.env.VAPI_MODEL = "claude-haiku-5-5";
    expect(vapiModel()).toBe("claude-haiku-5-5");
  });

  it("the call body has no top-level metadata and carries the case in the call name and the assistant", () => {
    const assistant = buildAssistant({ companyName: "Meridian", vendorName: "CleanCo", mode: "landing", expectedPaymentAmountCents: 4200000, serverUrl: "https://x/vapi/webhook", metadata: { caseId: "c1", contactId: "k1", mode: "landing", paymentId: "p1" } });
    const body = buildCallBody({ phoneNumberId: "pn", toNumber: "+15550100060", vendorName: "CleanCo", assistant, metadata: { caseId: "c1", contactId: "k1", mode: "landing", paymentId: "p1" } });
    expect(Object.keys(body).sort()).toEqual(["assistant", "customer", "name", "phoneNumberId"]);
    expect(body.name).toBe("landed:c1:landing");
    expect(body.customer).toEqual({ number: "+15550100060", name: "CleanCo" });
  });

  it("normalizes phone numbers to E.164 and compares the allow-list on normalized strings", () => {
    expect(normalizePhone("(555) 010-0060")).toBe("+15550100060");
    expect(normalizePhone("555-010-0060")).toBe("+15550100060");
    expect(normalizePhone("1 555 010 0060")).toBe("+15550100060");
    expect(normalizePhone("+1 555 010 0060")).toBe("+15550100060");
    expect(normalizePhone("+15550100060")).toBe("+15550100060");
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
    process.env.TEST_PHONE_NUMBERS = " +1 (555) 010-0060 , 5550100061";
    expect([...allowedTestNumbers()].sort()).toEqual(["+15550100060", "+15550100061"]);
  });
});

describe("Vapi webhook parsing (current server-message shape)", () => {
  const assistant = { name: "Landed verification", metadata: { caseId: "case_1", contactId: "contact_1", mode: "probe", paymentId: null } };

  it("tool-calls: reads the stated amount from toolCallList and the case from assistant.metadata", () => {
    const msg = { type: "tool-calls", call: { id: "call_1", name: "landed:case_1:probe", assistantOverrides: {} }, assistant, toolCallList: [{ id: "tc_1", type: "function", function: { name: "recordStatedAmount", arguments: { statedAmountCents: 47, reachedRecordContact: true, notes: "AR clerk read it back" } } }], toolWithToolCallList: [] };
    const p = parseVapiMessage(msg);
    expect(p.kind).toBe("tool-calls");
    expect(p.caseId).toBe("case_1");
    expect(p.contactId).toBe("contact_1");
    expect(p.mode).toBe("probe");
    expect(p.stated).toBe(47);
    expect(p.reached).toBe(true);
  });

  it("tool-calls: arguments as a JSON string and null for nothing arrived", () => {
    const msg = { type: "tool-calls", assistant, toolCallList: [{ id: "tc_2", type: "function", function: { name: "recordStatedAmount", arguments: JSON.stringify({ statedAmountCents: null, reachedRecordContact: true, notes: "" }) } }] };
    const p = parseVapiMessage(msg);
    expect(p.stated).toBeNull();
    expect(p.caseId).toBe("case_1");
  });

  it("end-of-call-report: falls back to the tool call inside artifact.messages and to the call name when metadata is missing", () => {
    const msg = { type: "end-of-call-report", endedReason: "assistant-ended-call", analysis: {}, call: { id: "call_1", name: "landed:case_9:landing" }, artifact: { messages: [{ role: "bot", message: "Hello, this is the accounts payable team." }, { role: "user", message: "Forty-two thousand dollars arrived." }, { role: "tool_calls", toolCalls: [{ id: "tc_3", type: "function", function: { name: "recordStatedAmount", arguments: "{\"statedAmountCents\":4200000,\"reachedRecordContact\":true,\"notes\":\"\"}" } }] }] } };
    const p = parseVapiMessage(msg);
    expect(p.caseId).toBe("case_9");
    expect(p.mode).toBe("landing");
    expect(p.stated).toBe(4200000);
    expect(assistantLeakedAmount(p.turns)).toBe(false);
  });

  it("leak check catches an assistant turn that says a dollar amount", () => {
    expect(assistantLeakedAmount([{ role: "bot", message: "Was it $0.47?" }])).toBe(true);
  });
});
