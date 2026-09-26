// Client IP used as the key of per-IP rate limits ([SEG-07]). Only a counter key: never trusted for anything else.
import "server-only";
import { z } from "zod";

const ipSchema = z.union([z.ipv4(), z.ipv6()]);
export const UNKNOWN_IP = "unknown";

/**
 * The right-most x-forwarded-for entry is the one written by the proxy in front of the app (Vercel sends a single
 * value, Traefik appends); entries to its left can be forged by the client. Then x-real-ip. Validated with Zod:
 * anything else counts as «unknown».
 */
export function clientIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  const candidates = [forwarded?.at(-1), requestHeaders.get("x-real-ip")?.trim()];
  for (const candidate of candidates) {
    if (candidate && ipSchema.safeParse(candidate).success) return candidate.toLowerCase();
  }
  return UNKNOWN_IP;
}
