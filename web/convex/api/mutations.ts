// Internal mutations used only by the REST layer (additive). They reuse the engine's own paths:
// an invoice always remits to the vendor's current verified account, or to a held, unverified one
// when that is all the vendor has, in which case it is held like any other.
import { internalMutation } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { append } from "../events";
import { now, DAY } from "../clock";

export const createInvoice = internalMutation({
  args: { vendorId: v.id("vendors"), number: v.string(), amountCents: v.number(), dueInDays: v.number(), createdBy: v.string() },
  handler: async (ctx, { vendorId, number, amountCents, dueInDays, createdBy }) => {
    const vendor = await ctx.db.get(vendorId);
    if (!vendor) throw new ConvexError("vendor_not_found");
    const existing = await ctx.db.query("invoices").withIndex("by_number", (q) => q.eq("number", number)).first();
    if (existing) {
      if (existing.vendorId !== vendorId || existing.amountCents !== amountCents) throw new ConvexError("invoice_number_already_exists_with_different_details");
      return { invoiceId: existing._id, created: false };
    }
    const accounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    const verified = accounts.filter((a) => a.status === "verified").sort((a, b) => (b.firstPaidAt ?? 0) - (a.firstPaidAt ?? 0))[0];
    const pending = accounts.filter((a) => a.status === "unverified" || a.status === "probing").sort((a, b) => b._creationTime - a._creationTime)[0];
    const remit = verified ?? pending;
    if (!remit) throw new ConvexError("vendor_has_no_bank_account");
    const t = await now(ctx);
    const invoiceId = await ctx.db.insert("invoices", { vendorId, number, amountCents, issuedAt: t, dueAt: t + dueInDays * DAY, remitAccountId: remit._id, status: verified ? "open" : "held" });
    await append(ctx, { actor: "human", type: "invoice_recorded", payload: { invoiceId, number, amountCents, remitAccountId: remit._id, remitStatus: remit.status, createdBy, via: "api" } });
    return { invoiceId, created: true };
  },
});
