import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import { setup, drain, getCase, getAccount, asUser } from "./harness";

describe("vendor onboarding", () => {
  it("creates a vendor, attests the contact of record, and the first account opens a case", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.onboarding.createVendor, { name: "Pine Ridge Signage", domain: "pineridgesignage.example" })).rejects.toThrow(/unauthenticated/);
    const clerk = await asUser(t, "clerk");
    const vendorId = await clerk.as.mutation(api.onboarding.createVendor, { name: "Pine Ridge Signage", domain: "pineridgesignage.example" });
    expect((await t.run(async (ctx) => ctx.db.get(vendorId)))!.notes).toBe(`onboarded by ${clerk.operator.name}`);
    await expect(clerk.as.mutation(api.onboarding.attestRecordContact, { vendorId, kind: "phone", value: "+15550100777", reason: "short" })).rejects.toThrow();
    const contactId = await clerk.as.mutation(api.onboarding.attestRecordContact, { vendorId, kind: "phone", value: "+15550100777", reason: "verified by phone call to the number on the signed W-9" });
    const contact = await t.run(async (ctx) => ctx.db.get(contactId));
    expect(contact?.trustLevel).toBe("record");
    const r = await t.action(api.onboarding.addFirstAccount, { vendorId, routing: "021000021", accountNumber: "123456789012" });
    await drain(t);
    expect(["unverified", "probing"]).toContain((await getAccount(t, r.accountId)).status);
    expect((await getCase(t, r.caseId!)).state).toBe("PROBE_SENT");
    await clerk.as.action(api.onboarding.issuePortalCredential, { vendorId, username: "pineridge", password: "landed-demo" });
    const issued = await t.run(async (ctx) => (await ctx.db.query("events").collect()).find((e) => e.type === "portal_credential_issued"));
    expect((issued!.payload as { issuedBy: string }).issuedBy).toBe(clerk.operator.name);
    const login = await t.action(api.portalAuth.login, { username: "pineridge", password: "landed-demo" });
    expect(login.vendorId).toBe(vendorId);
  });
});
