import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { append } from "../events";

export const note = internalMutation({
  args: { caseId: v.id("cases"), type: v.string(), payload: v.any() },
  handler: async (ctx, { caseId, type, payload }) => {
    await append(ctx, { caseId, actor: "agent", type, payload });
  },
});
