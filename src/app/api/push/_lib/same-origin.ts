// The push routes change data with the session cookie, so they also check that the request comes from the app's own
// pages ([SEG-06], docs/security.md «CSRF»). Same rule as isSameOriginRequest in src/app/(app)/conocimiento/_lib/upload.ts,
// kept here so these small routes do not load the knowledge pipeline.
import "server-only";
import { AuthError } from "@/server/errors";

/** Origin must be this host (or the proxy's forwarded host); a request without Origin is refused. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const originHost = origin && URL.canParse(origin) ? new URL(origin).host : null;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || new URL(request.url).host;
  if (!originHost || originHost.toLowerCase() !== host.toLowerCase()) throw new AuthError("forbidden");
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
