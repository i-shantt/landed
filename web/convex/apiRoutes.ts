// Public REST API (v1) for ERP and AP-automation integrations, plus the signed webhook inbox.
// Conventions: Bearer API keys with scopes, `Idempotency-Key` on POST (24h), cursor pagination
// (`limit`, `starting_after`), typed errors `{error:{type,code,message}}`, per-key rate limit.
// Every write goes through the same mutations the dashboard uses: the payment boundary and the
// verification engine are unchanged, and the API can no more release money than a clerk can.
import type { HttpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { json, apiError, bearer, readJson, sha256Hex } from "./api/util";
import { openApiSpec } from "./api/openapi";
import { verifyAgainstAny } from "./webhooks/dispatch";

type Key = { _id: Id<"apiKeys">; name: string; prefix: string; scopes: string[] };
type Handler = (ctx: ActionCtx, req: Request, key: Key, params: { id?: string; body: Record<string, unknown>; url: URL }) => Promise<Response>;

const RATE_PER_MINUTE = 600;

async function authenticate(ctx: ActionCtx, req: Request): Promise<Key | Response> {
  const token = bearer(req);
  if (!token || !token.startsWith("ld_")) return apiError(401, "unauthorized", "Provide an API key: Authorization: Bearer ld_live_sk_…");
  const key = await ctx.runQuery(internal.api.keys.byHash, { keyHash: await sha256Hex(token) });
  if (!key) return apiError(401, "unauthorized", "Unknown or revoked API key");
  const rl = await ctx.runMutation(internal.rateLimit.take, { bucket: `api:${key._id}`, capacity: RATE_PER_MINUTE, refillPerSec: RATE_PER_MINUTE / 60 });
  if (!rl.ok) return apiError(429, "rate_limited", "Rate limit exceeded", { retry_after_ms: rl.retryAfterMs });
  await ctx.runMutation(internal.api.keys.touch, { apiKeyId: key._id });
  return key;
}

function requireScope(key: Key, scope: string): Response | null {
  if (key.scopes.includes(scope)) return null;
  return apiError(403, "forbidden", `This key lacks the '${scope}' scope`, { scopes: key.scopes });
}

function errorResponse(e: unknown): Response {
  if (e instanceof ConvexError) {
    const data = e.data as unknown;
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    const status = /not_found/.test(msg) ? 404 : 400;
    return apiError(status, status === 404 ? "not_found" : "invalid_request", msg);
  }
  const msg = String((e as Error)?.message ?? e);
  const m = msg.match(/Uncaught (?:ConvexError|Error): ([^\n]+)/);
  return apiError(400, "invalid_request", m ? m[1] : msg.slice(0, 300));
}

function page<T extends { _id: string }>(rows: T[], url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25) || 25));
  const after = url.searchParams.get("starting_after");
  let start = 0;
  if (after) {
    const idx = rows.findIndex((r) => r._id === after);
    start = idx >= 0 ? idx + 1 : rows.length;
  }
  const data = rows.slice(start, start + limit);
  return { object: "list", data, has_more: start + limit < rows.length, next_starting_after: data.length && start + limit < rows.length ? data[data.length - 1]._id : null };
}

/** Wrap a handler with auth, scope check, JSON parsing, idempotency (POST) and error mapping. */
function route(scope: string, handler: Handler, opts: { idempotent?: boolean } = {}) {
  return httpAction(async (ctx, req) => {
    const auth = await authenticate(ctx, req);
    if (auth instanceof Response) return auth;
    const denied = requireScope(auth, scope);
    if (denied) return denied;
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
      const parsed = await readJson(req);
      if (parsed === null) return apiError(400, "invalid_request", "Body must be a JSON object");
      body = parsed;
    }
    const id = url.pathname.split("/").filter(Boolean).pop();
    const idem = req.headers.get("idempotency-key");
    let scopeKey: string | null = null;
    let requestHash = "";
    if (opts.idempotent && idem) {
      if (idem.length > 255) return apiError(400, "invalid_request", "Idempotency-Key must be at most 255 characters");
      scopeKey = `${auth._id}:${url.pathname}:${idem}`;
      requestHash = await sha256Hex(JSON.stringify(body));
      const prior = await ctx.runQuery(internal.api.keys.idempotencyLookup, { scopeKey });
      if (prior) {
        if (prior.requestHash !== requestHash) return apiError(409, "idempotency_conflict", "Idempotency-Key was already used with a different request body");
        return new Response(prior.body, { status: prior.status, headers: { "content-type": "application/json", "idempotent-replayed": "true" } });
      }
    }
    let res: Response;
    try {
      res = await handler(ctx, req, auth, { id, body, url });
    } catch (e) {
      res = errorResponse(e);
    }
    if (scopeKey && res.status < 500) {
      const text = await res.clone().text();
      await ctx.runMutation(internal.api.keys.idempotencyStore, { scopeKey, requestHash, status: res.status, body: text });
    }
    return res;
  });
}

function vendorOut(vnd: { _id: string; name: string; domain: string; onboardedAt: number; hasPortalLogin: boolean }) {
  return { id: vnd._id, object: "vendor", name: vnd.name, domain: vnd.domain, onboarded_at: new Date(vnd.onboardedAt).toISOString(), has_portal_login: vnd.hasPortalLogin };
}
function accountOut(a: { _id: string; routing: string; accountLast4: string; status: string; version: number; firstPaidAt?: number; createdVia: string }) {
  return { id: a._id, object: "bank_account", routing: a.routing, last4: a.accountLast4, status: a.status, version: a.version, first_paid_at: a.firstPaidAt ? new Date(a.firstPaidAt).toISOString() : null, created_via: a.createdVia };
}
function caseOut(c: { _id: string; vendorId: string; state: string; triggerType: string; openedAt: number; closedAt?: number; humanReason?: string; contactAlsoChanged: boolean; slaDeadlineAt?: number; amountAtStakeCents?: number; vendorName?: string }) {
  return { id: c._id, object: "verification_case", vendor_id: c.vendorId, vendor_name: c.vendorName ?? undefined, state: c.state, trigger: c.triggerType, opened_at: new Date(c.openedAt).toISOString(), closed_at: c.closedAt ? new Date(c.closedAt).toISOString() : null, human_reason: c.humanReason ?? null, contact_also_changed: c.contactAlsoChanged, sla_deadline_at: c.slaDeadlineAt ? new Date(c.slaDeadlineAt).toISOString() : null, amount_at_stake_cents: c.amountAtStakeCents ?? undefined };
}
function invoiceOut(i: { _id: string; vendorId: string; number: string; amountCents: number; issuedAt: number; dueAt: number; remitAccountId: string; status: string }) {
  return { id: i._id, object: "invoice", vendor_id: i.vendorId, number: i.number, amount_cents: i.amountCents, issued_at: new Date(i.issuedAt).toISOString(), due_at: new Date(i.dueAt).toISOString(), remit_account_id: i.remitAccountId, status: i.status };
}
function paymentOut(p: { _id: string; vendorId: string; invoiceId: string; destinationAccountId: string; amountCents: number; rail: string; railRef?: string; sentAt: number; landingState: string; landingDeadlineAt: number; initiatedBy: string; caseId?: string }) {
  return { id: p._id, object: "payment", vendor_id: p.vendorId, invoice_id: p.invoiceId, destination_account_id: p.destinationAccountId, amount_cents: p.amountCents, rail: p.rail, rail_ref: p.railRef ?? null, sent_at: new Date(p.sentAt).toISOString(), landing_state: p.landingState, landing_deadline_at: new Date(p.landingDeadlineAt).toISOString(), initiated_by: p.initiatedBy, case_id: p.caseId ?? null };
}

export function registerApiRoutes(http: HttpRouter) {
  // ---- discovery ----
  http.route({ path: "/api/v1/openapi.json", method: "GET", handler: httpAction(async () => json(openApiSpec(), 200, { "access-control-allow-origin": "*" })) });
  http.route({ path: "/api/v1/ping", method: "GET", handler: route("read", async (_ctx, _req, key) => json({ object: "ping", key: key.prefix, scopes: key.scopes, now: new Date().toISOString() })) });

  // ---- vendors ----
  http.route({ path: "/api/v1/vendors", method: "GET", handler: route("read", async (ctx, _req, _key, { url }) => {
    const vendors = await ctx.runQuery(api.vendors.list, {});
    return json(page(vendors.map((vnd) => ({ ...vendorOut(vnd), _id: vnd._id as string, account_count: vnd.accountCount, verified_count: vnd.verifiedCount, open_cases: vnd.openCases })), url));
  }) });
  http.route({ path: "/api/v1/vendors", method: "POST", handler: route("write:vendors", async (ctx, _req, key, { body }) => {
    const name = String(body.name ?? "").trim();
    const domain = String(body.domain ?? "").trim().toLowerCase();
    if (!name || !domain) return apiError(400, "invalid_request", "name and domain are required");
    const vendorId = await ctx.runMutation(api.onboarding.createVendor, { name, domain, onboardedBy: `api:${key.name}` });
    if (typeof body.contact_of_record_phone === "string" && body.contact_of_record_phone.trim()) {
      await ctx.runMutation(api.onboarding.attestRecordContact, { vendorId, kind: "phone", value: body.contact_of_record_phone.trim(), attestedBy: `api:${key.name}`, reason: String(body.contact_attestation ?? "contact of record supplied at onboarding through the API") });
    }
    const vnd = await ctx.runQuery(api.vendors.get, { vendorId });
    return json(vnd ? { ...vendorOut(vnd), accounts: vnd.accounts.map(accountOut) } : { id: vendorId, object: "vendor" }, 201);
  }, { idempotent: true }) });
  http.route({ pathPrefix: "/api/v1/vendors/", method: "GET", handler: route("read", async (ctx, _req, _key, { id }) => {
    const vnd = await ctx.runQuery(api.vendors.get, { vendorId: id as Id<"vendors"> }).catch(() => null);
    if (!vnd) return apiError(404, "not_found", "No such vendor");
    const risk = await ctx.runQuery(api.risk.assess.forAll, {});
    return json({
      ...vendorOut(vnd),
      accounts: vnd.accounts.map(accountOut),
      contacts: vnd.contacts.map((c) => ({ id: c._id, kind: c.kind, value_masked: c.kind === "phone" ? c.value.replace(/\d(?=\d{4})/g, "*") : c.value, trust_level: c.trustLevel, established_via: c.establishedVia, superseded_at: c.supersededAt ? new Date(c.supersededAt).toISOString() : null })),
      cases: vnd.cases.map((c) => ({ ...caseOut(c), risk: risk[c._id] ?? null })),
      open_invoices: vnd.invoices.filter((i) => i.status !== "paid").map(invoiceOut),
    });
  }) });

  // ---- bank changes (the vendor-master write that opens a verification case) ----
  http.route({ path: "/api/v1/bank-changes", method: "POST", handler: route("write:changes", async (ctx, _req, key, { body }) => {
    const vendorId = String(body.vendor_id ?? "");
    const routing = String(body.routing ?? "").replace(/\D/g, "");
    const accountNumber = String(body.account_number ?? "").replace(/\D/g, "");
    if (!vendorId || routing.length !== 9 || accountNumber.length < 4 || accountNumber.length > 17) return apiError(400, "invalid_request", "vendor_id, a 9-digit routing and a 4-17 digit account_number are required");
    const res = await ctx.runAction(api.bankAccounts.manualEdit, { vendorId: vendorId as Id<"vendors">, routing, accountNumber, replacesAccountId: body.replaces_account_id ? (String(body.replaces_account_id) as Id<"bankAccounts">) : undefined });
    const c = res.caseId ? await ctx.runQuery(api.cases.get, { caseId: res.caseId }) : null;
    return json({ object: "bank_change", account_id: res.accountId, case_id: res.caseId, reused: res.reused, state: c?.state ?? (res.reused ? "already_verified" : null), submitted_by: `api:${key.name}`, note: "The account starts unverified. No payment can target it until the vendor's contact of record reads back the probe deposit." }, res.reused ? 200 : 201);
  }, { idempotent: true }) });

  // ---- cases ----
  http.route({ path: "/api/v1/cases", method: "GET", handler: route("read", async (ctx, _req, _key, { url }) => {
    const rows = await ctx.runQuery(api.cases.list, {});
    const state = url.searchParams.get("state");
    const filtered = state ? rows.filter((c) => c.state === state) : rows;
    return json(page(filtered.map((c) => ({ ...caseOut(c), _id: c._id as string })), url));
  }) });
  http.route({ pathPrefix: "/api/v1/cases/", method: "GET", handler: route("read", async (ctx, _req, _key, { id, url }) => {
    const parts = url.pathname.split("/").filter(Boolean); // api v1 cases :id [events|risk]
    const caseId = parts[3] as Id<"cases">;
    const sub = parts[4];
    if (sub === "events") {
      const evs = await ctx.runQuery(api.events.listForCase, { caseId }).catch(() => []);
      return json({ object: "list", data: evs.map((e) => ({ id: `evt_${e._id}`, object: "event", type: e.type, actor: e.actor, created: Math.floor(e.at / 1000), data: { object: e.payload } })), has_more: false });
    }
    if (sub === "risk") {
      const r = await ctx.runQuery(api.risk.assess.forCase, { caseId }).catch(() => null);
      return r ? json({ object: "risk_assessment", case_id: caseId, ...r }) : apiError(404, "not_found", "No such case");
    }
    const c = await ctx.runQuery(api.cases.get, { caseId: id as Id<"cases"> }).catch(() => null);
    if (!c) return apiError(404, "not_found", "No such case");
    return json({ ...caseOut(c), vendor: c.vendor ? { id: c.vendor._id, name: c.vendor.name, domain: c.vendor.domain } : null, new_account: c.newAccount ? accountOut(c.newAccount) : null, old_account: c.oldAccount ? accountOut(c.oldAccount) : null, probe: c.probe, payment: c.payment ? { id: c.payment._id, amount_cents: c.payment.amountCents, rail: c.payment.rail, landing_state: c.payment.landingState } : null, open_invoices: c.openInvoices.map((i) => ({ id: i._id, number: i.number, amount_cents: i.amountCents, status: i.status })) });
  }) });

  // ---- invoices ----
  http.route({ path: "/api/v1/invoices", method: "GET", handler: route("read", async (ctx, _req, _key, { url }) => {
    const rows = await ctx.runQuery(api.invoices.listOpen, {});
    return json(page(rows.map((i) => ({ ...invoiceOut(i), _id: i._id as string, vendor_name: (i as { vendorName?: string }).vendorName })), url));
  }) });
  http.route({ path: "/api/v1/invoices", method: "POST", handler: route("write:changes", async (ctx, _req, key, { body }) => {
    const vendorId = String(body.vendor_id ?? "");
    const number = String(body.number ?? "").trim();
    const amountCents = Number(body.amount_cents);
    if (!vendorId || !number || !Number.isInteger(amountCents) || amountCents <= 0) return apiError(400, "invalid_request", "vendor_id, number and a positive integer amount_cents are required");
    const dueInDays = Number(body.due_in_days ?? 30);
    const res = await ctx.runMutation(internal.api.mutations.createInvoice, { vendorId: vendorId as Id<"vendors">, number, amountCents, dueInDays: Number.isFinite(dueInDays) ? dueInDays : 30, createdBy: `api:${key.name}` });
    const inv = await ctx.runQuery(api.invoices.get, { invoiceId: res.invoiceId });
    return json(inv ? { ...invoiceOut(inv), created_by: `api:${key.name}` } : { id: res.invoiceId, object: "invoice" }, res.created ? 201 : 200);
  }, { idempotent: true }) });

  // ---- payments (same boundary as the dashboard) ----
  http.route({ path: "/api/v1/payments", method: "GET", handler: route("read", async (ctx, _req, _key, { url }) => {
    const rows = await ctx.runQuery(api.payments.list, {});
    return json(page(rows.map((p) => ({ ...paymentOut(p), _id: p._id as string })), url));
  }) });
  http.route({ path: "/api/v1/payments", method: "POST", handler: route("write:payments", async (ctx, _req, key, { body }) => {
    const invoiceId = String(body.invoice_id ?? "");
    const rail = body.rail === "wire" ? "wire" : "ach";
    if (!invoiceId) return apiError(400, "invalid_request", "invoice_id is required");
    const res = await ctx.runMutation(api.payments.send, { invoiceId: invoiceId as Id<"invoices">, initiatedBy: `api:${key.name}`, rail });
    if (!res.ok) return json({ error: { type: "request_error", code: "payment_refused", message: "The payment boundary refused this payment", reason: res.reason } }, 409);
    const p = await ctx.runQuery(api.payments.list, {});
    const row = p.find((x) => x._id === res.paymentId);
    return json({ ...(row ? paymentOut(row) : { id: res.paymentId, object: "payment" }), duplicate: res.duplicate }, res.duplicate ? 200 : 201);
  }, { idempotent: true }) });

  // ---- events (audit feed with cursor) ----
  http.route({ path: "/api/v1/events", method: "GET", handler: route("read", async (ctx, _req, _key, { url }) => {
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50) || 50);
    const type = url.searchParams.get("type");
    const r = await ctx.runQuery(api.audit.events, { type: type ?? undefined, limit: 2000 });
    const rows = r.events.slice().reverse().map((e) => ({ _id: `evt_${e._id}`, id: `evt_${e._id}`, object: "event", type: e.type, actor: e.actor, created: Math.floor(e.at / 1000), case_id: e.caseId, vendor_name: e.vendorName, data: { object: e.payload } }));
    const u = new URL(url.toString());
    u.searchParams.set("limit", String(limit));
    return json(page(rows, u));
  }) });

  // ---- payment files (full file, server-side only otherwise) ----
  http.route({ path: "/api/v1/payment-files", method: "GET", handler: route("files:read", async (ctx, _req, _key, { url }) => {
    const rows = await ctx.runQuery(api.exports.paymentFiles.list, {});
    return json(page(rows.map((f) => ({ _id: f._id as string, id: f._id, object: "payment_file", format: f.format, created_at: new Date(f.createdAt).toISOString(), created_by: f.createdBy, entry_count: f.entryCount, total_cents: f.totalCents, sha256: f.sha256 })), url));
  }) });
  http.route({ pathPrefix: "/api/v1/payment-files/", method: "GET", handler: route("files:read", async (ctx, _req, _key, { id }) => {
    const f = await ctx.runQuery(internal.exports.paymentFiles.fullFile, { fileId: id as Id<"paymentFiles"> }).catch(() => null);
    if (!f) return apiError(404, "not_found", "No such payment file");
    const blob = await ctx.storage.get(f.storageId);
    if (!blob) return apiError(404, "not_found", "File content missing");
    const ext = f.format === "nacha" ? "ach" : "xml";
    return new Response(blob, { status: 200, headers: { "content-type": f.format === "nacha" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8", "content-disposition": `attachment; filename="landed-${new Date(f.createdAt).toISOString().slice(0, 10)}-${String(id).slice(-6)}.${ext}"`, "x-content-sha256": f.sha256 } });
  }) });

  // ---- webhook endpoints (management through the API, same rules as the dashboard) ----
  http.route({ path: "/api/v1/webhook-endpoints", method: "GET", handler: route("webhooks:manage", async (ctx) => {
    const rows = await ctx.runQuery(api.webhooks.dispatch.endpoints, {});
    return json({ object: "list", data: rows.map((e) => ({ id: e._id, object: "webhook_endpoint", url: e.url, description: e.description, event_types: e.eventTypes, active: e.active, created_at: new Date(e.createdAt).toISOString(), stats: e.stats })), has_more: false });
  }) });

  // ---- built-in signed inbox: the receiver side, for demos and tests ----
  http.route({ path: "/webhooks/inbox", method: "POST", handler: httpAction(async (ctx, req) => {
    const text = await req.text();
    const url = new URL(req.url);
    const canonical = `${process.env.CONVEX_SITE_URL ?? `${url.protocol}//${url.host}`}/webhooks/inbox`;
    const secrets = await ctx.runQuery(internal.webhooks.dispatch.inboxSecretForUrl, { url: canonical });
    const valid = await verifyAgainstAny(secrets, text, req.headers.get("landed-signature"));
    let eventType = "unknown";
    let eventId = "";
    try {
      const b = JSON.parse(text) as { type?: string; id?: string };
      eventType = String(b.type ?? "unknown");
      eventId = String(b.id ?? "");
    } catch {
      /* keep defaults */
    }
    await ctx.runMutation(internal.webhooks.dispatch.inboxStore, { signatureValid: valid, eventType, eventId, body: text.slice(0, 20_000) });
    return json({ received: true, signature_valid: valid }, valid ? 200 : 400);
  }) });
}
