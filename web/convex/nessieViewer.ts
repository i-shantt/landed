// Nessie transfer viewer (read-only): fetches the deposit records behind a case's probe
// and payment rail refs when the rail is Nessie. Shown on the case page only when
// settings.rail == "nessie". Integer-cent caveat is part of the result.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const transfers = action({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<{ enabled: boolean; reason?: string; items: { kind: string; id: string; record: unknown }[]; caveat: string }> => {
    const caveat = "Nessie stores amounts as integers; Landed sends amounts in integer cents with the unit in the description.";
    const rail = await ctx.runQuery(api.settings.get, { key: "rail" });
    const key = process.env.NESSIE_KEY;
    if (rail !== "nessie" || !key) return { enabled: false, reason: rail !== "nessie" ? "rail is not nessie" : "NESSIE_KEY not set", items: [], caveat };
    const c = await ctx.runQuery(api.cases.get, { caseId });
    if (!c) throw new Error("case not found");
    const refs: { kind: string; ref: string | null | undefined }[] = [{ kind: "probe", ref: c.probe?.railRef }, { kind: "payment", ref: c.payment?.railRef }];
    const items: { kind: string; id: string; record: unknown }[] = [];
    for (const r of refs) {
      if (!r.ref || !r.ref.startsWith("NESSIE-DEP-")) continue;
      const id = r.ref.replace("NESSIE-DEP-", "");
      try {
        const res = await fetch(`https://api.nessieisreal.com/deposits/${id}?key=${key}`);
        items.push({ kind: r.kind, id, record: res.ok ? await res.json() : { error: res.status } });
      } catch (e) {
        items.push({ kind: r.kind, id, record: { error: String(e) } });
      }
    }
    return { enabled: true, items, caveat };
  },
});
