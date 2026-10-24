// Server-only helpers for the vendor-portal route handlers. The session token lives in an
// httpOnly cookie and never reaches client JavaScript; pages call /api/portal/* with fetch.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";

export const PORTAL_COOKIE = "landed_portal_session";
export const PORTAL_SESSION_SECONDS = 12 * 3600;

export function convexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(PORTAL_COOKIE)?.value ?? null;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PORTAL_SESSION_SECONDS,
  };
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(PORTAL_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(PORTAL_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

/** Normalizes a thrown Convex error into {status, body}. ConvexError data is passed through verbatim. */
export function errorResponse(e: unknown, status: number): NextResponse {
  if (e instanceof ConvexError) {
    const data: unknown = (e as ConvexError<string>).data;
    const body = typeof data === "string" ? { code: data } : (data as Record<string, unknown>);
    return NextResponse.json({ ok: false, error: body }, { status });
  }
  return NextResponse.json({ ok: false, error: { code: "error", message: String((e as Error)?.message ?? e) } }, { status: 500 });
}
