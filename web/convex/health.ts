// Health (additive): deployment, seed, clock, last tick, unfired timers, modes, key presence.
import { query } from "./_generated/server";
import { getSetting } from "./settings";
import { now } from "./clock";

export const status = query({
  args: {},
  handler: async (ctx) => {
    const clock = await ctx.db.query("clock").first();
    const t = await now(ctx);
    const unfired = await ctx.db.query("timers").withIndex("by_due", (q) => q.eq("fired", false)).take(500);
    const lastFired = (await ctx.db.query("timers").withIndex("by_due", (q) => q.eq("fired", true)).order("desc").take(1))[0];
    const cases = await ctx.db.query("cases").collect();
    const company = await ctx.db.query("company").first();
    return {
      deployment: process.env.CONVEX_CLOUD_URL ?? null,
      seededAt: Number((await getSetting(ctx, "seededAt")) ?? 0) || null,
      demoSeededAt: Number((await getSetting(ctx, "demoSeededAt")) ?? 0) || null,
      company: company?.name ?? null,
      clock: { mode: clock?.mode ?? "live", now: t, offsetMs: clock?.offsetMs ?? 0 },
      lastTimerFiredDueAt: lastFired?.dueAt ?? null,
      unfiredTimers: unfired.length,
      nextTimer: unfired.sort((a, b) => a.dueAt - b.dueAt)[0] ? { kind: unfired[0].kind, dueAt: unfired[0].dueAt } : null,
      cases: { total: cases.length, open: cases.filter((c) => c.state !== "CLOSED").length, needsHuman: cases.filter((c) => c.state === "NEEDS_HUMAN").length },
      modes: { extractor: (await getSetting(ctx, "extractorMode")) ?? "rules", rail: (await getSetting(ctx, "rail")) ?? "sim", voice: (await getSetting(ctx, "voice")) ?? "sim", judgeMode: (await getSetting(ctx, "judgeMode")) ?? "on" },
      keys: { anthropic: !!process.env.ANTHROPIC_API_KEY, nessie: !!process.env.NESSIE_KEY, vapi: !!process.env.VAPI_API_KEY, hmac: !!process.env.ACCOUNT_HMAC_KEY, enc: !!process.env.ACCOUNT_ENC_KEY, evalKey: !!process.env.EVAL_KEY },
      probeAmountEndpoint: process.env.EVAL_PROBE_AMOUNT_ENDPOINT === "1" ? "enabled (dev)" : "disabled",
    };
  },
});
