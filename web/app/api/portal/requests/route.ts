import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, readSessionToken } from "@/lib/server/portal-api";

export async function GET() {
  const sessionToken = await readSessionToken();
  if (!sessionToken) return NextResponse.json({ ok: false, error: { code: "not_logged_in" } }, { status: 401 });
  try {
    const data = await convexClient().query(api.channels.portal.openRequestsForSession, { sessionToken });
    if (!data) return NextResponse.json({ ok: false, error: { code: "not_logged_in" } }, { status: 401 });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return errorResponse(e, 400);
  }
}
