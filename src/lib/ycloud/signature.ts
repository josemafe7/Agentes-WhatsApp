// The signature of YCloud's webhooks ([YC-05], [SEG-08], docs/integracion-ycloud.md «Firma»): the header
// `YCloud-Signature: t=<unix seconds>,s=<hex>` carries the HMAC-SHA256 of `<t>.<exact bytes received>` keyed with the
// endpoint's secret. Compared in constant time, never over a re-serialized JSON, and only within a few minutes of `t`
// (a captured request cannot be replayed later).
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const YCLOUD_SIGNATURE_HEADER = "ycloud-signature";
/** How far `t` may be from now, either way (the tolerance of YCloud's own sample receiver). */
export const YCLOUD_SIGNATURE_TOLERANCE_MS = 5 * 60_000;
const HEADER_PATTERN = /^t=(\d{1,12}),s=([0-9a-f]{64})$/i;

/** `t=<seconds>,s=<hex>` for these bytes (tests and the e2e mock sign with it too). */
export function computeYCloudSignature(secret: string, body: Uint8Array | string, timestampSec: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSec}.`).update(body).digest("hex");
  return `t=${timestampSec},s=${digest}`;
}

/**
 * Whether `header` is the signature of `body` with `secret`, made within the tolerance of `now`. A missing or
 * malformed header is simply invalid: the constant-time comparison only ever sees two 32-byte digests.
 */
export function verifyYCloudSignature(body: Uint8Array, header: string | null | undefined, secret: string, now: Date = new Date()): boolean {
  if (!secret) return false;
  const match = header?.trim().match(HEADER_PATTERN);
  if (!match) return false;
  const timestampSec = Number(match[1]);
  if (Math.abs(now.getTime() - timestampSec * 1_000) > YCLOUD_SIGNATURE_TOLERANCE_MS) return false;
  const expected = createHmac("sha256", secret).update(`${timestampSec}.`).update(body).digest();
  const received = Buffer.from(match[2], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
