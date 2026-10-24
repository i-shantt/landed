import { describe, it, expect } from "vitest";
import { parseAuthResults } from "../convex/emlIntake";
import { canonical, chainOver } from "../convex/audit";

describe("eml auth parsing", () => {
  it("reads pass/fail from Authentication-Results and reports absence", () => {
    expect(parseAuthResults("mx; spf=pass smtp.mailfrom=x; dkim=pass header.d=x; dmarc=pass (p=reject)")).toMatchObject({ spf: true, dkim: true, dmarc: true, present: true });
    expect(parseAuthResults("mx; spf=softfail; dkim=fail; dmarc=fail")).toMatchObject({ spf: false, dkim: false, dmarc: false, present: true });
    expect(parseAuthResults(null)).toMatchObject({ present: false, dmarc: null });
  });
});

describe("audit hash chain", () => {
  it("is deterministic and order-sensitive", async () => {
    const a = [{ at: 1, actor: "system", type: "case_opened", payload: { b: 1, a: 2 } }, { at: 2, actor: "human", type: "payment_refused", payload: { reason: "x" } }];
    const c1 = await chainOver(a);
    const c2 = await chainOver(a);
    const c3 = await chainOver([a[1], a[0]]);
    expect(c1.head).toBe(c2.head);
    expect(c1.head).not.toBe(c3.head);
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
