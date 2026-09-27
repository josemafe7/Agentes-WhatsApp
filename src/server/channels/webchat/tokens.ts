// Signed tokens of the web chat ([WEB-04], [WEB-11]). The browser keeps an anonymous visitor id that the server
// created, plus a token that proves it: HMAC-SHA256 with a key derived from APP_ENCRYPTION_KEY (HKDF, its own
// purpose, so it never doubles as the encryption key). Without a valid token nobody reads a conversation, and a
// visitor id cannot be chosen or edited by the browser. Uploads get a short receipt bound to the same visitor.
import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import { z } from "zod";
import { assertEncryptionKeyConfigured, timingSafeEqualStr } from "@/server/crypto";

const TOKEN_VERSION = "v1";
/** A returning visitor sees their conversation for a year; every session hands out a fresh token. */
export const VISITOR_TOKEN_MAX_AGE_MS = 365 * 24 * 60 * 60_000;
/** Between uploading a file and sending it. */
export const UPLOAD_RECEIPT_TTL_MS = 60 * 60_000;
/** Tolerated clock difference between servers. */
const CLOCK_SKEW_MS = 60_000;
const MAX_TOKEN_LENGTH = 2_000;

type Purpose = "visitor" | "upload";

function signingKey(): Buffer {
  assertEncryptionKeyConfigured();
  const master = Buffer.from(process.env.APP_ENCRYPTION_KEY?.trim() ?? "", "base64");
  return Buffer.from(hkdfSync("sha256", master, "dominia-webchat", "widget-tokens-v1", 32));
}

function signature(purpose: Purpose, body: string): string {
  return createHmac("sha256", signingKey()).update(`${TOKEN_VERSION}.${purpose}.${body}`).digest("base64url");
}

function sign(purpose: Purpose, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${TOKEN_VERSION}.${body}.${signature(purpose, body)}`;
}

function verify<T>(purpose: Purpose, token: unknown, schema: z.ZodType<T>): T | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, body, mac] = parts;
  if (!body || !mac || !timingSafeEqualStr(mac, signature(purpose, body))) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

// ─── Visitor ────────────────────────────────────────────────────────────────────────────────────────────

export type VisitorIdentity = { channelId: string; visitorId: string };

const visitorPayload = z.object({ c: z.uuid(), v: z.uuid(), iat: z.number().int().nonnegative() });

export function issueVisitorToken(identity: VisitorIdentity, now: Date = new Date()): string {
  return sign("visitor", { c: identity.channelId, v: identity.visitorId, iat: now.getTime() });
}

/** The visitor of a valid token for `channelId`, or null (forged, other channel, expired or unreadable). */
export function verifyVisitorToken(token: unknown, channelId: string, now: Date = new Date()): VisitorIdentity | null {
  const payload = verify("visitor", token, visitorPayload);
  if (!payload || payload.c !== channelId) return null;
  const age = now.getTime() - payload.iat;
  if (age < -CLOCK_SKEW_MS || age > VISITOR_TOKEN_MAX_AGE_MS) return null;
  return { channelId: payload.c, visitorId: payload.v };
}

// ─── Upload receipt ─────────────────────────────────────────────────────────────────────────────────────

export type WidgetMediaKind = "image" | "audio";
export type UploadReceipt = VisitorIdentity & { fileKey: string; mimeType: string; size: number; kind: WidgetMediaKind };

const uploadPayload = z.object({
  c: z.uuid(),
  v: z.uuid(),
  k: z.string().min(1).max(300),
  m: z.string().min(1).max(120),
  s: z.number().int().nonnegative(),
  t: z.enum(["image", "audio"]),
  exp: z.number().int(),
});

export function issueUploadReceipt(receipt: UploadReceipt, now: Date = new Date()): string {
  return sign("upload", {
    c: receipt.channelId,
    v: receipt.visitorId,
    k: receipt.fileKey,
    m: receipt.mimeType,
    s: receipt.size,
    t: receipt.kind,
    exp: now.getTime() + UPLOAD_RECEIPT_TTL_MS,
  });
}

/** The file a visitor uploaded, only for that same visitor and channel and before it expires. */
export function verifyUploadReceipt(token: unknown, identity: VisitorIdentity, now: Date = new Date()): UploadReceipt | null {
  const payload = verify("upload", token, uploadPayload);
  if (!payload || payload.c !== identity.channelId || payload.v !== identity.visitorId || payload.exp < now.getTime()) return null;
  return { channelId: payload.c, visitorId: payload.v, fileKey: payload.k, mimeType: payload.m, size: payload.s, kind: payload.t };
}
