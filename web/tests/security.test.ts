// Static checks for SECURITY.md: the only places that can verify an account, write a payment,
// or read a probe amount are the ones documented, and none of them is a public function.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "convex");
const files: string[] = [];
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === "_generated") continue; if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
walk(root);
// Type-only files carry the literals as unions, not writes; comments are stripped before matching.
const stripComments = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const src = Object.fromEntries(files.filter((f) => !f.endsWith("fixtureTypes.ts")).map((f) => [f.replace(root + "/", ""), stripComments(readFileSync(f, "utf8"))]));

describe("security surface", () => {
  it("only cases.ts flips an account to verified", () => {
    const hits = Object.entries(src).filter(([f, s]) => /status:\s*"verified"/.test(s) && !f.startsWith("seed") && f !== "guard.ts" && !f.startsWith("tests"));
    expect(hits.map(([f]) => f).sort()).toEqual(["cases.ts"]);
  });
  it("only payments.ts inserts payments", () => {
    const hits = Object.entries(src).filter(([, s]) => s.includes('.insert("payments"'));
    expect(hits.map(([f]) => f)).toEqual(["payments.ts"]);
  });
  it("probe amounts are read only by internal functions", () => {
    // amountForTest is an internalQuery; its callers must be internal (judge/seedDemo actions) or the dev-gated HTTP route.
    expect(/export const amountForTest = internalQuery/.test(src["probes.ts"])).toBe(true);
    const callers = Object.entries(src).filter(([f, s]) => f !== "probes.ts" && s.includes("amountForTest")).map(([f]) => f).sort();
    expect(callers).toEqual(["http.ts", "judge.ts", "seedDemo.ts"]);
    expect(src["http.ts"]).toMatch(/EVAL_PROBE_AMOUNT_ENDPOINT !== "1"\) return json\(\{ error: "not_found" \}, 404\)/);
    // the public projection never carries the amount
    expect(src["probes.ts"]).toMatch(/getPublic = query[\s\S]*return \{ state: p\.state, submittedAt: p\.submittedAt, settledAt: p\.settledAt, availableAt: p\.availableAt, railRef: p\.railRef \}/);
  });
  it("trust level 'record' is only written by seed and the human-attested paths (addRecordContact, onboarding)", () => {
    const hits = Object.entries(src).filter(([, s]) => /trustLevel:\s*"record"/.test(s)).map(([f]) => f).sort();
    expect(hits).toEqual(["contacts.ts", "onboarding.ts", "onboardingMutations.ts", "seed.ts"]);
    expect(src["contacts.ts"]).toMatch(/export const addRecordContact = mutation/);
    // onboarding requires a written reason from a named human
    expect(src["onboarding.ts"]).toMatch(/reason\.trim\(\)\.length < 15/);
  });
  it("no function takes a client-supplied operator id: who acts comes from the session (controls/actor.ts)", () => {
    // schema.ts is the only match: it links users to operators.
    const hits = Object.entries(src).filter(([, s]) => /operatorId:\s*v\./.test(s)).map(([f]) => f).sort();
    expect(hits).toEqual(["schema.ts"]);
    expect(src["payments.ts"]).toMatch(/const op = await requireActor\(ctx\)/);
    expect(src["controls/actor.ts"]).toMatch(/throw new ConvexError\("unauthenticated"\)/);
  });
  it("no public mutation patches account status directly outside the documented human actions", () => {
    // files that patch bankAccounts status
    const hits = Object.entries(src).filter(([, s]) => /status:\s*"(disputed|rejected|superseded|verified|unverified|probing)"/.test(s) && /ctx\.db\.patch/.test(s)).map(([f]) => f).sort();
    expect(hits).toEqual(["bankAccounts.ts", "cases.ts", "probes.ts"]);
  });
  it("the sanctions-list loader is the only outbound fetch in screening/ and it reaches only the two fixed OFAC export URLs", () => {
    for (const [f, text] of Object.entries(src)) {
      if (f.startsWith("screening/") && f !== "screening/watchlistStore.ts") expect(text, f).not.toMatch(/\bfetch\(/);
    }
    const loader = src["screening/watchlistStore.ts"];
    expect((loader.match(/\bfetch\(/g) ?? []).length).toBe(1);
    expect(loader).toMatch(/export async function fetchExport\(url: string\)[\s\S]*?const res = await fetch\(url,/);
    const callers = [...loader.matchAll(/fetchExport\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a !== "url: string");
    expect(new Set(callers)).toEqual(new Set(["SDN_URL", "ALT_URL"]));
    expect(loader).toMatch(/const OFAC_EXPORTS = "https:\/\/sanctionslistservice\.ofac\.treas\.gov\/api\/PublicationPreview\/exports\/"/);
    expect(loader).toMatch(/const SDN_URL = `\$\{OFAC_EXPORTS\}SDN\.CSV`/);
    expect(loader).toMatch(/const ALT_URL = `\$\{OFAC_EXPORTS\}ALT\.CSV`/);
  });

  it("every public query requires a session (requireActor) unless it is on the documented allowlist", () => {
    // SECURITY.md → Reads. The allowlist is the whole public read surface without a session.
    const allow = new Set([
      "health.ts:status", // /health page and GET /health
      "evalRuns.ts:list", // /about and /pitch show the posted eval run
      "settings.ts:demoCases", // /pitch deep-links the seeded demo cases (ids and labels only)
      "controls/operators.ts:me", // resolves to null when signed out; the OperatorProvider needs it
      "channels/portal.ts:openRequestsForSession", // vendor portal, gated by its own session token
      "channels/portal.ts:tokenInfo", // vendor portal, gated by the confirmation token
    ]);
    const ungated: string[] = [];
    const seen: string[] = [];
    for (const [f, s] of Object.entries(src)) {
      for (const m of s.matchAll(/(?:^|\n)export const (\w+) = query\(/g)) {
        const start = m.index! + m[0].length - 1;
        let depth = 0;
        let i = start;
        for (; i < s.length; i++) {
          const ch = s[i];
          if (ch === "(" || ch === "[" || ch === "{") depth++;
          else if (ch === ")" || ch === "]" || ch === "}") { depth--; if (depth === 0) break; }
        }
        const key = `${f}:${m[1]}`;
        seen.push(key);
        if (!s.slice(start, i).includes("requireActor(") && !allow.has(key)) ungated.push(key);
      }
    }
    expect(seen.length).toBeGreaterThan(60);
    expect(ungated).toEqual([]);
    for (const k of allow) expect(seen, `allowlisted ${k} exists`).toContain(k);
  });
});
