// The learned layer and the monitoring layer are read-only and are not imported by the payment boundary.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "convex");
const collect = (d: string, out: string[] = []) => {
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
};
const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const readOnlyDirs = ["risk", "monitoring"].map((d) => join(root, d));
const readOnlyFiles = readOnlyDirs.flatMap((d) => collect(d)).map((f) => [f.replace(root + "/", ""), strip(readFileSync(f, "utf8"))] as const);

describe("learned and monitoring layers cannot release money", () => {
  it("covers the model files", () => {
    const names = readOnlyFiles.map(([f]) => f);
    expect(names).toContain("risk/model/assessPayment.ts");
    expect(names).toContain("risk/model/linear.ts");
  });
  it("never write to the database, schedule work, or call mutations", () => {
    for (const [f, s] of readOnlyFiles) {
      expect(s, f).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\(/);
      expect(s, f).not.toMatch(/ctx\.scheduler\./);
      expect(s, f).not.toMatch(/runMutation\(/);
      expect(s, f).not.toMatch(/\b(mutation|internalMutation|action|internalAction)\(/);
    }
  });
  it("never import the guard or the payment mutation", () => {
    for (const [f, s] of readOnlyFiles) {
      expect(s, f).not.toMatch(/from\s+"[./]*guard"/);
      expect(s, f).not.toMatch(/from\s+"[./]*payments"/);
      expect(s, f).not.toMatch(/from\s+"[./]*cases"/);
    }
  });
  it("the frozen boundary does not import the model or monitoring", () => {
    for (const f of ["payments.ts", "guard.ts", "cases.ts"]) {
      const s = strip(readFileSync(join(root, f), "utf8"));
      expect(s, f).not.toMatch(/risk\/model|monitoring\//);
    }
  });
  it("exported weights are data, not code", () => {
    for (const f of ["transaction_lr.json", "email_tfidf_lr.json"]) {
      const parsed = JSON.parse(readFileSync(join(root, "risk", "weights", f), "utf8"));
      expect(typeof parsed.version).toBe("string");
    }
  });
});
