// Next 16 proxy (the former middleware). Convex Auth keeps the session in httpOnly cookies and refreshes the
// JWT on every matched request; POSTs to /api/auth are proxied to the Convex signIn/signOut actions.
// Public: marketing pages, health, the sign-in page, the vendor portal and its API. Everything else needs a session.
import { convexAuthNextjsMiddleware, createRouteMatcher, nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";

const isPublic = createRouteMatcher(["/", "/about", "/pitch(.*)", "/health", "/signin", "/portal(.*)", "/confirm(.*)", "/api/portal(.*)", "/api/auth(.*)"]);
const isSignIn = createRouteMatcher(["/signin"]);

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const authed = await convexAuth.isAuthenticated();
    if (isSignIn(request) && authed) return nextjsMiddlewareRedirect(request, "/dashboard");
    if (!isPublic(request) && !authed) {
      const next = request.nextUrl.pathname + request.nextUrl.search;
      return nextjsMiddlewareRedirect(request, `/signin?next=${encodeURIComponent(next)}`);
    }
  },
  { cookieConfig: { maxAge: 60 * 60 * 24 * 7 } },
);

export const config = {
  // Every page and API route except static files and Next internals; /api/auth must stay matched.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
