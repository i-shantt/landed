// OpenAPI 3.1 description of the public API, served at GET /api/v1/openapi.json.
const bearer = { bearerAuth: [] as string[] };
const idem = { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 255 }, description: "Optional. Replays return the original response with `Idempotent-Replayed: true`; a different body under the same key is a 409." };
const listParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  { name: "starting_after", in: "query", schema: { type: "string" }, description: "Cursor: the id of the last object on the previous page." },
];
const errorResponse = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };

export function openApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Landed API",
      version: "1.0.0",
      summary: "Payment controls for accounts payable: hold every vendor bank-account change, verify it with a probe deposit read back by the contact of record, and never pay an unverified destination.",
      description:
        "All endpoints require `Authorization: Bearer ld_live_sk_…`. Keys carry scopes (`read`, `write:changes`, `write:payments`, `write:vendors`, `files:read`, `webhooks:manage`). " +
        "Writes go through the same mutations the dashboard uses, so the API cannot release a payment that the payment boundary would refuse: `POST /payments` returns 409 `payment_refused` with the guard's reason. " +
        "Money is in integer cents. Timestamps are ISO 8601. Lists are cursor paginated (`limit`, `starting_after`, `has_more`). Rate limit: 600 requests per minute per key (429 with `retry_after_ms`). " +
        "Webhooks: subscribe endpoints to audit event types; each delivery is signed with `Landed-Signature: t=<unix>,v1=<hex HMAC-SHA256 of \"{t}.{raw body}\">` (300 s tolerance) and retried at 1m, 10m, 1h, 4h, 12h, 24h, 72h.",
    },
    servers: [{ url: "/api/v1" }],
    security: [bearer],
    tags: [{ name: "Vendors" }, { name: "Bank changes" }, { name: "Cases" }, { name: "Invoices" }, { name: "Payments" }, { name: "Events" }, { name: "Webhooks" }],
    paths: {
      "/ping": { get: { tags: ["Events"], summary: "Check a key", responses: { "200": { description: "Key is valid; returns its scopes" }, "401": errorResponse } } },
      "/vendors": {
        get: { tags: ["Vendors"], summary: "List vendors", parameters: listParams, responses: { "200": { description: "List of vendors" } } },
        post: {
          tags: ["Vendors"],
          summary: "Create a vendor (and optionally attest its contact of record)",
          parameters: [idem],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name", "domain"], properties: { name: { type: "string" }, domain: { type: "string" }, contact_of_record_phone: { type: "string", description: "E.164. Establishes the number that must read back probe deposits. Comes from a signed contract, never from an email." }, contact_attestation: { type: "string" } } } } } },
          responses: { "201": { description: "Vendor" }, "400": errorResponse, "403": errorResponse },
        },
      },
      "/vendors/{id}/trust": { get: { tags: ["Vendors"], summary: "Beneficiary trust score (0-100) with its components", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Vendor trust", content: { "application/json": { schema: { $ref: "#/components/schemas/VendorTrust" } } } }, "404": errorResponse } } },
      "/risk/trend": { get: { tags: ["Payments"], summary: "Per-day monitoring trend over the last 7 or 30 local days", parameters: [{ name: "window", in: "query", schema: { type: "string", enum: ["7d", "30d"], default: "7d" } }], responses: { "200": { description: "Trend", content: { "application/json": { schema: { $ref: "#/components/schemas/RiskTrend" } } } } } } },
      "/vendors/{id}": { get: { tags: ["Vendors"], summary: "Vendor with accounts, contacts (masked), cases and open invoices", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Vendor" }, "404": errorResponse } } },
      "/bank-changes": {
        post: {
          tags: ["Bank changes"],
          summary: "Submit a bank-account change for a vendor",
          description: "Creates a new, unverified account version and opens a verification case. Open invoices follow the request and are held. Nothing can be paid to the account until the vendor's contact of record reads back the probe deposit. Known-bad numbers (previously rejected, or used by another vendor) skip the probe and go straight to a human.",
          parameters: [idem],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["vendor_id", "routing", "account_number"], properties: { vendor_id: { type: "string" }, routing: { type: "string", pattern: "^\\d{9}$" }, account_number: { type: "string", pattern: "^\\d{4,17}$" }, replaces_account_id: { type: "string" } } } } } },
          responses: { "201": { description: "Case opened", content: { "application/json": { schema: { $ref: "#/components/schemas/BankChange" } } } }, "200": { description: "Account already verified or already in verification" }, "400": errorResponse },
        },
      },
      "/cases": { get: { tags: ["Cases"], summary: "List verification cases", parameters: [...listParams, { name: "state", in: "query", schema: { type: "string", enum: ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "VERIFIED", "PAID", "LANDED", "NEEDS_HUMAN", "UNCONFIRMED", "RECOVERY", "CLOSED"] } }], responses: { "200": { description: "List of cases" } } } },
      "/cases/{id}": { get: { tags: ["Cases"], summary: "Case detail (probe projection never includes the amount)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Case" }, "404": errorResponse } } },
      "/cases/{id}/events": { get: { tags: ["Cases"], summary: "Append-only timeline of a case", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Events" } } } },
      "/payments/{id}": { get: { tags: ["Payments"], summary: "Retrieve a payment", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Payment", content: { "application/json": { schema: { $ref: "#/components/schemas/Payment" } } } }, "404": { description: "Not found" } } } },
      "/payments/{id}/monitoring": { get: { tags: ["Payments"], summary: "Transaction-monitoring signals for a sent payment against the vendor's own history", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Payment monitoring", content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentMonitoring" } } } }, "404": { description: "Not found" } } } },
      "/payments/{id}/risk": { get: { tags: ["Payments"], summary: "Learned-model assessment of a sent payment, scored with the history that existed before it", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Payment risk", content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRisk" } } } }, "404": { description: "Not found" } } } },
      "/cases/{id}/risk": { get: { tags: ["Cases"], summary: "Deterministic, explainable risk assessment", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Risk assessment", content: { "application/json": { schema: { $ref: "#/components/schemas/RiskAssessment" } } } } } } },
      "/invoices": {
        get: { tags: ["Invoices"], summary: "Open and held invoices", parameters: listParams, responses: { "200": { description: "List" } } },
        post: { tags: ["Invoices"], summary: "Record an invoice (remits to the vendor's current account)", parameters: [idem], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["vendor_id", "number", "amount_cents"], properties: { vendor_id: { type: "string" }, number: { type: "string" }, amount_cents: { type: "integer", minimum: 1 }, due_in_days: { type: "integer", default: 30 } } } } } }, responses: { "201": { description: "Invoice" }, "400": errorResponse } },
      },
      "/payments": {
        get: { tags: ["Payments"], summary: "List payments with landing state", parameters: listParams, responses: { "200": { description: "List" } } },
        post: {
          tags: ["Payments"],
          summary: "Send a payment for an invoice",
          description: "Runs the exact payment boundary (`payments.send`): the destination must exist, belong to the vendor, be verified and current; then company policy (dual approval, risk review, cooling-off, velocity, ACH-first, screening). A refusal is 409 with `reason`. Idempotent per invoice and destination.",
          parameters: [idem],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["invoice_id"], properties: { invoice_id: { type: "string" }, rail: { type: "string", enum: ["ach", "wire"], default: "ach" } } } } } },
          responses: { "201": { description: "Payment sent" }, "200": { description: "Duplicate (already sent)" }, "409": { description: "Refused by the payment boundary or policy", content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRefused" } } } } },
        },
      },
      "/events": { get: { tags: ["Events"], summary: "Audit event feed (oldest first; poll with starting_after)", parameters: [...listParams, { name: "type", in: "query", schema: { type: "string" } }], responses: { "200": { description: "List of events" } } } },
      "/webhook-endpoints": { get: { tags: ["Webhooks"], summary: "List webhook endpoints", responses: { "200": { description: "List" } } } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "ld_live_sk_…" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { type: { type: "string", enum: ["request_error", "api_error"] }, code: { type: "string" }, message: { type: "string" } } } } },
        BankChange: { type: "object", properties: { object: { const: "bank_change" }, account_id: { type: "string" }, case_id: { type: ["string", "null"] }, reused: { type: "boolean" }, state: { type: ["string", "null"] } } },
        PaymentRefused: { type: "object", properties: { error: { type: "object", properties: { code: { const: "payment_refused" }, reason: { type: "string", enum: ["destination_missing", "destination_vendor_mismatch", "destination_not_verified", "destination_disputed", "destination_superseded", "destination_stale_version", "invoice_missing", "invoice_not_open", "policy_approval_required", "policy_risk_review_required", "policy_monitoring_review_required", "policy_cooling_off", "policy_velocity_exceeded", "policy_wire_blocked_for_new_account", "policy_screening_hit"] } } } } },
        RiskAssessment: { type: "object", properties: { score: { type: "integer", minimum: 0, maximum: 100, description: "Rules-only score; the policy input" }, tier: { type: "string", enum: ["low", "elevated", "high", "critical"] }, signals: { type: "array", items: { type: "object", properties: { id: { type: "string" }, weight: { type: "integer" }, title: { type: "string" }, evidence: { type: "string" } } } }, recommendation: { type: "string" }, model: { type: "object", description: "Learned layer: logistic regression trained on public PaySim/Sparkov data and an email TF-IDF model; raises combinedScore, never lowers the rules score", properties: { payment: { oneOf: [{ $ref: "#/components/schemas/PaymentRisk" }, { type: "null" }] }, text: { oneOf: [{ type: "object", properties: { version: { type: "string" }, probability: { type: "number" }, flagged: { type: "boolean" }, topTokens: { type: "array", items: { type: "object", properties: { token: { type: "string" }, contribution: { type: "number" } } } } } }, { type: "null" }] }, combinedScore: { type: "integer", minimum: 0, maximum: 100 } } } } },
        Payment: { type: "object", properties: { id: { type: "string" }, object: { const: "payment" }, vendor_id: { type: "string" }, invoice_id: { type: "string" }, destination_account_id: { type: "string" }, amount_cents: { type: "integer" }, rail: { type: "string", enum: ["ach", "wire"] }, rail_ref: { type: "string", nullable: true }, sent_at: { type: "string", format: "date-time" }, landing_state: { type: "string", enum: ["pending", "landed", "unconfirmed"] }, landing_deadline_at: { type: "string", format: "date-time" }, initiated_by: { type: "string" }, case_id: { type: "string", nullable: true } } },
        PaymentMonitoring: { type: "object", properties: { object: { const: "payment_monitoring" }, payment_id: { type: "string" }, flag_score: { type: "integer", minimum: 0, maximum: 100 }, flagged: { type: "boolean" }, signals: { type: "array", items: { type: "object", properties: { id: { type: "string" }, weight: { type: "integer" }, title: { type: "string" }, evidence: { type: "string" } } } }, checked: { type: "array", items: { type: "string" } }, model_probability: { type: "number", nullable: true }, model_version: { type: "string", nullable: true } } },
        VendorTrust: { type: "object", properties: { object: { const: "vendor_trust" }, vendor_id: { type: "string" }, score: { type: "integer", minimum: 0, maximum: 100 }, band: { type: "string", enum: ["new", "building", "established", "trusted"] }, components: { type: "array", items: { type: "object", properties: { id: { type: "string" }, points: { type: "number" }, evidence: { type: "string" } } } }, computed_at: { type: "string", format: "date-time" } } },
        RiskTrend: { type: "object", properties: { object: { const: "risk_trend" }, window: { type: "string", enum: ["7d", "30d"] }, as_of: { type: "string", format: "date-time" }, data: { type: "array", items: { type: "object", properties: { date: { type: "string", format: "date" }, payments: { type: "integer" }, flagged: { type: "integer" }, avg_risk: { type: "integer", nullable: true }, sent_cents: { type: "integer" }, held_cents: { type: "integer" } } } } } },
        PaymentRisk: { type: "object", properties: { object: { const: "payment_risk" }, payment_id: { type: "string" }, model_version: { type: "string" }, probability: { type: "number", minimum: 0, maximum: 1 }, score: { type: "integer", minimum: 0, maximum: 100 }, flagged: { type: "boolean" }, threshold: { type: "number" }, contributions: { type: "array", description: "Every feature's signed contribution to the logit, largest magnitude first", items: { type: "object", properties: { feature: { type: "string" }, value: { type: "number" }, contribution: { type: "number" } } } } } },
        Event: { type: "object", properties: { id: { type: "string" }, object: { const: "event" }, type: { type: "string" }, created: { type: "integer" }, livemode: { type: "boolean" }, data: { type: "object", properties: { object: { type: "object" } } } } },
      },
    },
    "x-webhooks": {
      signature: { header: "Landed-Signature", scheme: "t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>", tolerance_seconds: 300 },
      retry_schedule: ["immediate", "1m", "10m", "1h", "4h", "12h", "24h", "72h"],
      event_types: "Any audit event type; common ones: case_opened, invoices_held, probe_submitted, awaiting_confirmation, account_verified, escalated, payment_refused, payment_sent, payment_landed, landing_unconfirmed, recovery_started, change_rejected, approval_requested, approval_granted, vendor_screened, case_closed.",
    },
  };
}
