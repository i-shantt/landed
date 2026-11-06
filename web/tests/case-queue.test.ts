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

import { parseQueueParams, queueParamsToSearch, QUEUE_DEFAULTS, SAVED_VIEWS, isSavedViewActive } from "../lib/case-queue";
describe("queue state in the URL", () => {
  it("round-trips through the search string and writes only non-default keys in a stable order", () => {
    const s = { query: " Blue ", filter: "attention" as const, sort: "amount" as const, source: "demo" as const };
    const search = queueParamsToSearch(s);
    expect(search).toBe("q=Blue&filter=attention&sort=amount&source=demo");
    expect(parseQueueParams(new URLSearchParams(search))).toEqual({ ...s, query: "Blue" });
    expect(queueParamsToSearch(QUEUE_DEFAULTS)).toBe("");
    expect(queueParamsToSearch({ ...QUEUE_DEFAULTS, sort: "newest" })).toBe("sort=newest");
  });
  it("ignores unknown values and clamps the search text", () => {
    const s = parseQueueParams(new URLSearchParams("filter=everything&sort=DESC&source=prod&q=" + "x".repeat(500)));
    expect(s.filter).toBe("all");
    expect(s.sort).toBe("priority");
    expect(s.source).toBe("all");
    expect(s.query).toHaveLength(200);
  });
  it("a saved view is active only when its keys match and the others sit at their defaults", () => {
    const ready = SAVED_VIEWS.find((v) => v.key === "ready")!;
    expect(isSavedViewActive(ready, { ...QUEUE_DEFAULTS, filter: "ready", sort: "amount" })).toBe(true);
    expect(isSavedViewActive(ready, { ...QUEUE_DEFAULTS, filter: "ready", sort: "amount", query: "clean" })).toBe(true);
    expect(isSavedViewActive(ready, { ...QUEUE_DEFAULTS, filter: "ready", sort: "amount", source: "demo" })).toBe(false);
    expect(isSavedViewActive(ready, { ...QUEUE_DEFAULTS, filter: "ready" })).toBe(false);
    const demo = SAVED_VIEWS.find((v) => v.key === "demo")!;
    expect(isSavedViewActive(demo, { ...QUEUE_DEFAULTS, source: "demo" })).toBe(true);
    expect(isSavedViewActive(demo, { ...QUEUE_DEFAULTS, source: "demo", filter: "closed" })).toBe(false);
    // every saved view resolves to a parseable link
    for (const v of SAVED_VIEWS) expect(isSavedViewActive(v, parseQueueParams(new URLSearchParams(queueParamsToSearch({ ...QUEUE_DEFAULTS, ...v.state }))))).toBe(true);
  });
});
