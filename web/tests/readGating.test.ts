// Reads behind the session. Every workspace query requires a signed-in operator; the short allowlist of public
// reads (operators.me, the two portal queries, health.status, evalRuns.list, settings.demoCases) is checked here
// and enforced statically in security.test.ts.
import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import { setup } from "./harness";

describe("public reads: the allowlist exposes nothing beyond what the public pages need", () => {
  it("settings.demoCases returns only the demo-case list, signed out, and null before the demo is seeded", async () => {
    const { t } = await setup();
    expect(await t.query(api.settings.demoCases, {})).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", { key: "demoCases", value: JSON.stringify([{ caseId: "c1", label: "Fraud" }]) });
      await ctx.db.insert("settings", { key: "policy", value: "{}" });
    });
    const raw = await t.query(api.settings.demoCases, {});
    expect(JSON.parse(raw!)).toEqual([{ caseId: "c1", label: "Fraud" }]);
  });
});
