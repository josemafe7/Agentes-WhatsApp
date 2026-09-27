// Next.js proxy: cheap redirects only, never the security boundary (docs/security.md «Usuarios y permisos»).
// Every page, Server Action and route checks the session on the server anyway. Here: signed-out visits to
// private pages go to /login?next=…, the requested path is passed on for the (app) layout
// (src/server/session-2fa.ts), and every page gets its Content-Security-Policy with a nonce of its own ([SEG-11],
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md): Next.js reads it from the request and puts
// it on its scripts and React's; the root layout gives it to the theme's inline script. Every page is rendered per
// request, as nonces need.
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_PREFIX, isPublicPath, loginPathFor, REQUEST_PATH_HEADER } from "@/lib/auth-paths";

/** Where the root layout (src/app/layout.tsx) reads this request's nonce. */
const NONCE_HEADER = "x-nonce";
const NONCE_BYTES = 16;

/** Unpredictable and new on every request. */
function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(NONCE_BYTES))).toString("base64");
}

/** Served over https (the addresses a published app must have, src/server/app-url.ts). */
function servedOverHttps(): boolean {
  return [process.env.APP_URL, process.env.BETTER_AUTH_URL].some((url) => url?.trim().startsWith("https://"));
}

function contentSecurityPolicy(nonce: string): string {
  const development = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // Only scripts with this nonce (Next.js and React add it to theirs), and what they load ('strict-dynamic': the
    // widget that /widget-demo and the setup wizard load like a business's site does). React evaluates code only in
    // development, for its error overlay.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Inline styles stay allowed (a nonce would switch 'unsafe-inline' off): React writes style attributes, Radix,
    // sonner and input-otp add <style> tags, the widget draws its Shadow DOM with one, and the business colour is a
    // <style> block. They cannot run code (docs/security.md «Configuración»).
    "style-src 'self' 'unsafe-inline'",
    // blob: previews of photos before uploading them and of voice notes recorded in the browser; data: small icons.
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // The PWA's service worker: script-src with 'strict-dynamic' would not let 'self' register it.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(servedOverHttps() ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestedPath = `${pathname}${search}`;
  // Only page visits: Server Actions are POSTs and answer «sesión caducada» themselves.
  const isPageVisit = request.method === "GET" || request.method === "HEAD";
  const hasSessionCookie = getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) !== null;
  if (isPageVisit && !hasSessionCookie && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL(loginPathFor(requestedPath), request.url));
  }
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce);
  // Always set here, so values sent by the browser never reach the app.
  const forwarded = new Headers(request.headers);
  forwarded.set(REQUEST_PATH_HEADER, requestedPath);
  forwarded.set(NONCE_HEADER, nonce);
  forwarded.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Not for API routes (each checks its own caller), Next's assets or files with an extension (icons,
  // widget.js, sw.js, manifest): none of them is a page. next.config.ts gives /sw.js its own policy.
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)"],
};
