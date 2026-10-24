// Client-side helpers for the vendor portal. The session token is an httpOnly cookie set by
// /api/portal/login; it is never readable here. These functions only talk to the route handlers.
export type PortalError = { code: string; failsLeft?: number; retryAfterMs?: number; message?: string };

export type PortalRequests = { vendorName: string; companyName: string; requests: { token: string; attemptsLeft: number; expiresAt: number; accountLast4: string; routing: string }[] };
export type PortalTokenInfo = { attemptsLeft: number; usedAt: number | null; expiresAt: number; caseState: string | null; accountLast4: string; companyName: string; vendorName: string };

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T | null; error: PortalError | null }> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, ...init });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: PortalError } & T;
  if (!res.ok || json.ok === false) return { status: res.status, data: null, error: json.error ?? { code: `http_${res.status}` } };
  return { status: res.status, data: json as T, error: null };
}

export function portalLogin(username: string, password: string) {
  return call<{ vendorId: string }>("/api/portal/login", { method: "POST", body: JSON.stringify({ username, password }) });
}
export function portalLogout() {
  return call<{ ok: true }>("/api/portal/logout", { method: "POST" });
}
export function portalRequests() {
  return call<PortalRequests>("/api/portal/requests");
}
export function portalToken(token: string) {
  return call<PortalTokenInfo>(`/api/portal/token/${encodeURIComponent(token)}`);
}
export function portalConfirm(token: string, statedAmountCents: number | null) {
  return call<{ verified: boolean; attemptsLeft: number }>("/api/portal/confirm", { method: "POST", body: JSON.stringify({ token, statedAmountCents }) });
}

/** Plain-English copy for a portal error. */
export function portalErrorText(err: PortalError | null): string {
  if (!err) return "";
  switch (err.code) {
    case "bad_credentials":
      return typeof err.failsLeft === "number" ? `Wrong username or password (${err.failsLeft} attempt${err.failsLeft === 1 ? "" : "s"} left).` : "Wrong username or password.";
    case "locked": {
      const mins = Math.max(1, Math.ceil((err.retryAfterMs ?? 0) / 60_000));
      return `Too many attempts, try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
    }
    case "not_logged_in": return "Please sign in to the vendor portal first.";
    case "token_not_found": case "not_found": case "token_vendor_mismatch": return "This confirmation request was not found for your account.";
    case "token_used": return "This confirmation request has already been used.";
    case "token_expired": return "This confirmation request has expired.";
    case "no_attempts_left": return "No attempts left. The request has been escalated to a human.";
    default: return err.message ?? err.code.replace(/_/g, " ");
  }
}
