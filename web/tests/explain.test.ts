import { describe, it, expect } from "vitest";
import { grounded, templateNarration } from "../convex/explain";

describe("explain grounding", () => {
  const facts = ["a bank-change request opened the case", "a vendor statement was received (channel email, not accepted (untrusted_channel))", "the release gate refused (reason confirmation_not_accepted)"];
  it("template narration is grounded", () => {
    expect(grounded(templateNarration(facts, "AWAITING_CONFIRMATION"), facts, "AWAITING_CONFIRMATION")).toBe(true);
  });
  it("rejects invented numbers and names", () => {
    expect(grounded("The vendor Dana confirmed $42,000 arrived.", facts, "AWAITING_CONFIRMATION")).toBe(false);
    expect(grounded("A statement arrived by email and was not accepted; the gate refused.", facts, "AWAITING_CONFIRMATION")).toBe(true);
  });
});
