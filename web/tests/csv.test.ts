import { describe, it, expect } from "vitest";
import { toCsv, csvCell } from "../lib/csv";

describe("toCsv (RFC 4180)", () => {
  it("quotes every field, doubles quotes, ends records with CRLF", () => {
    const out = toCsv(["a", "b"], [["x,y", 'say "hi"'], [1, null]]);
    expect(out).toBe('"a","b"\r\n"x,y","say ""hi"""\r\n"1",""\r\n');
  });
  it("writes dates as ISO 8601 and objects as JSON", () => {
    expect(csvCell(new Date(Date.UTC(2026, 9, 25, 17, 30)))).toBe('"2026-10-25T17:30:00.000Z"');
    expect(csvCell({ k: 1 })).toBe('"{""k"":1}"');
    expect(csvCell(undefined)).toBe('""');
  });
});
