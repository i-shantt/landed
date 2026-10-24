import { describe, it, expect } from "vitest";
import { assistantLeakedAmount, parseVapiMessage } from "../convex/channels/vapiWebhook";
import { buildAssistant } from "../convex/channels/vapi";
import { proseNumbersAreGrounded, buildFields } from "../convex/packageTemplates";
import { extractWithRules, abaChecksumOk } from "../convex/extractors/rules";

describe("vapi leak check", () => {
  it("flags an assistant turn containing a dollar amount", () => {
    expect(assistantLeakedAmount([{ role: "assistant", message: "Was it $0.37?" }])).toBe(true);
    expect(assistantLeakedAmount([{ role: "assistant", message: "Please read back the exact amount." }, { role: "user", message: "It was 37 cents, $0.37" }])).toBe(false);
  });
  it("parses the tool-calls message shape", () => {
    const p = parseVapiMessage({ type: "tool-calls", call: { metadata: { caseId: "c1", contactId: "k1", mode: "probe" } }, toolCallList: [{ function: { name: "recordStatedAmount", arguments: { statedAmountCents: 37, reachedRecordContact: true, notes: "AR desk" } } }] });
    expect(p.stated).toBe(37);
    expect(p.caseId).toBe("c1");
    expect(p.reached).toBe(true);
  });
  it("probe-mode assistant config never contains an amount", () => {
    const a = buildAssistant({ companyName: "Meridian", vendorName: "CleanCo", mode: "probe", serverUrl: "https://x/vapi/webhook" });
    expect(JSON.stringify(a)).not.toMatch(/\$?\d+\.\d{2}/);
  });
});

describe("package prose grounding", () => {
  const fields = buildFields({
    caseDoc: { _id: "c1", state: "RECOVERY", openedAt: 0, vendorId: "v", newAccountId: "a", triggerType: "x", contactAlsoChanged: false, _creationTime: 0 } as never,
    vendor: { name: "CleanCo" } as never, account: { routing: "011000015", last4: "5678", version: 1, status: "disputed" },
    payment: { amountCents: 4200000, sentAt: 1_793_000_000_000, rail: "ach", railRef: "ACH-123" } as never, invoice: { number: "CC-1" } as never,
    company: { name: "Meridian", bankRouting: "121000358", bankLast4: "0001" } as never, companyAccount: { routing: "121000358", last4: "0001" }, events: [], now: 1_793_000_000_000 + 3600_000,
  });
  it("accepts prose whose numbers all come from the fields", () => {
    expect(proseNumbersAreGrounded(`We sent $42,000.00 by ACH, trace ACH-123, to routing 011000015 account ending 5678 within 72 hours.`, fields)).toBe(true);
  });
  it("rejects invented numbers", () => {
    expect(proseNumbersAreGrounded(`We sent $42,500.00 to account ending 9999.`, fields)).toBe(false);
  });
});

describe("rules extractor", () => {
  it("validates ABA checksums", () => {
    expect(abaChecksumOk("011000015")).toBe(true);
    expect(abaChecksumOk("011000016")).toBe(false);
  });
  it("finds a change with routing and account; ignores benign text", () => {
    const r = extractWithRules("We have changed banks. Routing (ABA): 011000015, account number 900012345678.");
    expect(r.changed).toBe(true);
    expect(r.newRouting).toBe("011000015");
    expect(r.newAccountNumber).toBe("900012345678");
    expect(extractWithRules("PO numbers 4500123456 and tracking 1Z999AA10123456784, no billing changes.").changed).toBe(false);
  });
  it("detects a receipt claim", () => {
    expect(extractWithRules("We received your $0.37 deposit today.").receiptClaimCents).toBe(37);
  });
});
