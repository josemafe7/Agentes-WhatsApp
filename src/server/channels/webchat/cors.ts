// Where the web chat works ([WEB-10], docs/security.md «CORS»): only on the channel's allowed domains, and inside the
// app itself while that list is empty. A chat meant for the business's own site runs in the app only on
// /widget-demo, which outside the demo only the team can open (a signed-in page). The API answers those origins by
// name (never «*»), without cookies; anything else gets no CORS headers, so the browser refuses to show the chat there.
import "server-only";
import { getAppUrl } from "@/server/app-url";

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
/** The page of the app where the team tries any web chat ([WEB-12]). */
export const WIDGET_DEMO_PATH = "/widget-demo";

function originOf(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    const url = new URL(value);
    return WEB_PROTOCOLS.has(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The page that makes the request: its Origin header or, when a browser leaves it out (same-origin GETs, such as
 * /widget-demo polling), the origin of its Referer. Null when neither says a web page.
 */
export function requestOrigin(headers: Headers): string | null {
  const origin = headers.get("origin");
  if (origin !== null) return originOf(origin);
  return originOf(headers.get("referer"));
}

/**
 * Whether the request comes from /widget-demo of `origin` (its Referer: the app's pages send their full address to
 * the app itself, docs/security.md «Configuración»). A browser never lets another site forge it.
 */
export function comesFromWidgetDemo(headers: Headers, origin: string): boolean {
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    const url = new URL(referer);
    return url.origin === origin && url.pathname === WIDGET_DEMO_PATH;
  } catch {
    return false;
  }
}

/** Hosts of the app itself: the configured public address and the host this request was sent to. */
export function appHosts(headers: Headers): string[] {
  const hosts = [new URL(getAppUrl()).host];
  const host = headers.get("host")?.trim().toLowerCase();
  if (host) hosts.push(host);
  return hosts;
}

/**
 * Whether the chat may run on a page of `origin`. An allowed domain with a port («localhost:5173») matches only that
 * port; without one («www.mipeluqueria.es»), that exact host name on any port. No wildcards or implicit subdomains.
 * The app itself: always while the list is empty; with domains in the list, only its /widget-demo page.
 */
export function isOriginAllowed(
  origin: string,
  allowedDomains: readonly string[],
  ownHosts: readonly string[],
  page: { fromWidgetDemo?: boolean } = {},
): boolean {
  const normalized = originOf(origin);
  if (!normalized) return false;
  const url = new URL(normalized);
  if (allowedDomains.some((domain) => (domain.includes(":") ? domain === url.host : domain === url.hostname))) return true;
  if (!ownHosts.includes(url.host)) return false;
  return allowedDomains.length === 0 || page.fromWidgetDemo === true;
}

export const WIDGET_CORS_METHODS = "GET, POST, OPTIONS";
/** Preflight answers are cached by the browser for this long. */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** CORS headers for an allowed origin. No credentials: the widget never uses cookies. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": WIDGET_CORS_METHODS,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS),
    Vary: "Origin",
  };
}
