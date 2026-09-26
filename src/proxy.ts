// Next.js proxy: cheap redirects only, never the security boundary (docs/security.md «Usuarios y permisos»).
// Every page, Server Action and route checks the session on the server anyway. Here: signed-out visits to
// private pages go to /login?next=…, and the requested path is passed on for the (app) layout
// (src/server/session-2fa.ts).
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_PREFIX, isPublicPath, loginPathFor, REQUEST_PATH_HEADER } from "@/lib/auth-paths";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestedPath = `${pathname}${search}`;
  // Only page visits: Server Actions are POSTs and answer «sesión caducada» themselves.
  const isPageVisit = request.method === "GET" || request.method === "HEAD";
  const hasSessionCookie = getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) !== null;
  if (isPageVisit && !hasSessionCookie && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL(loginPathFor(requestedPath), request.url));
  }
  // Always set here, so a value sent by the browser never reaches the app.
  const forwarded = new Headers(request.headers);
  forwarded.set(REQUEST_PATH_HEADER, requestedPath);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  // Not for API routes (each checks its own caller), Next's assets or files with an extension (icons,
  // widget.js, sw.js, manifest).
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)"],
};
