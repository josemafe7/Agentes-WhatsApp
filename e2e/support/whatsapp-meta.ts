// Meta's side of the WhatsApp specs: the test data of the simulated Graph API (e2e/mocks/routes/meta-data.json), a
// number and customers of each test's own, Meta's webhooks built from the shared fixtures of Vitest
// (src/test/fixtures/whatsapp, docs/integracion-whatsapp-mensajes.md §16) and signed with the App Secret like Meta
// does (HMAC-SHA256 of the exact bytes, §3), and what the app asked the simulated Meta.
//
// Every test uses a Phone Number ID, a WABA, customers (wa_id and BSUID) and wamids of its own: identities are unique
// per installation and a number connects only once ([WA-11], [CAN-13]), so tests never share contacts or channels.
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type APIResponse, type TestInfo } from "@playwright/test";
import type { WhatsAppFixture } from "@/test/fixtures/whatsapp";
import metaData from "../mocks/routes/meta-data.json";
import { MOCK_URL, RUN_ID } from "./env";
import type { MockClient, MockRecordedRequest } from "./mock-client";

/** App, tokens and templates of the simulated Meta. */
export const META = metaData;
export const META_TOKENS = metaData.tokens;
/** The Graph API version the app uses unless a channel says otherwise ([WA-49]). */
export const GRAPH_VERSION = "v26.0";
export const WEBHOOK_PATH = "/api/webhooks/whatsapp";

const FIXTURES_DIR = path.resolve(__dirname, "..", "..", "src", "test", "fixtures", "whatsapp");

function digest(testInfo: TestInfo, label: string): Buffer {
  return createHash("sha256").update(`${RUN_ID}:${testInfo.testId}:${testInfo.retry}:${testInfo.repeatEachIndex}:${label}`).digest();
}

/** `length` decimal digits for this run, test, retry and label. */
function digitsFor(testInfo: TestInfo, label: string, length: number): string {
  const hex = digest(testInfo, label).toString("hex");
  return BigInt(`0x${hex}`).toString().padStart(length, "0").slice(-length);
}

function refFor(testInfo: TestInfo, label: string): string {
  return digest(testInfo, label).toString("hex").slice(0, 6);
}

// ─── Numbers and customers ──────────────────────────────────────────────────────────────────────────────

export type WaNumber = {
  /** The channel's name in the app. */
  name: string;
  phoneNumberId: string;
  /** The simulated Meta's rule: the number's digits starting with 1. */
  wabaId: string;
  /** How Meta shows it: «+1 555-XXX-XXXX». */
  displayPhoneNumber: string;
  /** How the webhooks carry it: digits only. */
  webhookDisplayNumber: string;
};

/** A number of this test's own (e2e/mocks/routes/meta.mjs: any 15 digits starting with 2). */
export function testNumber(testInfo: TestInfo, label = "WhatsApp e2e"): WaNumber {
  const digits = digitsFor(testInfo, `number:${label}`, 14);
  const phoneNumberId = `2${digits}`;
  const tail = phoneNumberId.slice(-7);
  return {
    name: `${label} ${refFor(testInfo, `number:${label}`)}`,
    phoneNumberId,
    wabaId: `1${digits}`,
    displayPhoneNumber: `+1 555-${tail.slice(0, 3)}-${tail.slice(3)}`,
    webhookDisplayNumber: `1555${tail}`,
  };
}

export type WaCustomer = {
  /** WhatsApp profile name. */
  name: string;
  /** Digits, as Meta sends it; null for someone who only has a BSUID ([WA-39]). */
  waId: string | null;
  /** Business-scoped user id: «ES.» and digits. */
  bsuid: string;
  /** The recipient's country, for the pricing market ([WA-47]). */
  country: "ES" | "PT";
};

const CALLING_CODE = { ES: "346", PT: "3519" } as const;

/** A customer of this test's own: a mobile of `country` (Spain by default) and a BSUID of that country. */
export function testCustomer(testInfo: TestInfo, label: string, options: { country?: "ES" | "PT"; withPhone?: boolean } = {}): WaCustomer {
  const country = options.country ?? "ES";
  const phone = `${CALLING_CODE[country]}${digitsFor(testInfo, `phone:${label}`, 8)}`;
  return {
    name: `${label} ${refFor(testInfo, `customer:${label}`)}`,
    waId: options.withPhone === false ? null : phone,
    bsuid: `${country}.${digitsFor(testInfo, `bsuid:${label}`, 20)}`,
    country,
  };
}

/** «+34 6…» as a person writes it in «Solo a estos números» ([CAN-06]). */
export function e164(customer: WaCustomer): string {
  if (!customer.waId) throw new Error(`${customer.name} has no phone`);
  return `+${customer.waId}`;
}

/** A wamid of this test's own. */
export function testWamid(testInfo: TestInfo, label: string): string {
  return `wamid.E2E${createHash("sha256").update(`${RUN_ID}:${testInfo.testId}:${testInfo.retry}:wamid:${label}`).digest("base64url").slice(0, 24)}`;
}

// ─── Webhooks ───────────────────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

const MEDIA_KEYS = ["audio", "image", "document", "video", "sticker"] as const;

export type WebhookOptions = {
  number: WaNumber;
  /** Who writes (messages) or receives (statuses); the fixture's contact is replaced by this one. */
  customer?: WaCustomer;
  /** Text of a text message, or caption of an image, video or document. */
  text?: string;
  /** wamid of the incoming message (default: a new one per call). */
  wamid?: string;
  /** Meta's timestamp (default: now). The 24 h window counts from it ([WA-43]). */
  at?: Date;
  /** The file's `url`: pointing at the simulated Meta («mock», default) or left out («none»: GET /{media_id}). */
  mediaUrl?: "mock" | "none";
  /** Statuses: the wamid of our message. */
  statusOf?: string;
  /** Identity changes ([WA-50]): the BSUID the customer had. */
  previousBsuid?: string;
};

let sequence = 0;

function seconds(date: Date): string {
  return String(Math.floor(date.getTime() / 1000));
}

function rewriteContact(contact: Json, customer: WaCustomer): void {
  const profile = isRecord(contact.profile) ? contact.profile : {};
  contact.profile = { ...profile, name: customer.name };
  if (customer.waId) contact.wa_id = customer.waId;
  else delete contact.wa_id;
  contact.user_id = customer.bsuid;
}

function rewriteMessage(message: Json, options: WebhookOptions): void {
  const customer = options.customer;
  sequence += 1;
  message.id = options.wamid ?? `wamid.E2E${RUN_ID}${Date.now().toString(36)}${sequence}`;
  message.timestamp = seconds(options.at ?? new Date());
  if (customer && message.type !== "system") {
    if (customer.waId) message.from = customer.waId;
    else delete message.from;
    message.from_user_id = customer.bsuid;
  } else if (customer) {
    // An identity change comes from the new identity, when the fixture names one.
    if ("from" in message && customer.waId) message.from = customer.waId;
    if ("from_user_id" in message) message.from_user_id = customer.bsuid;
  }
  if (options.text !== undefined && isRecord(message.text)) message.text.body = options.text;
  for (const key of MEDIA_KEYS) {
    const media = message[key];
    if (!isRecord(media)) continue;
    if (options.text !== undefined && key !== "audio" && key !== "sticker") media.caption = options.text;
    if (options.mediaUrl === "none") delete media.url;
    // Never Meta's real host: the app would download from the internet. The same path on the simulated Meta.
    else media.url = `${MOCK_URL}/meta/whatsapp_business/attachments/?mid=${String(media.id)}`;
  }
  const system = message.system;
  if (isRecord(system) && customer) {
    const previous = options.previousBsuid ?? String(system.previous_user_id ?? "");
    system.previous_user_id = previous;
    system.user_id = customer.bsuid;
    system.body = `User changed from ${previous} to ${customer.bsuid}`;
    if (system.type === "user_changed_number" && customer.waId) system.wa_id = customer.waId;
  }
}

function rewriteStatus(status: Json, options: WebhookOptions): void {
  if (options.statusOf) status.id = options.statusOf;
  status.timestamp = seconds(options.at ?? new Date());
  const customer = options.customer;
  if (!customer) return;
  if (customer.waId) status.recipient_id = customer.waId;
  else delete status.recipient_id;
  status.recipient_user_id = customer.bsuid;
}

function rewriteBody(body: Json, options: WebhookOptions): Json {
  for (const entry of records(body.entry)) {
    entry.id = options.number.wabaId;
    for (const change of records(entry.changes)) {
      const value = change.value;
      if (!isRecord(value)) continue;
      if (isRecord(value.metadata)) value.metadata = { display_phone_number: options.number.webhookDisplayNumber, phone_number_id: options.number.phoneNumberId };
      if (options.customer) for (const contact of records(value.contacts)) rewriteContact(contact, options.customer);
      for (const message of records(value.messages)) rewriteMessage(message, options);
      for (const status of records(value.statuses)) rewriteStatus(status, options);
    }
  }
  return body;
}

function readFixture(name: WhatsAppFixture): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8")) as unknown;
}

/** A shared fixture as this test's number and customer send it: the exact text to sign and POST. */
export function webhookBody(fixture: Exclude<WhatsAppFixture, "duplicate">, options: WebhookOptions): string {
  const body = readFixture(fixture);
  if (!isRecord(body)) throw new Error(`Fixture ${fixture} is not one webhook`);
  return JSON.stringify(rewriteBody(body, options));
}

/** The «duplicate» fixture: the same message delivered twice (same wamid), as two separate POSTs. */
export function duplicateDeliveries(options: WebhookOptions & { wamid: string }): string[] {
  const bodies = readFixture("duplicate");
  if (!Array.isArray(bodies)) throw new Error("Fixture duplicate is not a list");
  return bodies.filter(isRecord).map((body) => JSON.stringify(rewriteBody(body, options)));
}

/** «sha256=<hex>» of these bytes with the App Secret, as Meta sends it in X-Hub-Signature-256. */
export function signWebhook(body: string, appSecret: string = META.appSecret): string {
  return `sha256=${createHmac("sha256", appSecret).update(Buffer.from(body, "utf8")).digest("hex")}`;
}

/**
 * POSTs a webhook to the app like Meta: the bytes as they are and their signature (another secret, a given header,
 * or none with `signature: null`).
 */
export async function postWebhook(
  request: APIRequestContext,
  body: string,
  options: { appSecret?: string; signature?: string | null } = {},
): Promise<APIResponse> {
  const signature = options.signature === undefined ? signWebhook(body, options.appSecret) : options.signature;
  return request.post(WEBHOOK_PATH, {
    data: Buffer.from(body, "utf8"),
    headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
    failOnStatusCode: false,
  });
}

/** POSTs a signed webhook and expects Meta's «received» (200). */
export async function deliverWebhook(request: APIRequestContext, body: string): Promise<void> {
  const response = await postWebhook(request, body);
  expect(response.status(), `the app answers Meta's webhook with 200: ${await response.text()}`).toBe(200);
}

/** Meta's GET verification of the webhook address ([WA-31]). */
export async function verificationRequest(request: APIRequestContext, verifyToken: string, challenge = "1158201444"): Promise<APIResponse> {
  const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.challenge": challenge, "hub.verify_token": verifyToken });
  return request.get(`${WEBHOOK_PATH}?${query.toString()}`, { failOnStatusCode: false });
}

/**
 * What the person does in the Meta app dashboard (docs/integracion-whatsapp.md §4.2): pastes the URL and the verify
 * token and presses «Verificar y guardar». The simulated Meta then sends its GET verification to that URL.
 */
export async function verifyInMetaDashboard(callbackUrl: string, verifyToken: string): Promise<{ success: boolean; verification: { status: number; echoed: boolean } }> {
  const response = await fetch(`${MOCK_URL}/meta/dashboard/apps/${META.appId}/webhooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_url: callbackUrl, verify_token: verifyToken, fields: "messages" }),
  });
  return (await response.json()) as { success: boolean; verification: { status: number; echoed: boolean } };
}

// ─── What the app asked the simulated Meta ──────────────────────────────────────────────────────────────

/** A Graph path as the mock records it: «/v26.0/<node>[/<edge>]». */
export function graphPath(node: string, edge?: string): string {
  return `/${GRAPH_VERSION}/${node}${edge ? `/${edge}` : ""}`;
}

export async function metaCalls(mock: MockClient, method: string, recordedPath: string): Promise<MockRecordedRequest[]> {
  return mock.requests({ service: "meta", method, path: recordedPath });
}

export type SentMessage = { to?: string; recipient?: string; type?: string; text?: { body?: string }; template?: Json; [key: string]: unknown };

/** The messages the app sent from a number (read receipts and «escribiendo…» left out), oldest first. */
export async function sentMessages(mock: MockClient, number: WaNumber): Promise<SentMessage[]> {
  const calls = await metaCalls(mock, "POST", graphPath(number.phoneNumberId, "messages"));
  return calls.map((call) => call.body).filter((body): body is SentMessage => isRecord(body) && body.status !== "read");
}

/** Read receipts (with or without «escribiendo…») the app sent from a number ([WA-45]). */
export async function readReceipts(mock: MockClient, number: WaNumber): Promise<Json[]> {
  const calls = await metaCalls(mock, "POST", graphPath(number.phoneNumberId, "messages"));
  return calls.map((call) => call.body).filter((body): body is Json => isRecord(body) && body.status === "read");
}

/**
 * What GET /{PHONE_NUMBER_ID} answers for this number once registered (docs/integracion-whatsapp.md §3.1, the simulated
 * Meta's defaults), with some fields changed: for stubs of a number that got worse.
 */
export function numberAsMetaShowsIt(number: WaNumber, overrides: Json = {}): Json {
  return {
    id: number.phoneNumberId,
    display_phone_number: number.displayPhoneNumber,
    verified_name: META.verifiedName,
    quality_rating: "GREEN",
    code_verification_status: "VERIFIED",
    name_status: "APPROVED",
    status: "CONNECTED",
    whatsapp_business_manager_messaging_limit: "TIER_250",
    health_status: {
      can_send_message: "AVAILABLE",
      entities: [
        { entity_type: "PHONE_NUMBER", id: number.phoneNumberId, can_send_message: "AVAILABLE" },
        { entity_type: "WABA", id: number.wabaId, can_send_message: "AVAILABLE" },
        { entity_type: "BUSINESS", id: META.businessId, can_send_message: "AVAILABLE" },
        { entity_type: "APP", id: META.appId, can_send_message: "AVAILABLE" },
      ],
    },
    ...overrides,
  };
}

/** Meta's error body (docs/integracion-whatsapp-mensajes.md §11.3), for POST /__stub. */
export function metaErrorBody(code: number, message: string, details?: string): Json {
  return {
    error: {
      message: `(#${code}) ${message}`,
      type: "OAuthException",
      code,
      ...(details ? { error_data: { messaging_product: "whatsapp", details } } : {}),
      fbtrace_id: "AE2EstubbedTrace",
    },
  };
}

/** Where a send goes: `to` = «+» + wa_id, or `recipient` = BSUID ([WA-39]). */
export type Destination = { to: string } | { recipient: string };

/** The next send from this number to `destination` is accepted with this wamid (so statuses can name it). */
export async function nextSendGetsWamid(mock: MockClient, number: WaNumber, wamid: string, destination: Destination): Promise<void> {
  const contact = "to" in destination ? { input: destination.to, wa_id: destination.to.replace(/\D/g, "") } : { input: destination.recipient, user_id: destination.recipient };
  await mock.stub({
    service: "meta",
    method: "POST",
    path: graphPath(number.phoneNumberId, "messages"),
    // Only that send: read receipts and «escribiendo…» name no destination.
    when: { bodyIncludes: "to" in destination ? `"to":"${destination.to}"` : `"recipient":"${destination.recipient}"` },
    body: { messaging_product: "whatsapp", contacts: [contact], messages: [{ id: wamid }] },
    times: 1,
  });
}

/** The next sends from this number fail with a Meta error (e.g. 131047 outside the 24 h window). */
export async function nextSendFails(mock: MockClient, number: WaNumber, error: { code: number; message: string; details?: string; status?: number }, times = 1): Promise<void> {
  await mock.stub({
    service: "meta",
    method: "POST",
    path: graphPath(number.phoneNumberId, "messages"),
    // Only sends to a phone: read receipts and «escribiendo…» name no destination.
    when: { bodyIncludes: '"to":"+' },
    status: error.status ?? 400,
    body: metaErrorBody(error.code, error.message, error.details),
    times,
  });
}
