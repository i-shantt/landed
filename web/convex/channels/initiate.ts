// Selects the confirmation channel and kicks it off. The probe amount is never
// loaded here and never passed to any channel (I7).
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { ConfirmationChannel } from "./types";
import { SimVoice } from "./simVoice";
import { VapiVoice } from "./vapi";
import { recordPhoneContact, recordPortalContact } from "../contacts";
import { getSetting } from "../settings";
import { append } from "../events";
import { createConfirmToken } from "./portal";

export const context = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const vendor = await ctx.db.get(c.vendorId);
    const phone = await recordPhoneContact(ctx, c.vendorId);
    const portal = await recordPortalContact(ctx, c.vendorId);
    const voice = (await getSetting(ctx, "voice")) ?? process.env.VOICE ?? "sim";
    const payment = c.paymentId ? await ctx.db.get(c.paymentId) : null;
    return {
      state: c.state,
      vendor: vendor ? { _id: vendor._id, name: vendor.name, hasPortalLogin: vendor.hasPortalLogin } : null,
      phone,
      portal,
      voice,
      payment: payment ? { _id: payment._id, amountCents: payment.amountCents, landingState: payment.landingState } : null,
    };
  },
});

export const noteNoContact = internalMutation({
  args: { caseId: v.id("cases"), mode: v.string() },
  handler: async (ctx, { caseId, mode }) => {
    await append(ctx, { caseId, actor: "system", type: "no_record_contact", payload: { mode, note: "vendor has no phone contact of record; portal only or human review" } });
  },
});

export const openPortalPath = internalMutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return;
    await createConfirmToken(ctx, c._id, c.vendorId);
  },
});

function pickVoice(ctx: ActionCtx, voice: string): ConfirmationChannel {
  if (voice === "vapi" && process.env.VAPI_API_KEY) return new VapiVoice(ctx);
  return new SimVoice(ctx);
}

export const initiateConfirmation = internalAction({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const info = await ctx.runQuery(internal.channels.initiate.context, { caseId });
    if (!info || info.state !== "AWAITING_CONFIRMATION") return;
    if (info.vendor?.hasPortalLogin && info.portal) {
      await ctx.runMutation(internal.channels.initiate.openPortalPath, { caseId });
    }
    if (!info.phone) {
      await ctx.runMutation(internal.channels.initiate.noteNoContact, { caseId, mode: "probe" });
      return;
    }
    const channel = pickVoice(ctx, info.voice);
    await channel.initiate({ caseId, contact: info.phone, mode: "probe" });
  },
});

export const initiateLanding = internalAction({
  args: { caseId: v.id("cases"), paymentId: v.id("payments") },
  handler: async (ctx, { caseId, paymentId }) => {
    const info = await ctx.runQuery(internal.channels.initiate.context, { caseId });
    if (!info || info.state !== "PAID" || !info.payment || info.payment.landingState !== "pending") return;
    if (!info.phone) {
      await ctx.runMutation(internal.channels.initiate.noteNoContact, { caseId, mode: "landing" });
      return;
    }
    const channel = pickVoice(ctx, info.voice);
    await channel.initiate({ caseId, contact: info.phone, mode: "landing", expectedPaymentAmountCents: info.payment.amountCents, paymentId });
  },
});
