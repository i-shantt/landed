// Outbound webhooks. Every audit event is a candidate; endpoints subscribe to event types ("*" for
// all). Deliveries are signed (`Landed-Signature: t=…,v1=…`, HMAC-SHA256 over "{t}.{body}") and
// retried on a fixed schedule; after the last attempt the delivery is marked exhausted. Payloads are
// the redacted audit payloads, so probe amounts never leave the server through this path either.
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { getSetting, setSetting } from "../settings";
import { append } from "../events";
import { requireActor } from "../controls/actor";
import { randomHex, signWebhook, verifyWebhookSignature } from "../api/util";

const CURSOR_KEY = "webhooks:cursor";
/** Retry schedule in ms after the previous attempt (8 attempts total, Increase-style). */
export const RETRY_SCHEDULE_MS = [60_000, 10 * 60_000, 3600_000, 4 * 3600_000, 12 * 3600_000, 24 * 3600_000, 72 * 3600_000];
export const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

/** Event types a customer system typically subscribes to (any audit type is allowed). */
export const COMMON_EVENT_TYPES = [
  "case_opened",
  "invoices_held",
  "probe_submitted",
  "awaiting_confirmation",
  "account_verified",
  "escalated",
  "payment_refused",
  "payment_sent",
  "payment_landed",
  "landing_unconfirmed",
  "recovery_started",
  "change_rejected",
  "approval_requested",
  "approval_granted",
  "vendor_screened",
  "case_closed",
];

export function isAllowedWebhookUrl(url: string, siteUrl: string | undefined): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  const own = siteUrl && url.startsWith(siteUrl);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return { ok: false, reason: "https_required" };
  if (own) return { ok: true };
  const h = u.hostname;
  // Block obvious private/internal targets (SSRF). A production deployment resolves DNS and checks the IP too.
  if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd)/i.test(h) || h === "localhost" || h.endsWith(".internal") || h.endsWith(".local")) return { ok: false, reason: "private_host" };
  return { ok: true };
}

export const createEndpoint = mutation({
  args: { url: v.string(), description: v.optional(v.string()), eventTypes: v.array(v.string()) },
  handler: async (ctx, { url, description, eventTypes }) => {
    const op = await requireActor(ctx, ["admin"]);
    const check = isAllowedWebhookUrl(url, process.env.CONVEX_SITE_URL);
    if (!check.ok) throw new ConvexError(`webhook_url_${check.reason}`);
    if (!eventTypes.length) throw new ConvexError("event_types_required");
    const secret = `whsec_${randomHex(24)}`;
    const id = await ctx.db.insert("webhookEndpoints", { url, description: description?.trim() || undefined, secret, eventTypes, active: true, createdAt: Date.now() });
    await append(ctx, { actor: "human", type: "webhook_endpoint_created", payload: { endpointId: id, url, eventTypes, by: op.name } });
    // The secret is returned once, like the API key.
    return { id, secret };
  },
});

/** Convenience for demos: an endpoint pointing at this deployment's own signed inbox. */
export const createInboxEndpoint = mutation({
  args: {},
  handler: async (ctx) => {
    const op = await requireActor(ctx, ["admin"]);
    const site = process.env.CONVEX_SITE_URL;
    if (!site) throw new ConvexError("CONVEX_SITE_URL_unset");
    const url = `${site}/webhooks/inbox`;
    const existing = (await ctx.db.query("webhookEndpoints").collect()).find((e) => e.url === url && e.active);
    if (existing) return { id: existing._id, secret: null };
    const secret = `whsec_${randomHex(24)}`;
    const id = await ctx.db.insert("webhookEndpoints", { url, description: "Built-in signed inbox (demo receiver)", secret, eventTypes: ["*"], active: true, createdAt: Date.now() });
    await append(ctx, { actor: "human", type: "webhook_endpoint_created", payload: { endpointId: id, url, eventTypes: ["*"], by: op.name, builtIn: true } });
    return { id, secret: null };
  },
});

export const setActive = mutation({
  args: { endpointId: v.id("webhookEndpoints"), active: v.boolean() },
  handler: async (ctx, { endpointId, active }) => {
    await requireActor(ctx, ["admin"]);
    await ctx.db.patch(endpointId, { active });
  },
});

export const remove = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }) => {
    const op = await requireActor(ctx, ["admin"]);
    const e = await ctx.db.get(endpointId);
    if (!e) return;
    await ctx.db.delete(endpointId);
    await append(ctx, { actor: "human", type: "webhook_endpoint_deleted", payload: { endpointId, url: e.url, by: op.name } });
  },
});

export const endpoints = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("webhookEndpoints").collect();
    const out = [];
    for (const e of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const deliveries = await ctx.db.query("webhookDeliveries").withIndex("by_endpoint", (q) => q.eq("endpointId", e._id)).collect();
      out.push({
        _id: e._id,
        url: e.url,
        description: e.description ?? null,
        eventTypes: e.eventTypes,
        active: e.active,
        createdAt: e.createdAt,
        secretHint: `${e.secret.slice(0, 10)}…`,
        stats: { delivered: deliveries.filter((d) => d.status === "delivered").length, pending: deliveries.filter((d) => d.status === "pending" || d.status === "failed").length, exhausted: deliveries.filter((d) => d.status === "exhausted").length },
      });
    }
    return out;
  },
});

export const deliveries = query({
  args: { endpointId: v.optional(v.id("webhookEndpoints")), limit: v.optional(v.number()) },
  handler: async (ctx, { endpointId, limit }) => {
    const rows = endpointId ? await ctx.db.query("webhookDeliveries").withIndex("by_endpoint", (q) => q.eq("endpointId", endpointId)).collect() : await ctx.db.query("webhookDeliveries").order("desc").take(limit ?? 100);
    rows.sort((a, b) => b._creationTime - a._creationTime);
    return rows.slice(0, limit ?? 100).map((d) => ({ _id: d._id, endpointId: d.endpointId, eventId: d.eventId, eventType: d.eventType, attempt: d.attempt, status: d.status, nextAttemptAt: d.nextAttemptAt, lastStatusCode: d.lastStatusCode ?? null, lastError: d.lastError ?? null, deliveredAt: d.deliveredAt ?? null, createdAt: d._creationTime }));
  },
});

export const inbox = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("webhookInbox").order("desc").take(50)).map((r) => ({ ...r, body: r.body.slice(0, 4000) })),
});

// ---- dispatch ----

/** Enqueue deliveries for every event since the cursor, then deliver everything due. */
export const pump = internalMutation({
  args: {},
  handler: async (ctx) => {
    const endpoints = (await ctx.db.query("webhookEndpoints").collect()).filter((e) => e.active);
    const nowMs = Date.now();
    let enqueued = 0;
    if (endpoints.length) {
      const cursor = Number((await getSetting(ctx, CURSOR_KEY)) ?? "0");
      const events = await ctx.db
        .query("events")
        .filter((q) => q.gt(q.field("_creationTime"), cursor))
        .order("asc")
        .take(200);
      let last = cursor;
      for (const ev of events) {
        last = Math.max(last, ev._creationTime);
        for (const e of endpoints) {
          if (!(e.eventTypes.includes("*") || e.eventTypes.includes(ev.type))) continue;
          await ctx.db.insert("webhookDeliveries", { endpointId: e._id, eventId: ev._id, eventType: ev.type, attempt: 0, status: "pending", nextAttemptAt: nowMs });
          enqueued++;
        }
      }
      if (last !== cursor) await setSetting(ctx, CURSOR_KEY, String(last));
    } else {
      // No subscribers: keep the cursor at "now" so a new endpoint only receives future events.
      const latest = await ctx.db.query("events").order("desc").first();
      if (latest) await setSetting(ctx, CURSOR_KEY, String(latest._creationTime));
    }
    const due = await ctx.db.query("webhookDeliveries").withIndex("by_due", (q) => q.eq("status", "pending").lte("nextAttemptAt", nowMs)).take(50);
    const failedDue = await ctx.db.query("webhookDeliveries").withIndex("by_due", (q) => q.eq("status", "failed").lte("nextAttemptAt", nowMs)).take(50);
    for (const d of [...due, ...failedDue]) await ctx.scheduler.runAfter(0, internal.webhooks.dispatch.deliver, { deliveryId: d._id });
    return { enqueued, scheduled: due.length + failedDue.length };
  },
});

/** Admin: run the pump now instead of waiting for the cron. */
export const pumpNow = mutation({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.webhooks.dispatch.pump, {});
  },
});

export const deliveryContext = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const d = await ctx.db.get(deliveryId);
    if (!d) return null;
    const [endpoint, event] = await Promise.all([ctx.db.get(d.endpointId), ctx.db.get(d.eventId)]);
    if (!endpoint || !event) return null;
    return { delivery: d, endpoint, event };
  },
});

export const recordAttempt = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), ok: v.boolean(), statusCode: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, { deliveryId, ok, statusCode, error }) => {
    const d = await ctx.db.get(deliveryId);
    if (!d || d.status === "delivered" || d.status === "exhausted") return;
    const attempt = d.attempt + 1;
    if (ok) {
      await ctx.db.patch(deliveryId, { attempt, status: "delivered", lastStatusCode: statusCode, lastError: undefined, deliveredAt: Date.now() });
      return;
    }
    const wait = RETRY_SCHEDULE_MS[attempt - 1];
    if (wait === undefined) {
      await ctx.db.patch(deliveryId, { attempt, status: "exhausted", lastStatusCode: statusCode, lastError: error });
      await append(ctx, { actor: "system", type: "webhook_delivery_exhausted", payload: { deliveryId, endpointId: d.endpointId, eventType: d.eventType, attempts: attempt, lastStatusCode: statusCode ?? null } });
      return;
    }
    await ctx.db.patch(deliveryId, { attempt, status: "failed", lastStatusCode: statusCode, lastError: error, nextAttemptAt: Date.now() + wait });
  },
});

export function buildEventBody(ev: { _id: string; type: string; at: number; actor: string; caseId?: string | null; payload: unknown }, deliveryId: string, attempt: number) {
  return {
    id: `evt_${ev._id}`,
    object: "event",
    type: ev.type,
    created: Math.floor(ev.at / 1000),
    livemode: false,
    actor: ev.actor,
    data: { object: { case_id: ev.caseId ?? null, ...(typeof ev.payload === "object" && ev.payload ? (ev.payload as Record<string, unknown>) : { value: ev.payload }) } },
    delivery: { id: deliveryId, attempt },
  };
}

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const c = await ctx.runQuery(internal.webhooks.dispatch.deliveryContext, { deliveryId });
    if (!c) return;
    if (c.delivery.status === "delivered" || c.delivery.status === "exhausted" || !c.endpoint.active) return;
    const body = JSON.stringify(buildEventBody({ ...c.event, caseId: c.event.caseId ?? null }, deliveryId, c.delivery.attempt + 1));
    const t = Math.floor(Date.now() / 1000);
    const signature = await signWebhook(c.endpoint.secret, body, t);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(c.endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", "landed-signature": signature, "landed-event-id": `evt_${c.event._id}`, "landed-event-type": c.event.type, "landed-delivery-id": deliveryId, "user-agent": "Landed-Webhooks/1.0" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      await ctx.runMutation(internal.webhooks.dispatch.recordAttempt, { deliveryId, ok: res.ok, statusCode: res.status, error: res.ok ? undefined : `HTTP ${res.status}` });
    } catch (e) {
      await ctx.runMutation(internal.webhooks.dispatch.recordAttempt, { deliveryId, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  },
});

/** Admin: send a synthetic `ping` event to one endpoint right now. */
export const sendTest = action({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }): Promise<{ ok: boolean; status?: number; error?: string }> => {
    const ctxInfo = await ctx.runQuery(internal.webhooks.dispatch.testContext, { endpointId });
    if (!ctxInfo) throw new ConvexError("endpoint_not_found_or_not_admin");
    const body = JSON.stringify({ id: `evt_test_${randomHex(6)}`, object: "event", type: "ping", created: Math.floor(Date.now() / 1000), livemode: false, data: { object: { message: "Landed webhook test" } } });
    const t = Math.floor(Date.now() / 1000);
    const signature = await signWebhook(ctxInfo.secret, body, t);
    try {
      const res = await fetch(ctxInfo.url, { method: "POST", headers: { "content-type": "application/json", "landed-signature": signature, "landed-event-type": "ping" }, body });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  },
});

export const testContext = internalQuery({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }) => {
    await requireActor(ctx, ["admin"]);
    const e = await ctx.db.get(endpointId);
    return e ? { url: e.url, secret: e.secret } : null;
  },
});

// ---- built-in signed inbox (what a customer's receiver does) ----
export const inboxSecretForUrl = internalQuery({
  args: { url: v.string() },
  handler: async (ctx, { url }) => (await ctx.db.query("webhookEndpoints").collect()).filter((e) => e.url === url).map((e) => e.secret),
});

export const inboxStore = internalMutation({
  args: { signatureValid: v.boolean(), eventType: v.string(), eventId: v.string(), body: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert("webhookInbox", { receivedAt: Date.now(), ...a });
  },
});

export async function verifyAgainstAny(secrets: string[], body: string, header: string | null): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  for (const s of secrets) if ((await verifyWebhookSignature(s, body, header, now)).ok) return true;
  return false;
}

export type EndpointId = Id<"webhookEndpoints">;
