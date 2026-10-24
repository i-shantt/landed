import { query } from "./_generated/server";
export const list = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("evalRuns").collect()).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId)),
});
