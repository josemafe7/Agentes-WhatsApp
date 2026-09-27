// Client IP used as the key of per-IP rate limits ([SEG-07]). Only a counter key: never trusted for anything else.
// X-Forwarded-For is written by the reverse proxies in front of the app, each one adding the address it received the
// request from; anything to the left of what they wrote came from the client and can be forged. TRUSTED_PROXY_HOPS
// says how many of those proxies there are (docs/security.md «Límites y errores»).
import "server-only";
import { z } from "zod";

const ipSchema = z.union([z.ipv4(), z.ipv6()]);
const ipv4Schema = z.ipv4();
export const UNKNOWN_IP = "unknown";

/** Vercel (which overwrites X-Forwarded-For with the client's address) or one proxy in front, like Traefik in Dokploy. */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
export const MAX_TRUSTED_PROXY_HOPS = 5;

type Env = Readonly<Record<string, string | undefined>>;

/** TRUSTED_PROXY_HOPS as a number; unset or empty = the default; null when it is not a whole number from 0 to 5. */
export function parseTrustedProxyHops(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return DEFAULT_TRUSTED_PROXY_HOPS;
  if (!/^\d{1,2}$/.test(value)) return null;
  const hops = Number(value);
  return hops <= MAX_TRUSTED_PROXY_HOPS ? hops : null;
}

export class TrustedProxyHopsError extends Error {
  constructor() {
    super(
      `TRUSTED_PROXY_HOPS no es válida: tiene que ser un número entero de 0 a ${MAX_TRUSTED_PROXY_HOPS} (cuántos proxies hay delante ` +
        "de la app: 1 en Vercel o detrás de Traefik; 0 si la app se expone sin proxy). Sin poner, vale 1.",
    );
    this.name = "TrustedProxyHopsError";
  }
}

/** Start-up check (src/instrumentation.ts): a mistyped value never silently changes whose limits are whose. */
export function assertTrustedProxyHopsConfigured(env: Env = process.env): void {
  if (parseTrustedProxyHops(env.TRUSTED_PROXY_HOPS) === null) throw new TrustedProxyHopsError();
}

/** The configured number of proxies. An invalid value (the start-up check stops it first) trusts no header. */
export function trustedProxyHops(env: Env = process.env): number {
  return parseTrustedProxyHops(env.TRUSTED_PROXY_HOPS) ?? 0;
}

/** A valid address in one form: lower case, and an IPv4 client seen through an IPv6 socket as plain IPv4. */
function normalizeIp(candidate: string | null | undefined): string | null {
  const value = candidate?.trim().toLowerCase();
  if (!value || !ipSchema.safeParse(value).success) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  return mapped && ipv4Schema.safeParse(mapped[1]).success ? mapped[1] : value;
}

/**
 * With `hops` proxies in front, the client is the hops-th entry of X-Forwarded-For from the right (the left-most one
 * if there are fewer); without X-Forwarded-For, X-Real-IP. With 0 (the app exposed with no proxy) every header is
 * the client's own word, so none is used and all clients share one counter: per-IP limits then act as global ones,
 * while the limits per email, visitor and user keep working. Anything that is not an IP address counts as «unknown».
 */
export function clientIp(requestHeaders: Headers, hops: number = trustedProxyHops()): string {
  if (hops <= 0) return UNKNOWN_IP;
  const forwarded = requestHeaders
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (forwarded && forwarded.length > 0) return normalizeIp(forwarded[Math.max(0, forwarded.length - hops)]) ?? UNKNOWN_IP;
  return normalizeIp(requestHeaders.get("x-real-ip")) ?? UNKNOWN_IP;
}
