import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, manualEdit, advanceToAvailability, getCase, VENDOR_B_ACCOUNT } from "./harness";

describe("portal hardening", () => {
  it("locks a username after 5 failed logins and clears on success", async () => {
    const { t } = await setup();
    for (let i = 0; i < 5; i++) {
      await expect(t.action(api.portalAuth.login, { username: "cleanco", password: "wrong" })).rejects.toThrow();
    }
    // 6th attempt, even with the right password, is locked
    await expect(t.action(api.portalAuth.login, { username: "cleanco", password: "landed-demo" })).rejects.toThrow(/locked/);
    expect(await t.query(internal.portalGuard.check, { username: "cleanco" })).toBeGreaterThan(0);
    await t.mutation(internal.portalGuard.clear, { username: "cleanco" });
    const ok = await t.action(api.portalAuth.login, { username: "cleanco", password: "landed-demo" });
    expect(ok.token).toBeTruthy();
  });

  it("enforces attemptsLeft server-side and escalates when exhausted", async () => {
    const { t, ids } = await setup();
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    await advanceToAvailability(t, r.caseId);
    const session = await t.mutation(internal.channels.portal.createSession, { username: "cleanco" });
    const reqs = await t.query(api.channels.portal.openRequestsForSession, { sessionToken: session.token });
    const token = reqs!.requests[0].token;
    // a wrong amount escalates to a human immediately (stated_amount_mismatch); attempts still count down
    const first = await t.mutation(api.channels.portal.confirm, { sessionToken: session.token, token, statedAmountCents: 1 });
    expect(first.attemptsLeft).toBe(2);
    expect((await getCase(t, r.caseId)).state).toBe("NEEDS_HUMAN");
    await t.mutation(api.channels.portal.confirm, { sessionToken: session.token, token, statedAmountCents: 2 });
    await t.mutation(api.channels.portal.confirm, { sessionToken: session.token, token, statedAmountCents: 3 });
    await expect(t.mutation(api.channels.portal.confirm, { sessionToken: session.token, token, statedAmountCents: 4 })).rejects.toThrow(/no_attempts_left/);
  });

  it("rejects an expired session and an expired token", async () => {
    const { t, ids } = await setup();
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    await advanceToAvailability(t, r.caseId);
    const session = await t.mutation(internal.channels.portal.createSession, { username: "cleanco" });
    await t.run(async (ctx) => { const s = (await ctx.db.query("portalSessions").collect())[0]; await ctx.db.patch(s._id, { expiresAt: Date.now() - 1 }); });
    await expect(t.mutation(api.channels.portal.confirm, { sessionToken: session.token, token: "x", statedAmountCents: 1 })).rejects.toThrow(/portal_not_logged_in/);
  });
});
