// Convex Auth: schema, invite/bootstrap callbacks, actor resolution, reseed survival.
import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setup, drain } from "./harness";

describe("auth schema (core: Convex Auth tables + operator link)", () => {
  it("users and authSessions tables exist, users carry operatorId, operators are indexed by email", async () => {
    const { t } = await setup();
    const ops = await t.query(api.controls.operators.list, {});
    const admin = ops.find((o) => o.role === "admin")!;
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { email: "priya@meridianoutdoor.example", name: "Priya", operatorId: admin._id }));
    const sessionId = await t.run(async (ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3600_000 }));
    expect(sessionId).toBeTruthy();
    const byOp = await t.run(async (ctx) => ctx.db.query("users").withIndex("by_operatorId", (q) => q.eq("operatorId", admin._id)).unique());
    expect(byOp!._id).toBe(userId);
    const byEmail = await t.run(async (ctx) => ctx.db.query("operators").withIndex("by_email", (q) => q.eq("email", "priya@meridianoutdoor.example")).unique());
    expect(byEmail!._id).toBe(admin._id);
  });

  it("reseed never touches users, auth sessions or operators", async () => {
    const { t } = await setup();
    const ops = await t.query(api.controls.operators.list, {});
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { email: "x@landed.example", operatorId: ops[0]._id }));
    await t.run(async (ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3600_000 }));
    await t.action(internal.seed.reseedInternal, { which: "minimal" });
    await drain(t);
    await t.action(internal.seed.reseedInternal, { which: "full" });
    await drain(t);
    const after = await t.run(async (ctx) => ({ users: (await ctx.db.query("users").collect()).length, sessions: (await ctx.db.query("authSessions").collect()).length, operators: (await ctx.db.query("operators").collect()).length }));
    expect(after).toEqual({ users: 1, sessions: 1, operators: ops.length });
    const u = await t.run(async (ctx) => ctx.db.get(userId));
    expect(u!.operatorId).toBe(ops[0]._id); // the linked operator row survived too
  });
});

import type { Id } from "../convex/_generated/dataModel";
import { onUserCreatedOrUpdated, assertCanStartSession, operatorForUser } from "../convex/authCallbacks";

async function newUser(t: Awaited<ReturnType<typeof setup>>["t"], email: string, name?: string) {
  return t.run(async (ctx) => ctx.db.insert("users", { email, ...(name ? { name } : {}) }));
}

describe("sign-up gating (invite = operator row with the email; first user bootstraps an admin)", () => {
  it("an email that matches an active operator is linked with its role preserved and an audit event", async () => {
    const { t } = await setup();
    const ops = await t.query(api.controls.operators.list, {});
    const approver = ops.find((o) => o.role === "approver")!;
    const userId = await newUser(t, approver.email!.toUpperCase());
    await t.run(async (ctx) => onUserCreatedOrUpdated(ctx, { userId, existingUserId: null, profile: { email: approver.email!.toUpperCase() } }));
    const u = await t.run(async (ctx) => ctx.db.get(userId));
    expect(u!.operatorId).toBe(approver._id);
    const op = await t.run(async (ctx) => operatorForUser(ctx, userId));
    expect(op!.role).toBe("approver");
    const ev = await t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((e) => e.type === "operator_account_linked"));
    expect(ev.length).toBe(1);
    expect((ev[0].payload as { bootstrap: boolean; operatorId: string }).bootstrap).toBe(false);
    expect((ev[0].payload as { operatorId: string }).operatorId).toBe(approver._id);
  });

  it("an unknown email is refused when users already exist; the same operator cannot be linked twice; a sign-in to an existing account is a no-op", async () => {
    const { t } = await setup();
    const ops = await t.query(api.controls.operators.list, {});
    const clerk = ops.find((o) => o.role === "clerk")!;
    const u1 = await newUser(t, clerk.email!);
    await t.run(async (ctx) => onUserCreatedOrUpdated(ctx, { userId: u1, existingUserId: null, profile: { email: clerk.email! } }));
    const stranger = await newUser(t, "nobody@evil.example");
    await expect(t.run(async (ctx) => onUserCreatedOrUpdated(ctx, { userId: stranger, existingUserId: null, profile: { email: "nobody@evil.example" } }))).rejects.toThrow(/signup_not_invited/);
    const u2 = await newUser(t, clerk.email!);
    await expect(t.run(async (ctx) => onUserCreatedOrUpdated(ctx, { userId: u2, existingUserId: null, profile: { email: clerk.email! } }))).rejects.toThrow(/operator_already_linked/);
    await t.run(async (ctx) => onUserCreatedOrUpdated(ctx, { userId: u1, existingUserId: u1, profile: { email: clerk.email! } })); // sign-in path
    expect((await t.run(async (ctx) => ctx.db.get(u1)))!.operatorId).toBe(clerk._id);
  });

  it("on an empty users table the first unknown email becomes a bootstrap admin; a deactivated operator cannot start a session", async () => {
    const { t } = await setup();
    const userId = await newUser(t, "founder@landed.example", "Ishant Y");
    await t.run(async (ctx) => onUserCreatedOrUpdated(ctx, { userId, existingUserId: null, profile: { email: "founder@landed.example", name: "Ishant Y" } }));
    const op = (await t.run(async (ctx) => operatorForUser(ctx, userId)))!;
    expect(op.role).toBe("admin");
    expect(op.initials).toBe("IY");
    expect(op.email).toBe("founder@landed.example");
    await t.run(async (ctx) => assertCanStartSession(ctx, userId));
    await t.run(async (ctx) => ctx.db.patch(op._id, { active: false }));
    await expect(t.run(async (ctx) => assertCanStartSession(ctx, userId))).rejects.toThrow(/operator_unknown_or_inactive/);
    const unlinked = await newUser(t, "ghost@landed.example");
    await expect(t.run(async (ctx) => assertCanStartSession(ctx, unlinked))).rejects.toThrow(/operator_unknown_or_inactive/);
  });

  it("inviteAdmin creates an admin operator without a password; ensureDemoAccounts creates two password accounts linked to their operators and is idempotent", async () => {
    const { t } = await setup();
    const { operatorId } = await t.action(internal.authSetup.inviteAdmin, { email: "Owner@Landed.example", name: "Owner" });
    const op = await t.run(async (ctx) => ctx.db.get(operatorId));
    expect(op!.role).toBe("admin");
    expect(op!.email).toBe("owner@landed.example");
    expect(await t.run(async (ctx) => (await ctx.db.query("authAccounts").collect()).length)).toBe(0);
    const first = await t.action(internal.authSetup.ensureDemoAccounts, {});
    expect(Object.values(first)).toEqual(["created", "created"]);
    const second = await t.action(internal.authSetup.ensureDemoAccounts, {});
    expect(Object.values(second)).toEqual(["exists", "exists"]);
    const accounts = await t.run(async (ctx) => ctx.db.query("authAccounts").collect());
    expect(accounts.length).toBe(2);
    expect(accounts.every((a) => a.provider === "password" && a.secret && !a.secret.includes("landed-demo"))).toBe(true); // hashed
    const demo = await t.run(async (ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", "demo@landed.example")).unique());
    const demoOp = await t.run(async (ctx) => operatorForUser(ctx, demo!._id as Id<"users">));
    expect(demoOp!.role).toBe("approver");
    const ops = await t.query(api.controls.operators.list, {});
    expect(ops.filter((o) => o.email === "clerk@landed.example").length).toBe(1);
  });
});

import { actors, asUser, pay } from "./harness";

describe("requireActor: identity resolves to the operator; roles and segregation of duties hold under sessions", () => {
  it("no identity and no operatorId -> unauthenticated; a clerk cannot change policy; an admin can and the audit payload names them", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.controls.policy.set, { patch: { riskReviewAbove: 50 } })).rejects.toThrow(/unauthenticated/);
    const { clerk, admin } = await actors(t);
    await expect(clerk.as.mutation(api.controls.policy.set, { patch: { riskReviewAbove: 50 } })).rejects.toThrow(/role_clerk_cannot_do_this_requires_admin/);
    await admin.as.mutation(api.controls.policy.set, { patch: { riskReviewAbove: 50 } });
    expect((await t.query(api.controls.policy.get, {})).riskReviewAbove).toBe(50);
    const ev = await t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((e) => e.type === "policy_changed"));
    expect(ev.length).toBe(1);
    expect(ev[0].payload).toMatchObject({ by: admin.operator.name, operatorId: admin.operatorId });
    const me = await admin.as.query(api.controls.operators.me, {});
    expect(me).toMatchObject({ _id: admin.operatorId, role: "admin", userEmail: admin.operator.email });
    expect(await t.query(api.controls.operators.me, {})).toBeNull();
  });

  it("a signed-in identity wins over a client-supplied operatorId; a deactivated operator is refused on the next call", async () => {
    const { t } = await setup();
    const { clerk, admin } = await actors(t);
    // the clerk cannot borrow the admin's id
    await expect(clerk.as.mutation(api.controls.policy.set, { operatorId: admin.operatorId, patch: { riskReviewAbove: 50 } })).rejects.toThrow(/role_clerk/);
    await admin.as.mutation(api.controls.demoGuard.setDemoControls, { enabled: false });
    const other = await t.run(async (ctx) => ctx.db.insert("operators", { name: "Second Admin", initials: "SA", role: "admin", email: "second@meridianoutdoor.example", active: true }));
    const second = await asUser(t, "admin", { operatorId: other });
    await second.as.mutation(api.controls.operators.deactivate, { target: admin.operatorId });
    await expect(admin.as.mutation(api.controls.demoGuard.setDemoControls, { enabled: true })).rejects.toThrow(/operator_unknown_or_inactive/);
    await expect(second.as.mutation(api.controls.operators.deactivate, { target: other })).rejects.toThrow(/cannot_deactivate_self/);
  });

  it("segregation of duties under sessions: the requester cannot approve their own request; the approval is consumed by send", async () => {
    const { t, ids } = await setup();
    const { clerk, approver, admin } = await actors(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { dualApprovalAboveCents: 100_000 } });
    const invoiceId = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    expect(await pay(t, invoiceId)).toEqual({ ok: false, reason: "policy_approval_required" });
    const approvalId = await clerk.as.mutation(api.controls.approvals.request, { invoiceId });
    await expect(clerk.as.mutation(api.controls.approvals.decide, { approvalId, decision: "approved" })).rejects.toThrow(/role_clerk/);
    const mine = await approver.as.mutation(api.controls.approvals.request, { invoiceId });
    expect(mine).toBe(approvalId); // idempotent per invoice+destination
    const a = await t.run(async (ctx) => ctx.db.get(approvalId));
    expect(a!.requestedBy).toBe(clerk.operatorId);
    await approver.as.mutation(api.controls.approvals.decide, { approvalId, decision: "approved" });
    const decided = await t.run(async (ctx) => ctx.db.get(approvalId));
    expect(decided!.decidedBy).toBe(approver.operatorId);
    expect((await pay(t, invoiceId)).ok).toBe(true);
  });

  it("actions carry the identity into their queries: keys.create admin ok / clerk refused; paymentFiles.build clerk ok / signed-out refused; the portal and the public API need no identity", async () => {
    const { t } = await setup();
    const { clerk, admin } = await actors(t);
    const made = await admin.as.action(api.api.keys.create, { name: "ci", scopes: ["read"] });
    expect(made.key.startsWith("ld_live_sk_")).toBe(true);
    const row = await t.run(async (ctx) => ctx.db.get(made.id));
    expect(row!.createdBy).toBe(admin.operatorId);
    await expect(clerk.as.action(api.api.keys.create, { name: "ci2", scopes: ["read"] })).rejects.toThrow(/role_clerk/);
    await expect(t.action(api.api.keys.create, { name: "ci3", scopes: ["read"] })).rejects.toThrow(/unauthenticated/);
    const built = await clerk.as.action(api.exports.paymentFiles.build, { format: "nacha" });
    expect(built.entryCount).toBeGreaterThan(0);
    await expect(t.action(api.exports.paymentFiles.build, { format: "nacha" })).rejects.toThrow(/unauthenticated/);
    const files = await t.query(api.exports.paymentFiles.list, {});
    expect(files[0].createdBy).toBe(clerk.operator.name);
    expect((await t.query(api.controls.policy.get, {})).dualApprovalAboveCents).toBe(null); // public reads unchanged
  });
});
