// Payment-file generation (additive). Builds a Nacha ACH file or an ISO 20022 pain.001 from the
// payment run's payable lines (guard AND policy both ok). The full file, which necessarily contains
// account numbers, is written to server-side storage and only ever leaves through the API with a
// `files:read` key; the browser receives a masked preview. Generating a file moves no money.
import { action, internalMutation, internalQuery, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { computePaymentRun } from "../paymentRun";
import { decryptAccount } from "../crypto";
import { append } from "../events";
import { sha256Hex } from "../api/util";
import { buildNachaFile, maskNachaFile, type NachaEntry } from "./nacha";
import { buildPain001, maskPain001 } from "./pain001";
import { requireActor } from "../controls/actor";

export const lineSecrets = internalQuery({
  args: { operatorId: v.optional(v.id("operators")) },
  handler: async (ctx, { operatorId }) => {
    const op = await requireActor(ctx, undefined, operatorId);
    const company = await ctx.db.query("company").first();
    const run = await computePaymentRun(ctx);
    const payable = run.lines.filter((l) => l.decision.ok && (l.policy === null || l.policy.ok));
    const out = [];
    for (const l of payable) {
      const inv = await ctx.db.get(l.invoiceId);
      if (!inv) continue;
      const acct = await ctx.db.get(inv.remitAccountId);
      if (!acct) continue;
      out.push({ invoiceId: inv._id, number: inv.number, vendorId: inv.vendorId, vendorName: l.vendorName, amountCents: inv.amountCents, routing: acct.routing, accountCiphertext: acct.accountCiphertext });
    }
    return { operatorName: op.name, company: company ? { name: company.name, routing: company.bankRouting ?? "121000358", last4: company.bankLast4 ?? "0001" } : { name: "Company", routing: "121000358", last4: "0001" }, lines: out };
  },
});

export const record = internalMutation({
  args: { format: v.union(v.literal("nacha"), v.literal("pain.001")), createdBy: v.string(), entryCount: v.number(), totalCents: v.number(), invoiceIds: v.array(v.id("invoices")), storageId: v.id("_storage"), previewMasked: v.string(), sha256: v.string() },
  handler: async (ctx, a) => {
    const id = await ctx.db.insert("paymentFiles", { ...a, createdAt: Date.now() });
    await append(ctx, { actor: "human", type: "payment_file_built", payload: { paymentFileId: id, format: a.format, entries: a.entryCount, totalCents: a.totalCents, sha256: a.sha256, by: a.createdBy, note: "file generated; no money moved" } });
    return id;
  },
});

export const build = action({
  args: { operatorId: v.optional(v.id("operators")), format: v.union(v.literal("nacha"), v.literal("pain.001")) },
  handler: async (ctx, { operatorId, format }): Promise<{ id: Id<"paymentFiles">; previewMasked: string; entryCount: number; totalCents: number; sha256: string }> => {
    const data = await ctx.runQuery(internal.exports.paymentFiles.lineSecrets, { operatorId });
    if (!data.lines.length) throw new ConvexError("no_payable_lines");
    const entries = [];
    for (const l of data.lines) entries.push({ ...l, accountNumber: await decryptAccount(l.accountCiphertext) });
    const now = new Date();
    let text: string;
    let masked: string;
    if (format === "nacha") {
      const nachaEntries: NachaEntry[] = entries.map((e) => ({ routing: e.routing, accountNumber: e.accountNumber, amountCents: e.amountCents, receiverName: e.vendorName, receiverId: String(e.vendorId).slice(-15), addenda: `INV ${e.number}` }));
      const built = buildNachaFile(
        { immediateDestination: data.company.routing, immediateOrigin: data.company.routing, destinationName: "ORIGINATING BANK", originName: data.company.name, companyName: data.company.name, companyId: "1000000001", odfiRouting: data.company.routing },
        nachaEntries,
        { secCode: "CCD", entryDescription: "VENDOR PAY", effectiveDate: new Date(now.getTime() + 86_400_000), createdAt: now }
      );
      text = built.text;
      masked = maskNachaFile(text);
    } else {
      const built = buildPain001({
        msgId: `LANDED-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`,
        createdAt: now,
        initiatingParty: data.company.name,
        debtor: { name: data.company.name, accountNumber: `000000${data.company.last4}`, routing: data.company.routing },
        requestedExecutionDate: new Date(now.getTime() + 86_400_000),
        payments: entries.map((e) => ({ endToEndId: `INV-${e.number}`.slice(0, 35), amountCents: e.amountCents, currency: "USD", creditor: { name: e.vendorName }, creditorAccount: { accountNumber: e.accountNumber }, creditorAgent: { routing: e.routing }, remittance: `Invoice ${e.number}`, purpose: "SUPP" })),
      });
      text = built.xml;
      masked = maskPain001(text);
    }
    const sha = await sha256Hex(text);
    const storageId = await ctx.storage.store(new Blob([text], { type: format === "nacha" ? "text/plain" : "application/xml" }));
    const totalCents = entries.reduce((s, e) => s + e.amountCents, 0);
    const id = await ctx.runMutation(internal.exports.paymentFiles.record, { format, createdBy: data.operatorName, entryCount: entries.length, totalCents, invoiceIds: entries.map((e) => e.invoiceId), storageId, previewMasked: masked, sha256: sha });
    return { id, previewMasked: masked, entryCount: entries.length, totalCents, sha256: sha };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("paymentFiles").order("desc").take(50)).map((f) => ({ _id: f._id, format: f.format, createdAt: f.createdAt, createdBy: f.createdBy, entryCount: f.entryCount, totalCents: f.totalCents, sha256: f.sha256, previewMasked: f.previewMasked })),
});

/** Server-only: the full file for the API download route. */
export const fullFile = internalQuery({
  args: { fileId: v.id("paymentFiles") },
  handler: async (ctx, { fileId }) => {
    const f = await ctx.db.get(fileId);
    if (!f) return null;
    return { storageId: f.storageId, format: f.format, sha256: f.sha256, createdAt: f.createdAt };
  },
});
