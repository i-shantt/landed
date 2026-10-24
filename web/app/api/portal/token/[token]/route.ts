import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, readSessionToken } from "@/lib/server/portal-api";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/portal/token/[token]">) {
  const { token } = await ctx.params;
  const sessionToken = await readSessionToken();
  if (!sessionToken) return NextResponse.json({ ok: false, error: { code: "not_logged_in" } }, { status: 401 });
  try {
    const info = await convexClient().query(api.channels.portal.tokenInfo, { sessionToken, token });
    if (info.error === "not_logged_in") return NextResponse.json({ ok: false, error: { code: "not_logged_in" } }, { status: 401 });
    if (info.error) return NextResponse.json({ ok: false, error: { code: info.error } }, { status: 404 });
    return NextResponse.json({ ok: true, ...info });
  } catch (e) {
    return errorResponse(e, 400);
  }
}
