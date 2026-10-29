// Maker-checker approvals. A clerk (maker) requests; an approver or admin who is not the requester
// decides (checker). `payments.send` consumes an approved row when the payment goes out, so one
// approval releases exactly one payment to exactly one destination.
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { append } from "../events";
import { now } from "../clock";
import { requireActor } from "./actor";
import { getPolicy, approvalReasons } from "./policy";
import { canPay } from "../guard";
import { currentVersionForIdentity } from "../payments";

export const request = mutation({
  args: { invoiceId: v.id("invoices"), note: v.optional(v.string()) },
  handler: async (ctx, { invoiceId, note }) => {
    const op = await requireActor(ctx);
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) throw new ConvexError("invoice_not_found");
    const destination = await ctx.db.get(invoice.remitAccountId);
    if (!destination) throw new ConvexError("destination_missing");
    // An approval never substitutes for verification: it can only be requested for a payable destination.
    const current = await currentVersionForIdentity(ctx, destination.identityKey);
    const guard = canPay({ invoice, destination, currentVersionForIdentity: current });
    if (!guard.ok) throw new ConvexError(`cannot_request_approval_${guard.reason}`);

    const existing = (await ctx.db.query("approvals").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect()).find((a) => a.destinationAccountId === destination._id && (a.status === "pending" || a.status === "approved"));
    if (existing) return existing._id;

    const policy = await getPolicy(ctx);
    const { reasons, riskScore } = await approvalReasons(ctx, policy, invoice, destination);
    const t = await now(ctx);
    const id = await ctx.db.insert("approvals", {
      invoiceId,
      destinationAccountId: destination._id,
      vendorId: invoice.vendorId,
      amountCents: invoice.amountCents,
      requiredBy: reasons,
      requestedBy: op._id,
      requestedAt: t,
      status: "pending",
      note: note?.trim() || undefined,
      riskScore: riskScore ?? undefined,
    });
    await append(ctx, { actor: "human", type: "approval_requested", payload: { approvalId: id, invoiceNumber: invoice.number, amountCents: invoice.amountCents, requestedBy: op.name, requiredBy: reasons, riskScore } });
    return id;
  },
});

export const decide = mutation({
  args: { approvalId: v.id("approvals"), decision: v.union(v.literal("approved"), v.literal("rejected")), note: v.optional(v.string()) },
  handler: async (ctx, { approvalId, decision, note }) => {
    const op = await requireActor(ctx, ["approver", "admin"]);
    const a = await ctx.db.get(approvalId);
    if (!a) throw new ConvexError("approval_not_found");
    if (a.status !== "pending") throw new ConvexError(`approval_already_${a.status}`);
    if (a.requestedBy === op._id) throw new ConvexError("cannot_approve_own_request");
    if (decision === "rejected" && !(note ?? "").trim()) throw new ConvexError("rejection_needs_a_note");
    const t = await now(ctx);
    await ctx.db.patch(approvalId, { status: decision, decidedBy: op._id, decidedAt: t, note: note?.trim() || a.note });
    const invoice = await ctx.db.get(a.invoiceId);
    await append(ctx, { actor: "human", type: decision === "approved" ? "approval_granted" : "approval_rejected", payload: { approvalId, invoiceNumber: invoice?.number ?? null, amountCents: a.amountCents, decidedBy: op.name, note: note ?? null, requiredBy: a.requiredBy } });
    return decision;
  },
});

export const list = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"), v.literal("consumed"))) },
  handler: async (ctx, { status }) => {
    const rows = status ? await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", status)).collect() : await ctx.db.query("approvals").collect();
    rows.sort((x, y) => y.requestedAt - x.requestedAt);
    const out = [];
    for (const a of rows.slice(0, 200)) {
      const [invoice, vendor, requester, decider, dest] = await Promise.all([ctx.db.get(a.invoiceId), ctx.db.get(a.vendorId), ctx.db.get(a.requestedBy), a.decidedBy ? ctx.db.get(a.decidedBy) : null, ctx.db.get(a.destinationAccountId)]);
      out.push({
        ...a,
        invoiceNumber: invoice?.number ?? "?",
        vendorName: vendor?.name ?? "?",
        requestedByName: requester?.name ?? "?",
        decidedByName: decider?.name ?? null,
        destination: dest ? { routing: dest.routing, last4: dest.accountLast4, status: dest.status } : null,
      });
    }
    return out;
  },
});

export const forInvoice = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => ctx.db.query("approvals").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
});

export type ApprovalId = Id<"approvals">;
