// Realistic WhatsApp webhook payloads for tests (docs/integracion-whatsapp-mensajes.md §16, official shape, invented
// data) and a helper to sign them like Meta does: HMAC-SHA256 of the exact bytes with the App Secret. The e2e mock
// server and Playwright specs may reuse the same files. The ids match the docs' example ids.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The docs' example ids and the test App Secret (docs/integracion-whatsapp-mensajes.md §3 «Vector de prueba»). */
export const WA_TEST = {
  wabaId: "100000000000001",
  phoneNumberId: "200000000000002",
  displayPhoneNumber: "15550001111",
  appId: "300000000000003",
  businessId: "400000000000004",
  systemUserId: "500000000000005",
  appSecret: "test_app_secret",
  otherAppSecret: "otro_secreto",
  /** A system user token shape (never a real one). */
  accessToken: "EAATESTTOKEN0123456789abcdefghijklmnopqrstuvwxyz",
  customer: { name: "Ana Pruebas", waId: "15550002222", bsuid: "US.10000000000000000001" },
  bsuidOnly: { name: "Lucía Test", bsuid: "ES.20000000000000000002", newBsuid: "ES.20000000000000000003" },
} as const;

export const WHATSAPP_FIXTURES = [
  "text",
  "voice",
  "image",
  "document",
  "status-sent",
  "status-delivered",
  "status-read",
  "status-delivered-regular",
  "status-failed-131047",
  "bsuid-only",
  "duplicate",
  "account-update",
  "template-status",
  "interactive-button-reply",
  "reaction",
  "reaction-removed",
  "location",
  "unsupported",
  "system-user-changed-user-id",
  "system-user-changed-number",
  "name-update-approved",
] as const;
export type WhatsAppFixture = (typeof WHATSAPP_FIXTURES)[number];

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** The fixture's exact text (its bytes are what gets signed). */
export function fixtureText(name: WhatsAppFixture): string {
  return fs.readFileSync(path.join(DIR, `${name}.json`), "utf8");
}

export function fixtureBody(name: WhatsAppFixture): unknown {
  return JSON.parse(fixtureText(name)) as unknown;
}

/** «sha256=<hex>» of these bytes, as Meta sends it in X-Hub-Signature-256. */
export function signWebhook(body: string | Uint8Array, appSecret: string = WA_TEST.appSecret): string {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

/** A signed POST like Meta's (the text is sent byte for byte). */
export function signedWebhookRequest(
  body: string,
  options: { appSecret?: string; signature?: string | null; url?: string; ip?: string } = {},
): Request {
  const signature = options.signature === undefined ? signWebhook(body, options.appSecret) : options.signature;
  return new Request(options.url ?? "http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-hub-signature-256": signature } : {}),
      ...(options.ip ? { "x-forwarded-for": options.ip } : {}),
    },
    body,
  });
}
