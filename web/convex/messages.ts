// Inbox simulator. Inserting a message dispatches intake (a hop, not a timer).
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { now } from "./clock";
import { append } from "./events";
import { recordFromEmail } from "./confirmations";

export const messageInput = {
  from: v.string(),
  to: v.optional(v.string()),
  subject: v.string(),
  body: v.string(),
  threadId: v.optional(v.string()),
  vendorId: v.optional(v.id("vendors")),
  dmarc: v.optional(v.boolean()),
  spf: v.optional(v.boolean()),
  dkim: v.optional(v.boolean()),
  attachmentStorageIds: v.optional(v.array(v.id("_storage"))),
  attachmentText: v.optional(v.string()), // eval: pre-extracted PDF text
  invoice: v.optional(v.object({ number: v.string(), amountCents: v.number(), dueInDays: v.optional(v.number()) })),
};

export async function insertMessage(ctx: MutationCtx, args: {
  from: string; to?: string; subject: string; body: string; threadId?: string; vendorId?: Id<"vendors">;
  dmarc?: boolean; spf?: boolean; dkim?: boolean; attachmentStorageIds?: Id<"_storage">[]; attachmentText?: string;
  invoice?: { number: string; amountCents: number; dueInDays?: number };
}) {
  const t = await now(ctx);
  // Resolve vendor by sender domain if not given (exact domain match only; lookalikes stay unresolved).
  let vendorId = args.vendorId;
  const domain = args.from.split("@")[1]?.toLowerCase().replace(/>$/, "") ?? "";
  if (!vendorId && domain) {
    const vnd = await ctx.db.query("vendors").withIndex("by_domain", (q) => q.eq("domain", domain)).unique();
    vendorId = vnd?._id;
  }
  const company = await ctx.db.query("company").first();
  const messageId = await ctx.db.insert("messages", {
    vendorId,
    threadId: args.threadId ?? `thread-${t}-${Math.floor(Math.random() * 1e6)}`,
    from: args.from,
    to: args.to ?? `ap@${company?.domain ?? "meridianoutdoor.example"}`,
    subject: args.subject,
    body: args.body,
    sentAt: t,
    channel: "email",
    authResult: { spf: args.spf ?? args.dmarc ?? true, dkim: args.dkim ?? args.dmarc ?? true, dmarc: args.dmarc ?? true },
    attachmentStorageIds: args.attachmentStorageIds ?? [],
    intakeStatus: "pending",
    intakeResult: args.attachmentText ? { attachmentText: args.attachmentText } : undefined,
  });
  await append(ctx, { actor: "vendor", type: "message_received", payload: { messageId, from: args.from, subject: args.subject, dmarc: args.dmarc ?? true, vendorResolved: !!vendorId } });
  await ctx.scheduler.runAfter(0, internal.intake.run, { messageId });
  return messageId;
}

export const insert = mutation({
  args: messageInput,
  handler: async (ctx, args) => insertMessage(ctx, args),
});

export const insertInternal = internalMutation({
  args: messageInput,
  handler: async (ctx, args) => insertMessage(ctx, args),
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const setIntakeResult = internalMutation({
  args: { messageId: v.id("messages"), status: v.union(v.literal("done"), v.literal("error")), result: v.any() },
  handler: async (ctx, { messageId, status, result }) => {
    const m = await ctx.db.get(messageId);
    if (!m) return;
    await ctx.db.patch(messageId, { intakeStatus: status, intakeResult: { ...(m.intakeResult ?? {}), ...result } });
  },
});

/** Attacker "we received $0.37" style emails: log and ignore (I4). */
export const recordReceiptClaim = internalMutation({
  args: { messageId: v.id("messages"), caseId: v.id("cases"), statedAmountCents: v.optional(v.number()) },
  handler: async (ctx, { messageId, caseId, statedAmountCents }) => {
    const m = await ctx.db.get(messageId);
    if (!m) return null;
    return recordFromEmail(ctx, { caseId, messageId, statedAmountCents, transcript: m.body.slice(0, 500), from: m.from });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("messages").order("desc").take(200);
    const out = [];
    for (const m of rows) {
      const vendor = m.vendorId ? await ctx.db.get(m.vendorId) : null;
      out.push({ ...m, vendorName: vendor?.name ?? null });
    }
    return out;
  },
});

export const thread = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const rows = await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    return rows.sort((a, b) => a.sentAt - b.sentAt);
  },
});

export const get = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => ctx.db.get(messageId),
});
