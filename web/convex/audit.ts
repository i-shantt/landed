// Auditor view (additive, read-only): every event across all cases with filters, plus a hash chain
// recomputed on read (SHA-256 over `prev || at || actor || type || canonical payload`). `events`
// is never modified; the chain is a property of the stored order.
import { action, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const events = query({
  args: { vendorId: v.optional(v.id("vendors")), caseId: v.optional(v.id("cases")), actor: v.optional(v.string()), type: v.optional(v.string()), from: v.optional(v.number()), to: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    let rows = a.caseId ? await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", a.caseId!)).collect() : await ctx.db.query("events").collect();
    const caseVendor = new Map<string, string>();
    if (a.vendorId) {
      const cases = await ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", a.vendorId!)).collect();
      const ids = new Set(cases.map((c) => c._id as string));
      rows = rows.filter((e) => e.caseId && ids.has(e.caseId as string));
    }
    if (a.actor) rows = rows.filter((e) => e.actor === a.actor);
    if (a.type) rows = rows.filter((e) => e.type === a.type);
    if (a.from) rows = rows.filter((e) => e.at >= a.from!);
    if (a.to) rows = rows.filter((e) => e.at <= a.to!);
    rows.sort((x, y) => x.at - y.at || x._creationTime - y._creationTime);
    for (const e of rows) {
      if (e.caseId && !caseVendor.has(e.caseId as string)) {
        const c = await ctx.db.get(e.caseId);
        const vnd = c ? await ctx.db.get(c.vendorId) : null;
        caseVendor.set(e.caseId as string, vnd?.name ?? "?");
      }
    }
    const limit = a.limit ?? 2000;
    return { total: rows.length, events: rows.slice(-limit).map((e) => ({ _id: e._id, at: e.at, actor: e.actor, type: e.type, caseId: e.caseId ?? null, vendorName: e.caseId ? caseVendor.get(e.caseId as string) ?? null : null, payload: e.payload })) };
  },
});

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash chain over events in stored order: h_i = sha256(h_{i-1} | at | actor | type | canonical(payload)). */
export async function chainOver(events: { at: number; actor: string; type: string; payload: unknown }[]): Promise<{ head: string; count: number; links: string[] }> {
  let prev = "landed-genesis";
  const links: string[] = [];
  for (const e of events) {
    prev = await sha256Hex(`${prev}|${e.at}|${e.actor}|${e.type}|${canonical(e.payload ?? {})}`);
    links.push(prev);
  }
  return { head: prev, count: events.length, links };
}

export const chain = action({
  args: { caseId: v.optional(v.id("cases")) },
  handler: async (ctx, { caseId }): Promise<{ head: string; count: number; computedAt: number }> => {
    const r = await ctx.runQuery(api.audit.events, { caseId, limit: 100000 });
    const c = await chainOver(r.events);
    return { head: c.head, count: c.count, computedAt: Date.now() };
  },
});
