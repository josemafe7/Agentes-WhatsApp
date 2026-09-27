// X-Hub-Signature-256 of Meta's webhooks ([WA-32], [SEG-08], docs/integracion-whatsapp-mensajes.md §3): HMAC-SHA256
// of the exact bytes received, keyed with the App Secret, compared in constant time. Never over a re-serialized JSON.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const META_SIGNATURE_HEADER = "x-hub-signature-256";
const HEADER_PATTERN = /^sha256=([0-9a-f]{64})$/i;

/** «sha256=<hex>» for these bytes (tests and the e2e mock sign with it too). */
export function computeMetaSignature(appSecret: string, body: Uint8Array | string): string {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

/**
 * Whether `header` is the signature of `body` with `appSecret`. A missing or malformed header (not «sha256=» plus 64
 * hex characters) is simply invalid: the constant-time comparison only ever sees two 32-byte digests.
 */
export function verifyMetaSignature(body: Uint8Array, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret) return false;
  const match = header?.trim().match(HEADER_PATTERN);
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
