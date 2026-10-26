// HTTP actions: /eval/* (shared secret), /vapi/webhook, /portal/*.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { clientKey } from "./rateLimit";
import { safeEqual } from "./api/util";
import { registerApiRoutes } from "./apiRoutes";

// Rate limits (token buckets in settings): portal login 10/min per client, portal confirm 30/min per client,
// eval endpoints 300/min global (keyed callers; protects prod from runaway scripts).
async function limited(ctx: Parameters<Parameters<typeof httpAction>[0]>[0], req: Request, bucket: string, capacity: number, refillPerSec: number) {
  const r = await ctx.runMutation(internal.rateLimit.take, { bucket: `${bucket}:${clientKey(req)}`, capacity, refillPerSec });
  return r.ok ? null : json({ ok: false, error: { code: "rate_limited", retryAfterMs: r.retryAfterMs } }, 429);
}

const http = httpRouter();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

/** Fail closed: no EVAL_KEY on the deployment means no /eval/* access at all. */
function authorized(req: Request): boolean {
  const expected = process.env.EVAL_KEY;
  if (!expected) return false;
  return safeEqual(req.headers.get("x-eval-key") ?? "", expected);
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorPayload(e: unknown) {
  if (e instanceof ConvexError) return e.data;
  return { message: String((e as Error)?.message ?? e) };
}

http.route({ path: "/eval/reset", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  const res = await ctx.runAction(internal.seed.reseedInternal, { which: (b.which as "minimal" | "full" | undefined) ?? "full", demo: b.demo === true });
  return json({ ok: true, ...res });
}) });

http.route({ path: "/eval/inject", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  { const rl = await limited(ctx, req, "eval", 300, 300 / 60); if (rl) return rl; }
  const b = await body(req);
  const m = (b.message ?? b) as Record<string, unknown>;
  try {
    const attachmentStorageIds: Id<"_storage">[] = [];
    if (typeof m.attachmentPdfBase64 === "string") {
      const bin = Uint8Array.from(atob(m.attachmentPdfBase64), (ch) => ch.charCodeAt(0));
      attachmentStorageIds.push(await ctx.storage.store(new Blob([bin], { type: "application/pdf" })));
    }
    const messageId = await ctx.runMutation(internal.messages.insertInternal, {
      attachmentStorageIds: attachmentStorageIds.length ? attachmentStorageIds : undefined,
      from: String(m.from),
      to: m.to ? String(m.to) : undefined,
      subject: String(m.subject ?? ""),
      body: String(m.body ?? ""),
      threadId: m.threadId ? String(m.threadId) : undefined,
      vendorId: m.vendorId ? (m.vendorId as Id<"vendors">) : undefined,
      dmarc: typeof m.dmarc === "boolean" ? m.dmarc : undefined,
      attachmentText: m.attachmentText ? String(m.attachmentText) : undefined,
      invoice: m.invoice as { number: string; amountCents: number; dueInDays?: number } | undefined,
    });
    return json({ ok: true, messageId });
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

http.route({ path: "/eval/advance", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  const ms = Number(b.ms ?? 0);
  if (!Number.isFinite(ms) || Math.abs(ms) > 400 * 24 * 3600_000) return json({ ok: false, error: { code: "bad_ms", message: "ms must be a finite number of milliseconds (|ms| <= 400 days)" } }, 400);
  const res = await ctx.runMutation(api.clock.advance, { ms });
  return json({ ok: true, ...res });
}) });

http.route({ path: "/eval/advanceTo", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  const at = Number(b.at);
  if (!Number.isFinite(at) || at <= 0) return json({ ok: false, error: { code: "bad_at", message: "at must be an epoch millisecond timestamp" } }, 400);
  const res = await ctx.runMutation(api.clock.advanceTo, { at });
  return json({ ok: true, ...res });
}) });

http.route({ path: "/eval/tick", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const res = await ctx.runMutation(internal.timers.tick, {});
  return json({ ok: true, ...res });
}) });

http.route({ path: "/eval/vendorStatement", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  try {
    const res = await ctx.runMutation(internal.channels.simVoice.answerInternal, {
      caseId: b.caseId as Id<"cases">,
      statedAmountCents: typeof b.statedAmountCents === "number" ? b.statedAmountCents : null,
      outcome: b.outcome as "stated" | "nothing_arrived" | "no_answer" | undefined,
      mode: b.mode as "probe" | "landing" | undefined,
    });
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

http.route({ path: "/eval/manualEdit", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  { const rl = await limited(ctx, req, "eval", 300, 300 / 60); if (rl) return rl; }
  const b = await body(req);
  try {
    const res = await ctx.runAction(api.bankAccounts.manualEdit, { vendorId: b.vendorId as Id<"vendors">, routing: String(b.routing), accountNumber: String(b.accountNumber), replacesAccountId: b.replacesAccountId ? (b.replacesAccountId as Id<"bankAccounts">) : undefined });
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

http.route({ path: "/eval/pay", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  { const rl = await limited(ctx, req, "eval", 300, 300 / 60); if (rl) return rl; }
  const b = await body(req);
  try {
    const res = await ctx.runMutation(api.payments.send, { invoiceId: b.invoiceId as Id<"invoices">, initiatedBy: String(b.initiatedBy ?? "eval"), rail: (b.rail as "ach" | "wire" | undefined) ?? "ach" });
    return json(res);
  } catch (e) {
    const data = errorPayload(e) as { reason?: string; message?: string };
    return json({ ok: false, reason: data.reason ?? data.message ?? "error", error: data }, 200);
  }
}) });

http.route({ path: "/eval/setting", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  await ctx.runMutation(internal.settingsInternal.setInternal, { key: String(b.key), value: String(b.value) });
  return json({ ok: true });
}) });

http.route({ path: "/eval/craftInvoice", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  const invoiceId = await ctx.runMutation(internal.evalQueries.craftInvoice, { vendorId: b.vendorId as Id<"vendors">, remitAccountId: b.remitAccountId as Id<"bankAccounts">, number: String(b.number ?? `EVAL-${Date.now()}`), amountCents: Number(b.amountCents ?? 100000) });
  return json({ ok: true, invoiceId });
}) });

http.route({ path: "/eval/createVendor", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  const vendorId = await ctx.runMutation(internal.evalQueries.createVendor, { name: String(b.name), domain: String(b.domain), slug: String(b.slug), phone: b.phone ? String(b.phone) : undefined, phoneTrust: b.phoneTrust as "record" | "untrusted" | "discovered" | undefined });
  let account: unknown = null;
  if (b.routing && b.accountNumber) {
    account = await ctx.runAction(internal.bankAccounts.createUnverified, { vendorId, routing: String(b.routing), accountNumberPlain: String(b.accountNumber), createdVia: "seed" });
  }
  let invoiceId: unknown = null;
  if (b.invoiceAmountCents && account && (account as { accountId: Id<"bankAccounts"> }).accountId) {
    invoiceId = await ctx.runMutation(internal.evalQueries.craftInvoice, { vendorId, remitAccountId: (account as { accountId: Id<"bankAccounts"> }).accountId, number: String(b.invoiceNumber ?? `NEW-${Date.now()}`), amountCents: Number(b.invoiceAmountCents) });
  }
  return json({ ok: true, vendorId, account, invoiceId });
}) });

http.route({ path: "/eval/report", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  const n = await ctx.runMutation(internal.evalQueries.reportRun, { results: (b.results as unknown[]) ?? [] });
  return json({ ok: true, count: n });
}) });

http.route({ path: "/eval/exceptionalRelease", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  try {
    await ctx.runMutation(api.cases.exceptionalRelease, { caseId: b.caseId as Id<"cases">, approverA: String(b.approverA), approverB: String(b.approverB), reason: String(b.reason) });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

http.route({ path: "/eval/markFraud", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  try {
    await ctx.runMutation(api.cases.markFraud, { caseId: b.caseId as Id<"cases">, reason: String(b.reason ?? "eval: marked fraud") });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

http.route({ path: "/eval/portalLogin", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  try {
    const res = await ctx.runAction(api.portalAuth.login, { username: String(b.username), password: String(b.password) });
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

http.route({ path: "/eval/portalRequests", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  const res = await ctx.runQuery(api.channels.portal.openRequestsForSession, { sessionToken: String(b.sessionToken) });
  return json({ ok: true, ...res });
}) });

http.route({ path: "/eval/portalConfirm", method: "POST", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const b = await body(req);
  try {
    const res = await ctx.runMutation(internal.channels.portal.confirmInternal, { sessionToken: String(b.sessionToken), token: String(b.token), statedAmountCents: typeof b.statedAmountCents === "number" ? b.statedAmountCents : null });
    return json(res);
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

http.route({ path: "/eval/paymentRun", method: "GET", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  return json(await ctx.runQuery(api.paymentRun.preview, {}));
}) });

http.route({ path: "/eval/overview", method: "GET", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  return json(await ctx.runQuery(internal.evalQueries.overview, {}));
}) });

http.route({ pathPrefix: "/eval/case/", method: "GET", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const id = new URL(req.url).pathname.split("/").pop()!;
  try {
    const res = await ctx.runQuery(internal.evalQueries.caseView, { caseId: id as Id<"cases"> });
    return res ? json(res) : json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: errorPayload(e) }, 400);
  }
}) });

http.route({ pathPrefix: "/eval/vendor/", method: "GET", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  // /eval/vendor/{id}  or  /eval/vendor/slug/{slug}
  if (parts[2] === "slug") {
    const vnd = await ctx.runQuery(internal.evalQueries.vendorBySlug, { slug: parts[3] });
    if (!vnd) return json({ error: "not_found" }, 404);
    return json(await ctx.runQuery(internal.evalQueries.vendorView, { vendorId: vnd._id }));
  }
  try {
    const res = await ctx.runQuery(internal.evalQueries.vendorView, { vendorId: parts[2] as Id<"vendors"> });
    return res ? json(res) : json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: errorPayload(e) }, 400);
  }
}) });

http.route({ pathPrefix: "/eval/message/", method: "GET", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const id = new URL(req.url).pathname.split("/").pop()!;
  try {
    const m = await ctx.runQuery(api.messages.get, { messageId: id as Id<"messages"> });
    return m ? json(m) : json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: errorPayload(e) }, 400);
  }
}) });

http.route({ pathPrefix: "/eval/invoice/", method: "GET", handler: httpAction(async (ctx, req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const number = decodeURIComponent(new URL(req.url).pathname.split("/").pop()!);
  const inv = await ctx.runQuery(internal.evalQueries.invoiceByNumber, { number });
  return inv ? json(inv) : json({ error: "not_found" }, 404);
}) });

// TEST-ONLY: exposes the probe amount so the eval harness can script a "correct" vendor statement.
// Guarded by EVAL_KEY. Documented in README/STATUS. Never used by the UI.
http.route({ path: "/health", method: "GET", handler: httpAction(async (ctx) => {
  const s = await ctx.runQuery(api.health.status, {});
  return json({ ok: true, ...s });
}) });

http.route({ pathPrefix: "/eval/probeAmount/", method: "GET", handler: httpAction(async (ctx, req) => {
  // TEST-ONLY. Exists only when EVAL_PROBE_AMOUNT_ENDPOINT=1 is set on the deployment (dev); 404 on prod.
  if (process.env.EVAL_PROBE_AMOUNT_ENDPOINT !== "1") return json({ error: "not_found" }, 404);
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const id = new URL(req.url).pathname.split("/").pop()!;
  try {
    const amountCents = await ctx.runQuery(internal.probes.amountForTest, { caseId: id as Id<"cases"> });
    return json({ amountCents, testOnly: true });
  } catch (e) {
    return json({ error: errorPayload(e) }, 400);
  }
}) });

// ---- Vapi webhook. Authenticated by the shared secret Vapi sends back (`server.secret` on the assistant,
// delivered as `x-vapi-secret`). Fail closed when the secret is not configured. The case binding is
// resolved server-side from the call id (voiceCalls), never from metadata in the body. ----
http.route({ path: "/vapi/webhook", method: "POST", handler: httpAction(async (ctx, req) => {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-vapi-secret") ?? "", secret)) return json({ error: "unauthorized" }, 401);
  const b = (await body(req)) as Record<string, unknown>;
  await ctx.runAction(internal.channels.vapiWebhook.handle, { payload: b });
  // A `tool-calls` message expects {results:[{name, toolCallId, result}]} so the assistant can continue.
  const m = ((b as { message?: Record<string, unknown> }).message ?? b) as Record<string, unknown>;
  const list = (m.toolCallList ?? []) as { id?: string; function?: { name?: string } }[];
  if (m.type === "tool-calls" && list.length) {
    return json({ results: list.map((tc) => ({ name: tc.function?.name ?? "recordStatedAmount", toolCallId: tc.id ?? "", result: "Recorded. Thank the person and end the call." })) });
  }
  return json({ ok: true });
}) });

// ---- Vendor portal (Next.js route handlers call these) ----
http.route({ path: "/portal/login", method: "POST", handler: httpAction(async (ctx, req) => {
  const rl = await limited(ctx, req, "portal-login", 10, 10 / 60); if (rl) return rl;
  const b = await body(req);
  try {
    const res = await ctx.runAction(api.portalAuth.login, { username: String(b.username ?? ""), password: String(b.password ?? "") });
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 401);
  }
}) });

http.route({ path: "/portal/confirm", method: "POST", handler: httpAction(async (ctx, req) => {
  const rl = await limited(ctx, req, "portal-confirm", 30, 30 / 60); if (rl) return rl;
  const b = await body(req);
  try {
    const res = await ctx.runMutation(internal.channels.portal.confirmInternal, { sessionToken: String(b.sessionToken ?? ""), token: String(b.token ?? ""), statedAmountCents: typeof b.statedAmountCents === "number" ? b.statedAmountCents : null });
    return json(res);
  } catch (e) {
    return json({ ok: false, error: errorPayload(e) }, 400);
  }
}) });

registerApiRoutes(http);

export default http;
