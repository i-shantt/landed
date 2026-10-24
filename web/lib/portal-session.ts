export const COOKIE = "landed_portal_session";

export function getPortalSession(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function setPortalSession(token: string) {
  const expires = new Date(Date.now() + 12 * 3600_000).toUTCString();
  document.cookie = `${COOKIE}=${encodeURIComponent(token)}; path=/; expires=${expires}; SameSite=Lax`;
  void import("./use-portal-session").then((m) => m.notifyPortalSession());
}

export function clearPortalSession() {
  document.cookie = `${COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  void import("./use-portal-session").then((m) => m.notifyPortalSession());
}
