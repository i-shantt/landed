// Shared helpers for HTTP surfaces: JSON responses, constant-time compare, hashing, signing.
// Web Crypto is available in HTTP actions and actions (not in queries/mutations).

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "idempotency_conflict"
  | "rate_limited"
  | "payment_refused"
  | "internal";

export function apiError(status: number, code: ApiErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return json({ error: { type: status >= 500 ? "api_error" : "request_error", code, message, ...extra } }, status);
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function hex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return hex(a);
}

/** Webhook signature, Stripe-style: `t=<unix seconds>,v1=<hmac-sha256 hex of "{t}.{body}">`. */
export async function signWebhook(secret: string, body: string, tSeconds: number): Promise<string> {
  const v1 = await hmacSha256Hex(secret, `${tSeconds}.${body}`);
  return `t=${tSeconds},v1=${v1}`;
}

/** Verify a `Landed-Signature` header. Tolerance in seconds (default 300). */
export async function verifyWebhookSignature(secret: string, body: string, header: string | null, nowSeconds: number, toleranceSeconds = 300): Promise<{ ok: boolean; reason?: string }> {
  if (!header) return { ok: false, reason: "missing_signature" };
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: "timestamp_outside_tolerance" };
  const expected = await hmacSha256Hex(secret, `${t}.${body}`);
  const candidates = header.split(",").map((kv) => kv.trim()).filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  return candidates.some((c) => safeEqual(c, expected)) ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
