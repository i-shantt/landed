// Public REST API and outbound webhooks: auth, scopes, idempotency, pagination, the payment boundary
// through the API, event feed, signed deliveries and the built-in inbox.
import { describe, it, expect, vi, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, drain, VENDOR_B_ACCOUNT } from "./harness";
import { signWebhook, verifyWebhookSignature } from "../convex/api/util";
import { buildEventBody, isAllowedWebhookUrl } from "../convex/webhooks/dispatch";

async function keyFor(t: Awaited<ReturnType<typeof setup>>["t"], scopes: string[]) {
  const ops = await t.query(api.controls.operators.list, {});
  const admin = ops.find((o) => o.role === "admin")!;
  const r = await t.action(api.api.keys.create, { operatorId: admin._id, name: "erp", scopes });
  return { key: r.key, admin, prefix: r.prefix };
}
const H = (key: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${key}`, "content-type": "application/json", ...extra });

describe("REST API: payment risk", () => {
  it("GET /payments/{id} and /payments/{id}/risk return the learned-model assessment with a read key", async () => {
    const { t, ids } = await setup();
    const { key } = await keyFor(t, ["read", "write:payments"]);
    const sent = await t.fetch("/api/v1/payments", { method: "POST", headers: H(key), body: JSON.stringify({ invoice_id: ids.invoices["CC-2026-0412"] }) });
    expect(sent.status).toBe(201);
    const pid = (await sent.json()).id as string;
    const one = await t.fetch(`/api/v1/payments/${pid}`, { headers: H(key) });
    expect(one.status).toBe(200);
    expect((await one.json()).amount_cents).toBe(4_200_000);
    const risk = await t.fetch(`/api/v1/payments/${pid}/risk`, { headers: H(key) });
    expect(risk.status).toBe(200);
    const body = await risk.json();
    expect(body.object).toBe("payment_risk");
    expect(body.model_version).toMatch(/^transaction_lr-/);
    expect(body.probability).toBeGreaterThanOrEqual(0);
    expect(body.probability).toBeLessThanOrEqual(1);
    expect(body.contributions.length).toBe(20);
    expect((await t.fetch(`/api/v1/payments/${pid}/nope`, { headers: H(key) })).status).toBe(404);
    expect((await t.fetch(`/api/v1/payments/${pid}/risk`)).status).toBe(401);
    const spec = await (await t.fetch("/api/v1/openapi.json", { headers: H(key) })).json();
    expect(spec.paths["/payments/{id}/risk"]).toBeDefined();
    expect(spec.components.schemas.PaymentRisk).toBeDefined();
  });
});

describe("REST API", () => {
  it("rejects missing, malformed, unknown and revoked keys; enforces scopes", async () => {
    const { t } = await setup();
    expect((await t.fetch("/api/v1/ping")).status).toBe(401);
    expect((await t.fetch("/api/v1/ping", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await t.fetch("/api/v1/ping", { headers: { authorization: "Bearer ld_live_sk_0000" } })).status).toBe(401);
    const { key, admin } = await keyFor(t, ["read"]);
    const ok = await t.fetch("/api/v1/ping", { headers: H(key) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).scopes).toEqual(["read"]);
    const denied = await t.fetch("/api/v1/payments", { method: "POST", headers: H(key), body: JSON.stringify({ invoice_id: "x" }) });
    expect(denied.status).toBe(403);
    const keys = await t.query(api.api.keys.list, {});
    expect(keys[0].prefix.startsWith("ld_live_sk_")).toBe(true);
    expect(JSON.stringify(keys)).not.toContain(key);
    await t.mutation(api.api.keys.revoke, { operatorId: admin._id, apiKeyId: keys[0]._id });
    expect((await t.fetch("/api/v1/ping", { headers: H(key) })).status).toBe(401);
  });

  it("only an admin can mint keys and unknown scopes are refused", async () => {
    const { t } = await setup();
    const ops = await t.query(api.controls.operators.list, {});
    const clerk = ops.find((o) => o.role === "clerk")!;
    const admin = ops.find((o) => o.role === "admin")!;
    await expect(t.action(api.api.keys.create, { operatorId: clerk._id, name: "x", scopes: ["read"] })).rejects.toThrow();
    await expect(t.action(api.api.keys.create, { operatorId: admin._id, name: "x", scopes: ["root"] })).rejects.toThrow(/unknown_scopes/);
  });

  it("lists vendors with cursor pagination and serves the OpenAPI document without a key", async () => {
    const { t } = await setup();
    const { key } = await keyFor(t, ["read"]);
    const p1 = await (await t.fetch("/api/v1/vendors?limit=1", { headers: H(key) })).json();
    expect(p1.object).toBe("list");
    expect(p1.data.length).toBe(1);
    expect(p1.has_more).toBe(true);
    const p2 = await (await t.fetch(`/api/v1/vendors?limit=10&starting_after=${p1.data[0].id}`, { headers: H(key) })).json();
    expect(p2.data.find((vnd: { id: string }) => vnd.id === p1.data[0].id)).toBeUndefined();
    const spec = await (await t.fetch("/api/v1/openapi.json")).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/bank-changes");
  });

  it("a bank change through the API opens a held case; the payment endpoint is refused by the same boundary", async () => {
    const { t, ids } = await setup();
    const { key } = await keyFor(t, ["read", "write:changes", "write:payments"]);
    const cleanco = ids.vendors.cleanco as string;
    const res = await t.fetch("/api/v1/bank-changes", { method: "POST", headers: H(key, { "idempotency-key": "chg-1" }), body: JSON.stringify({ vendor_id: cleanco, routing: VENDOR_B_ACCOUNT.routing, account_number: VENDOR_B_ACCOUNT.accountNumber, replaces_account_id: ids.accounts.cleanco_main }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.object).toBe("bank_change");
    expect(body.case_id).toBeTruthy();
    await drain(t);
    const c = await (await t.fetch(`/api/v1/cases/${body.case_id}`, { headers: H(key) })).json();
    expect(["HELD", "PROBE_SENT"]).toContain(c.state);
    expect(JSON.stringify(c)).not.toContain("amountCents\":0.");
    // the invoice now remits to the unverified account; paying is refused with the guard's reason
    const pay = await t.fetch("/api/v1/payments", { method: "POST", headers: H(key), body: JSON.stringify({ invoice_id: ids.invoices["CC-2026-0412"] }) });
    expect(pay.status).toBe(409);
    expect((await pay.json()).error.reason).toBe("destination_not_verified");
    // risk + events sub-resources
    const risk = await (await t.fetch(`/api/v1/cases/${body.case_id}/risk`, { headers: H(key) })).json();
    expect(risk.object).toBe("risk_assessment");
    expect(typeof risk.score).toBe("number");
    const evs = await (await t.fetch(`/api/v1/cases/${body.case_id}/events`, { headers: H(key) })).json();
    expect(evs.data.some((e: { type: string }) => e.type === "case_opened")).toBe(true);
    const feed = await (await t.fetch("/api/v1/events?type=case_opened&limit=5", { headers: H(key) })).json();
    expect(feed.data.length).toBeGreaterThan(0);
    expect(feed.data[0].id.startsWith("evt_")).toBe(true);
  });

  it("Idempotency-Key replays the stored response and rejects a different body", async () => {
    const { t, ids } = await setup();
    const { key } = await keyFor(t, ["read", "write:changes"]);
    const mk = (n: string) => ({ vendor_id: ids.vendors.cleanco, number: n, amount_cents: 12_345, due_in_days: 10 });
    const a = await t.fetch("/api/v1/invoices", { method: "POST", headers: H(key, { "idempotency-key": "inv-1" }), body: JSON.stringify(mk("API-1")) });
    expect(a.status).toBe(201);
    const b = await t.fetch("/api/v1/invoices", { method: "POST", headers: H(key, { "idempotency-key": "inv-1" }), body: JSON.stringify(mk("API-1")) });
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect((await b.json()).id).toBe((await a.json()).id);
    const c = await t.fetch("/api/v1/invoices", { method: "POST", headers: H(key, { "idempotency-key": "inv-1" }), body: JSON.stringify(mk("API-2")) });
    expect(c.status).toBe(409);
    const invoices = await t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_number", (q) => q.eq("number", "API-1")).collect());
    expect(invoices.length).toBe(1);
  });

  it("paying a verified invoice through the API sends exactly one payment and records the key as initiator", async () => {
    const { t, ids } = await setup();
    const { key } = await keyFor(t, ["read", "write:payments"]);
    const res = await t.fetch("/api/v1/payments", { method: "POST", headers: H(key, { "idempotency-key": "pay-1" }), body: JSON.stringify({ invoice_id: ids.invoices["CC-2026-0412"] }) });
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.initiated_by).toBe("api:erp");
    const again = await t.fetch("/api/v1/payments", { method: "POST", headers: H(key), body: JSON.stringify({ invoice_id: ids.invoices["CC-2026-0412"] }) });
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate).toBe(true);
    const payments = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments.length).toBe(1);
  });
});

describe("webhooks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signature scheme round-trips, tolerates rotation and rejects stale or forged headers", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment_sent" });
    const sig = await signWebhook("whsec_a", body, 1_700_000_000);
    expect(sig).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect((await verifyWebhookSignature("whsec_a", body, sig, 1_700_000_010)).ok).toBe(true);
    expect((await verifyWebhookSignature("whsec_b", body, sig, 1_700_000_010)).ok).toBe(false);
    expect((await verifyWebhookSignature("whsec_a", body + " ", sig, 1_700_000_010)).ok).toBe(false);
    expect((await verifyWebhookSignature("whsec_a", body, sig, 1_700_001_000)).reason).toBe("timestamp_outside_tolerance");
    const rotated = `${sig},v1=deadbeef`;
    expect((await verifyWebhookSignature("whsec_a", body, rotated, 1_700_000_010)).ok).toBe(true);
    expect(buildEventBody({ _id: "e1", type: "payment_sent", at: 1_700_000_000_000, actor: "human", caseId: "c1", payload: { amountCents: 5 } }, "d1", 1)).toMatchObject({ id: "evt_e1", object: "event", type: "payment_sent", created: 1_700_000_000, data: { object: { case_id: "c1", amountCents: 5 } } });
  });

  it("refuses private and plaintext endpoint URLs", () => {
    expect(isAllowedWebhookUrl("http://169.254.169.254/latest", undefined).ok).toBe(false);
    expect(isAllowedWebhookUrl("https://10.0.0.5/hook", undefined).ok).toBe(false);
    expect(isAllowedWebhookUrl("http://example.com/hook", undefined).reason).toBe("https_required");
    expect(isAllowedWebhookUrl("https://erp.example.com/landed", undefined).ok).toBe(true);
    expect(isAllowedWebhookUrl("https://x.convex.site/webhooks/inbox", "https://x.convex.site").ok).toBe(true);
  });

  it("pump fans events out to subscribed endpoints, deliveries are signed, the inbox verifies them, and failures back off", async () => {
    const { t, ids } = await setup();
    const ops = await t.query(api.controls.operators.list, {});
    const admin = ops.find((o) => o.role === "admin")!;
    const clerk = ops.find((o) => o.role === "clerk")!;
    await expect(t.mutation(api.webhooks.dispatch.createEndpoint, { operatorId: clerk._id, url: "https://erp.example.com/h", eventTypes: ["*"] })).rejects.toThrow();
    const ep = await t.mutation(api.webhooks.dispatch.createEndpoint, { operatorId: admin._id, url: "https://erp.example.com/landed", description: "ERP", eventTypes: ["payment_sent", "payment_refused"] });
    expect(ep.secret.startsWith("whsec_")).toBe(true);
    // first pump sets the cursor after existing events
    await t.mutation(internal.webhooks.dispatch.pump, {});
    await drain(t);
    // a payment produces payment_sent (subscribed) and other events (not subscribed)
    await t.mutation(api.payments.send, { invoiceId: ids.invoices["CC-2026-0412"] as Id<"invoices">, initiatedBy: "test", rail: "ach" });
    await drain(t);

    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    let respondWith = 200;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>)), body: String(init.body) });
      return new Response("ok", { status: respondWith });
    });
    await t.mutation(internal.webhooks.dispatch.pump, {});
    await drain(t);
    const deliveries = await t.query(api.webhooks.dispatch.deliveries, { endpointId: ep.id });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].eventType).toBe("payment_sent");
    expect(deliveries[0].status).toBe("delivered");
    expect(seen.length).toBe(1);
    const sigHeader = seen[0].headers["landed-signature"];
    expect((await verifyWebhookSignature(ep.secret, seen[0].body, sigHeader, Math.floor(Date.now() / 1000))).ok).toBe(true);
    const payload = JSON.parse(seen[0].body);
    expect(payload.type).toBe("payment_sent");
    expect(payload.data.object.amountCents).toBeGreaterThan(0);

    // the receiver side: our inbox verifies with the endpoint's secret
    process.env.CONVEX_SITE_URL = "https://test.convex.site";
    const inboxEp = await t.mutation(api.webhooks.dispatch.createInboxEndpoint, { operatorId: admin._id });
    expect(inboxEp.id).toBeTruthy();
    const endpoints = await t.query(api.webhooks.dispatch.endpoints, {});
    const inboxUrl = endpoints.find((e) => e._id === inboxEp.id)!.url;
    const secret = await t.run(async (ctx) => (await ctx.db.get(inboxEp.id))!.secret);
    const body = JSON.stringify({ id: "evt_x", type: "ping", data: { object: {} } });
    const good = await t.fetch(new URL(inboxUrl).pathname, { method: "POST", headers: { "landed-signature": await signWebhook(secret, body, Math.floor(Date.now() / 1000)), "content-type": "application/json" }, body });
    expect(good.status).toBe(200);
    const bad = await t.fetch(new URL(inboxUrl).pathname, { method: "POST", headers: { "landed-signature": "t=1,v1=00", "content-type": "application/json" }, body });
    expect(bad.status).toBe(400);
    const inbox = await t.query(api.webhooks.dispatch.inbox, {});
    expect(inbox.map((r) => r.signatureValid).sort()).toEqual([false, true]);

    // failure path: 500 -> failed with a future retry, attempt counted
    respondWith = 500;
    await t.mutation(api.payments.send, { invoiceId: ids.invoices["CC-2026-0412"] as Id<"invoices">, initiatedBy: "test", rail: "ach" }); // duplicate: no new payment_sent
    const inv2 = await t.run(async (ctx) => {
      const inv = (await ctx.db.get(ids.invoices["CC-2026-0412"] as Id<"invoices">))!;
      return ctx.db.insert("invoices", { vendorId: inv.vendorId, number: "CC-2", amountCents: 100, issuedAt: Date.now(), dueAt: Date.now(), remitAccountId: inv.remitAccountId, status: "open" });
    });
    await t.mutation(api.payments.send, { invoiceId: inv2, initiatedBy: "test", rail: "ach" });
    await drain(t);
    await t.mutation(internal.webhooks.dispatch.pump, {});
    await drain(t);
    const d2 = (await t.query(api.webhooks.dispatch.deliveries, { endpointId: ep.id })).find((d) => d.status !== "delivered")!;
    expect(d2.status).toBe("failed");
    expect(d2.attempt).toBe(1);
    expect(d2.nextAttemptAt).toBeGreaterThan(Date.now() + 30_000);
    expect(d2.lastStatusCode).toBe(500);
  });
});
