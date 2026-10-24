// Recovery package. Deterministic fields first; prose from templates (or Claude,
// verified against the fields). Full implementation in Tier 3 step 14; the
// skeleton here already produces a usable deterministic package.
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { append } from "./events";
import { transition } from "./cases";
import { now } from "./clock";
import { buildFields, renderMarkdown } from "./packageTemplates";

export const context = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const vendor = await ctx.db.get(c.vendorId);
    const account = await ctx.db.get(c.newAccountId);
    const payment = c.paymentId ? await ctx.db.get(c.paymentId) : null;
    const events = await ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const company = await ctx.db.query("company").first();
    const invoice = payment ? await ctx.db.get(payment.invoiceId) : null;
    const t = await now(ctx);
    return {
      caseDoc: c,
      vendor,
      account: account ? { routing: account.routing, last4: account.accountLast4, version: account.version, status: account.status } : null,
      payment,
      invoice,
      company,
      companyAccount: { routing: company?.bankRouting ?? "121000358", last4: company?.bankLast4 ?? "0001" },
      events: events.sort((a, b) => a.at - b.at).map((e) => ({ at: e.at, actor: e.actor, type: e.type })),
      now: t,
    };
  },
});

export const save = internalMutation({
  args: { caseId: v.id("cases"), fields: v.any(), markdown: v.string(), thenRecovery: v.boolean(), prose: v.string() },
  handler: async (ctx, { caseId, fields, markdown, thenRecovery, prose }) => {
    const t = await now(ctx);
    const existing = await ctx.db.query("packages").withIndex("by_case", (q) => q.eq("caseId", caseId)).first();
    if (existing) await ctx.db.patch(existing._id, { generatedAt: t, fields, markdown });
    else await ctx.db.insert("packages", { caseId, generatedAt: t, fields, markdown });
    await append(ctx, { caseId, actor: "agent", type: "package_generated", payload: { prose, sections: Object.keys(fields.sections ?? {}).length, eligibility: fields.eligibility } });
    const c = await ctx.db.get(caseId);
    if (thenRecovery && c && c.state === "UNCONFIRMED") {
      await transition(ctx, caseId, "RECOVERY", { actor: "system", type: "recovery_started", payload: { reason: "landing_unconfirmed" } });
    }
  },
});

export const generate = internalAction({
  args: { caseId: v.id("cases"), thenRecovery: v.boolean() },
  handler: async (ctx, { caseId, thenRecovery }) => {
    const info = await ctx.runQuery(internal.package.context, { caseId });
    if (!info) return;
    const fields = buildFields(info);
    let claudeSections: Record<string, string> | null = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        claudeSections = await ctx.runAction(internal.packageProse.draft, { fields });
      } catch (e) {
        console.warn("[package] claude prose failed; using templates", String(e));
      }
    }
    const { markdown, prose } = await renderMarkdown(fields, claudeSections);
    await ctx.runMutation(internal.package.save, { caseId, fields, markdown, thenRecovery, prose });
  },
});

export const getForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => ctx.db.query("packages").withIndex("by_case", (q) => q.eq("caseId", caseId)).first(),
});
