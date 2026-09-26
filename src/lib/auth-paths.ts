// Paths of the sign-in flows and the «next» return target. Pure module: the proxy (src/proxy.ts) cannot import
// server code, and the server layers use the same rules. Only in-app paths are valid return targets, so a
// crafted ?next= can never send someone to another site (docs/security.md «Redirecciones»).

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/bandeja";
export const PROFILE_PATH = "/perfil";
export const TWO_FACTOR_PATH = "/dos-pasos";
export const RECOVER_PASSWORD_PATH = "/recuperar";
export const RESET_PASSWORD_PATH = "/restablecer";
export const INVITATION_PATH = "/invitacion";
export const SETUP_PATH = "/setup";

/** Request header where the proxy leaves the requested path and query for server layouts. */
export const REQUEST_PATH_HEADER = "x-dominia-path";
/** Better Auth cookie prefix. Must be AUTH_COOKIE_PREFIX of src/server/auth.ts (a test checks it). */
export const AUTH_COOKIE_PREFIX = "dominia";
/** Query flag that /perfil shows as «activa la verificación en dos pasos» ([USU-12]). */
export const TWO_FACTOR_REQUIRED_QUERY = "dos-pasos=obligatorio";

/** Pages that work without a session ([PER-09]); the root page decides by itself where to go. */
const PUBLIC_PREFIXES = [
  LOGIN_PATH,
  RECOVER_PASSWORD_PATH,
  RESET_PASSWORD_PATH,
  TWO_FACTOR_PATH,
  INVITATION_PATH,
  SETUP_PATH,
  "/legal",
  "/widget-demo",
] as const;

/** Sign-in pages and API routes are never a place to come back to after signing in. */
const NOT_A_RETURN_TARGET = [LOGIN_PATH, RECOVER_PASSWORD_PATH, RESET_PASSWORD_PATH, TWO_FACTOR_PATH, INVITATION_PATH, "/api"];

const NEXT_MAX_LENGTH = 1024;
const PARSE_BASE = "http://dominia.invalid";
// Backslashes and control characters: browsers turn "/\evil.com" or "/\t/evil.com" into another host.
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPath(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

/** The path and query of `value` if it is a safe in-app return target, otherwise null. */
export function sanitizeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > NEXT_MAX_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//") || UNSAFE_CHARACTERS.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }
  // Dot segments can rebuild "//host" after parsing ("/.//evil.com").
  if (url.origin !== PARSE_BASE || url.pathname.startsWith("//")) return null;
  if (NOT_A_RETURN_TARGET.some((prefix) => matchesPrefix(url.pathname, prefix))) return null;
  return `${url.pathname}${url.search}`;
}

/** Only the path part of a path-and-query string (null when it is not a path). */
export function pathnameOf(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/")) return null;
  try {
    return new URL(value, PARSE_BASE).pathname;
  } catch {
    return null;
  }
}

function withNext(path: string, next: unknown): string {
  const safe = sanitizeNextPath(next);
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}

/** /login, coming back to `next` after signing in when it is a safe in-app path ([USU-02]). */
export function loginPathFor(next?: unknown): string {
  return withNext(LOGIN_PATH, next);
}

/** /dos-pasos, keeping where to go after the code. */
export function twoFactorPathFor(next?: unknown): string {
  return withNext(TWO_FACTOR_PATH, next);
}
