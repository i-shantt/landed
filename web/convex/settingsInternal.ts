import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getSetting, setSetting, deleteSetting } from "./settings";

export const getInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => getSetting(ctx, key),
});

export const setInternal = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => setSetting(ctx, key, value),
});

export const deleteInternal = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => deleteSetting(ctx, key),
});
