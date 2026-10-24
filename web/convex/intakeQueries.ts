// Default-runtime helpers for the Node intake action.
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getSetting } from "./settings";
import { append } from "./events";
import { now, DAY } from "./clock";

export const messageContext = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId);
    if (!m) return null;
    const mode = (await getSetting(ctx, "extractorMode")) ?? (process.env.ANTHROPIC_API_KEY ? "claude" : "rules");
    let currentRouting: string | undefined;
    let currentLast4: string | undefined;
    let vendorName: string | undefined;
    let openCaseId = undefined as undefined | typeof m.vendorId extends infer _ ? import("./_generated/dataModel").Id<"cases"> | undefined : never;
    if (m.vendorId) {
      const vendor = await ctx.db.get(m.vendorId);
      vendorName = vendor?.name;
      const accounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", m.vendorId!)).collect();
      const current = accounts.filter((a) => a.status === "verified").sort((a, b) => (b.firstPaidAt ?? 0) - (a.firstPaidAt ?? 0))[0];
      currentRouting = current?.routing;
      currentLast4 = current?.accountLast4;
      const cases = await ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", m.vendorId!)).collect();
      const open = cases.filter((c) => c.state !== "CLOSED").sort((a, b) => b.openedAt - a.openedAt)[0];
      openCaseId = open?._id;
    }
    const pre = (m.intakeResult ?? {}) as { attachmentText?: string; invoice?: { number: string; amountCents: number; dueInDays?: number } };
    return {
      from: m.from,
      subject: m.subject,
      body: m.body,
      vendorId: m.vendorId,
      vendorName,
      attachmentStorageIds: m.attachmentStorageIds,
      attachmentText: pre.attachmentText,
      invoice: pre.invoice,
      extractorMode: mode as "claude" | "rules" | "off",
      currentRouting,
      currentLast4,
      openCaseId,
    };
  },
});

export const noteUnknownVendor = internalMutation({
  args: { messageId: v.id("messages"), from: v.string(), evidence: v.array(v.string()) },
  handler: async (ctx, { messageId, from, evidence }) => {
    await append(ctx, { actor: "agent", type: "instruction_change_from_unknown_sender", payload: { messageId, from, evidence, note: "sender domain is not a vendor of record; nothing is paid to an account that is not bound to a known vendor" } });
  },
});

export const attachInvoice = internalMutation({
  args: {
    messageId: v.id("messages"),
    vendorId: v.id("vendors"),
    invoice: v.object({ number: v.string(), amountCents: v.number(), dueInDays: v.optional(v.number()) }),
    accountId: v.optional(v.id("bankAccounts")),
  },
  handler: async (ctx, { messageId, vendorId, invoice, accountId }) => {
    const existing = await ctx.db.query("invoices").withIndex("by_number", (q) => q.eq("number", invoice.number)).first();
    if (existing) return existing._id;
    const t = await now(ctx);
    let remit = accountId;
    if (!remit) {
      const accounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
      const current = accounts.filter((a) => a.status === "verified").sort((a, b) => (b.firstPaidAt ?? 0) - (a.firstPaidAt ?? 0))[0] ?? accounts[0];
      remit = current?._id;
    }
    if (!remit) return null;
    const id = await ctx.db.insert("invoices", { vendorId, messageId, number: invoice.number, amountCents: invoice.amountCents, issuedAt: t, dueAt: t + (invoice.dueInDays ?? 14) * DAY, remitAccountId: remit, status: "open" });
    await append(ctx, { actor: "agent", type: "invoice_recorded", payload: { invoiceId: id, number: invoice.number, amountCents: invoice.amountCents, remitAccountId: remit } });
    return id;
  },
});
