import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, readSessionToken } from "@/lib/server/portal-api";

export async function POST(req: NextRequest) {
  const sessionToken = await readSessionToken();
  if (!sessionToken) return NextResponse.json({ ok: false, error: { code: "not_logged_in" } }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { token?: string; statedAmountCents?: number | null };
  if (!body.token) return NextResponse.json({ ok: false, error: { code: "missing_token" } }, { status: 400 });
  const statedAmountCents = typeof body.statedAmountCents === "number" && Number.isFinite(body.statedAmountCents) ? Math.round(body.statedAmountCents) : null;
  try {
    const r = await convexClient().mutation(api.channels.portal.confirm, { sessionToken, token: body.token, statedAmountCents });
    return NextResponse.json({ ok: true, verified: r.verified, attemptsLeft: r.attemptsLeft });
  } catch (e) {
    return errorResponse(e, 400);
  }
}
