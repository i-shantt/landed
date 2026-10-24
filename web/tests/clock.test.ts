import { describe, it, expect } from "vitest";
import { zonedToUtc, nextAchWindow, availabilityFor, endOfBusinessDay, NY, zonedParts } from "../convex/clock";

const iso = (t: number) => new Date(t).toISOString();

describe("clock", () => {
  it("zonedToUtc round-trips wall clock in New York (EDT)", () => {
    expect(iso(zonedToUtc(2026, 10, 26, 13, 0, NY))).toBe("2026-10-26T17:00:00.000Z");
    expect(iso(zonedToUtc(2026, 10, 26, 17, 0, NY))).toBe("2026-10-26T21:00:00.000Z");
  });
  it("zonedToUtc handles EST after the DST change", () => {
    expect(iso(zonedToUtc(2026, 11, 2, 13, 0, NY))).toBe("2026-11-02T18:00:00.000Z");
  });
  it("zonedToUtc handles day overflow", () => {
    const p = zonedParts(zonedToUtc(2026, 10, 31 + 1, 12, 0, NY), NY);
    expect([p.m, p.d]).toEqual([11, 1]);
  });
  it("nextAchWindow: Saturday morning rolls to Monday 13:00 ET", () => {
    const sat = Date.UTC(2026, 9, 24, 7, 23); // Sat Oct 24 2026 03:23 ET
    expect(iso(nextAchWindow(sat))).toBe("2026-10-26T17:00:00.000Z");
  });
  it("nextAchWindow: Monday 14:00 ET -> 17:00 ET; 17:30 -> 18:00; 18:30 -> Tuesday 13:00", () => {
    expect(iso(nextAchWindow(Date.UTC(2026, 9, 26, 18, 0)))).toBe("2026-10-26T21:00:00.000Z");
    expect(iso(nextAchWindow(Date.UTC(2026, 9, 26, 21, 30)))).toBe("2026-10-26T22:00:00.000Z");
    expect(iso(nextAchWindow(Date.UTC(2026, 9, 26, 22, 30)))).toBe("2026-10-27T17:00:00.000Z");
  });
  it("nextAchWindow: Friday after 18:00 ET -> Monday", () => {
    expect(iso(nextAchWindow(Date.UTC(2026, 9, 23, 23, 0)))).toBe("2026-10-26T17:00:00.000Z");
  });
  it("availabilityFor: first window -> 13:30 receiver-local (LA) same day", () => {
    const w = zonedToUtc(2026, 10, 26, 13, 0, NY); // 10:00 LA
    expect(iso(availabilityFor(w))).toBe("2026-10-26T20:30:00.000Z"); // 13:30 PDT
  });
  it("availabilityFor: second -> 17:00 LA; third -> 18:00 LA", () => {
    expect(iso(availabilityFor(zonedToUtc(2026, 10, 26, 17, 0, NY)))).toBe("2026-10-27T00:00:00.000Z");
    expect(iso(availabilityFor(zonedToUtc(2026, 10, 26, 18, 0, NY)))).toBe("2026-10-27T01:00:00.000Z");
  });
  it("endOfBusinessDay is 18:00 LA (next day if passed)", () => {
    expect(iso(endOfBusinessDay(Date.UTC(2026, 9, 26, 17, 0)))).toBe("2026-10-27T01:00:00.000Z");
    expect(iso(endOfBusinessDay(Date.UTC(2026, 9, 27, 2, 0)))).toBe("2026-10-28T01:00:00.000Z");
  });
});
