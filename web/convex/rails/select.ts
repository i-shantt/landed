import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Rail } from "./types";
import { SimRail } from "./sim";
import { NessieRail } from "./nessie";

export async function selectRail(ctx: ActionCtx): Promise<Rail> {
  const setting = await ctx.runQuery(internal.settingsInternal.getInternal, { key: "rail" });
  const choice = setting ?? process.env.RAIL ?? "sim";
  if (choice === "nessie" && process.env.NESSIE_KEY) return new NessieRail(ctx, process.env.NESSIE_KEY);
  return new SimRail(ctx);
}
