import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, setSessionCookie } from "@/lib/server/portal-api";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!body.username || !body.password) return NextResponse.json({ ok: false, error: { code: "missing_fields" } }, { status: 400 });
  try {
    const r = await convexClient().action(api.portalAuth.login, { username: body.username, password: body.password });
    const res = NextResponse.json({ ok: true, vendorId: r.vendorId });
    setSessionCookie(res, r.token);
    return res;
  } catch (e) {
    return errorResponse(e, 401);
  }
}
