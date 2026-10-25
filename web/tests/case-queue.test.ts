import { describe, it, expect } from "vitest";
import { selectQueue, isBlocked, nextCaseAction } from "../lib/case-queue";
const cases = [
  {
    _id: "closed",
    vendorName: "NorthPeak",
    state: "CLOSED",
    amountAtStakeCents: 0,
    openedAt: 30,
  },
  {
    _id: "review",
    vendorName: "Bluewater",
    state: "NEEDS_HUMAN",
    amountAtStakeCents: 985000,
    openedAt: 20,
  },
  {
    _id: "recovery",
    vendorName: "Granite Ridge",
    state: "RECOVERY",
    amountAtStakeCents: 2340000,
    openedAt: 10,
  },
  {
    _id: "verified",
    vendorName: "CleanCo",
    state: "VERIFIED",
    amountAtStakeCents: 4200000,
    openedAt: 40,
  },
];
describe("case queue", () => {
  it("puts recovery and manual review ahead of newer, completed records without changing source order", () => {
    expect(selectQueue(cases, "", "all", "priority").map((c) => c._id)).toEqual(
      ["recovery", "review", "verified", "closed"],
    );
    expect(cases[0]._id).toBe("closed");
  });
  it("combines vendor search with the selected work category", () => {
    expect(
      selectQueue(cases, "  BLUEwater ", "attention", "priority").map(
        (c) => c._id,
      ),
    ).toEqual(["review"]);
    expect(selectQueue(cases, "Bluewater", "closed", "priority")).toEqual([]);
  });
  it("does not count verified or closed accounts as payment holds", () => {
    expect(
      selectQueue(cases, "", "blocked", "amount").map((c) => c._id),
    ).toEqual(["recovery", "review"]);
    expect(isBlocked("LANDED")).toBe(false);
    expect(isBlocked("PAID")).toBe(false);
  });
  it("sorts amounts independently of priority and preserves a path to completed records", () => {
    expect(selectQueue(cases, "", "all", "amount")[0]._id).toBe("verified");
    expect(selectQueue(cases, "", "closed", "newest")[0]._id).toBe("closed");
    expect(nextCaseAction("RECOVERY")).toBe("Open recovery");
    expect(nextCaseAction("CLOSED")).toBe("View record");
  });
});
