// Kill switch for the demo-only public surface (clock, simulated vendor answers, re-seed, scenario
// runner). This build has no end-user authentication, so these functions are reachable by any client
// that knows the deployment URL. An administrator can turn them off; the verification engine and the
// payment boundary are unaffected either way. Production replaces this with real auth.
import { mutation, query, internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { getSetting, setSetting } from "../settings";
import { append } from "../events";
import { requireActor } from "./actor";

export const KEY = "demoControls";

export async function demoControlsEnabled(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  return ((await getSetting(ctx, KEY)) ?? "on") !== "off";
}

export async function assertDemoControls(ctx: QueryCtx | MutationCtx) {
  if (!(await demoControlsEnabled(ctx))) throw new ConvexError("demo_controls_disabled");
}

export const enabled = query({
  args: {},
  handler: async (ctx) => demoControlsEnabled(ctx),
});

export const check = internalQuery({
  args: {},
  handler: async (ctx) => demoControlsEnabled(ctx),
});

export const setDemoControls = mutation({
  args: { operatorId: v.optional(v.id("operators")), enabled: v.boolean() },
  handler: async (ctx, { operatorId, enabled }) => {
    const op = await requireActor(ctx, ["admin"], operatorId);
    await setSetting(ctx, KEY, enabled ? "on" : "off");
    await append(ctx, { actor: "human", type: "demo_controls_changed", payload: { by: op.name, operatorId: op._id, enabled } });
    return enabled;
  },
});
