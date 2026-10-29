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
