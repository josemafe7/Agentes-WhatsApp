// A fake YCloud API for Vitest and realistic webhook events (docs/integracion-ycloud.md, official shape, invented data):
// an injectable fetch that records every call and answers like YCloud. Tests never call YCloud.
import { computeYCloudSignature } from "@/lib/ycloud/signature";

/** Keys and secrets are put together at runtime: no literal in the repository may look like a real key to secret scanners. */
const fakeSecret = (prefix: string, seed: string, length: number) => `${prefix}${seed.repeat(Math.ceil(length / seed.length)).slice(0, length)}`;

export const FAKE_YCLOUD_BASE_URL = "https://api.ycloud.test/v2";

export const YC_TEST = {
  apiKey: fakeSecret("", "clavefalsa0", 32),
  /** Another valid key of the same account. */
  newApiKey: fakeSecret("", "clavenueva1", 32),
  webhookSecret: fakeSecret("whsec_", "secretofalso", 32),
  endpointId: "6700000000000000000000e1",
  wabaId: "100200300400500",
  phoneNumber: "+34600111222",
  displayPhoneNumber: "+34 600 11 12 22",
  verifiedName: "Peluquería Ejemplo",
  /** Another number of the same YCloud account. */
  otherPhoneNumber: "+34600333444",
  customer: { phone: "+34611222333", waId: "34611222333", bsuid: "ES.13491208655302741918", name: "Ana Pruebas" },
} as const;

export type YCloudCall = { method: string; path: string; query: URLSearchParams; headers: Headers; /** Parsed JSON, a FormData, or undefined. */ body: unknown };
export type YCloudHandler = (call: YCloudCall) => Response | Promise<Response>;

export function ycOk(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** YCloud's error body: `{ error: { status, code, message, whatsappApiError? } }`. */
export function ycError(status: number, code: string, extra: { metaCode?: number; retryAfter?: number } = {}): Response {
  const error = { status, code, message: "Test error", requestId: "req_test", ...(extra.metaCode ? { whatsappApiError: { code: String(extra.metaCode), message: "Meta test error" } } : {}) };
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", ...(extra.retryAfter !== undefined ? { "retry-after": String(extra.retryAfter) } : {}) } });
}

export function ycFile(bytes: Uint8Array, contentType = "application/octet-stream"): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

function parseBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  return typeof body === "string" ? (JSON.parse(body) as unknown) : body;
}

export function fakeYCloudFetch(handler: YCloudHandler) {
  const calls: YCloudCall[] = [];
  const base = new URL(FAKE_YCLOUD_BASE_URL);
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error(`Llamada fuera del YCloud simulado: ${url.origin}${url.pathname}`);
    const call: YCloudCall = { method: (init?.method ?? "GET").toUpperCase(), path: url.pathname.slice(base.pathname.length), query: url.searchParams, headers: new Headers(init?.headers), body: parseBody(init) };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl as typeof fetch, calls, deps: { fetchImpl: fetchImpl as typeof fetch, baseUrl: FAKE_YCLOUD_BASE_URL } };
}

/** Routes by «METHOD /path», where a path segment may be `:anything`; the rest answers 501 so a missing stub is loud. */
export function ycloudRoutes(table: Record<string, YCloudHandler>): YCloudHandler {
  const routes = Object.entries(table).map(([key, handler]) => {
    const [method, path] = key.split(" ");
    const pattern = new RegExp(`^${path.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
    return { method, pattern, handler };
  });
  return (call) => {
    const route = routes.find((item) => item.method === call.method && item.pattern.test(call.path));
    return route ? route.handler(call) : ycError(501, "NOT_SIMULATED");
  };
}

// ─── Documented answers ─────────────────────────────────────────────────────────────────────────────────

const page = (items: unknown[]) => ({ offset: 0, limit: 100, length: items.length, items });

export function phoneNumberResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "6700000000000000000000a1",
    phoneNumber: YC_TEST.phoneNumber,
    displayPhoneNumber: YC_TEST.displayPhoneNumber,
    wabaId: YC_TEST.wabaId,
    verifiedName: YC_TEST.verifiedName,
    qualityRating: "GREEN",
    messagingLimit: "TIER_1K",
    status: "CONNECTED",
    codeVerificationStatus: "VERIFIED",
    nameStatus: "APPROVED",
    ...overrides,
  };
}

export function sentMessageResponse(id = "6700000000000000000000f1", overrides: Record<string, unknown> = {}) {
  return { id, wabaId: YC_TEST.wabaId, from: YC_TEST.phoneNumber, to: YC_TEST.customer.phone, type: "text", status: "accepted", createTime: "2026-09-26T10:00:06.000Z", ...overrides };
}

export function templateResponse(overrides: Record<string, unknown> = {}) {
  return {
    officialTemplateId: "900100200300",
    wabaId: YC_TEST.wabaId,
    name: "recordatorio_cita",
    language: "es",
    category: "UTILITY",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hola {{1}}, te recordamos tu cita del {{2}}." }],
    ...overrides,
  };
}

export type FakeYCloudAccount = { handler: YCloudHandler; endpoints: Map<string, { id: string; url: string; status: string }>; secrets: Map<string, string> };

/**
 * An account that answers everything a connected number needs, and remembers the webhook endpoints it is asked to
 * create (each with a secret of its own, only given at that moment). Pass overrides for what a test cares about.
 */
export function ycloudAccount(overrides: Record<string, YCloudHandler> = {}, options: { numbers?: Record<string, unknown>[]; balance?: number } = {}): FakeYCloudAccount {
  const endpoints = new Map<string, { id: string; url: string; status: string }>();
  const secrets = new Map<string, string>();
  const numbers = options.numbers ?? [phoneNumberResponse()];
  let created = 0;
  const idOf = (call: YCloudCall) => decodeURIComponent(call.path.split("/").at(-1) ?? "");
  const handler = ycloudRoutes({
    "GET /balance": () => ycOk({ amount: options.balance ?? 12.5, currency: "USD" }),
    "GET /whatsapp/phoneNumbers": () => ycOk(page(numbers)),
    "GET /whatsapp/phoneNumbers/:waba/:phone": (call) => {
      const found = numbers.find((number) => number.phoneNumber === idOf(call));
      return found ? ycOk(found) : ycError(404, "NOT_FOUND");
    },
    "GET /whatsapp/templates": () => ycOk(page([templateResponse()])),
    "POST /webhookEndpoints": (call) => {
      created += 1;
      const id = created === 1 ? YC_TEST.endpointId : `${YC_TEST.endpointId}${created}`;
      const endpoint = { id, url: (call.body as { url: string }).url, status: "active" };
      endpoints.set(id, endpoint);
      secrets.set(id, created === 1 ? YC_TEST.webhookSecret : `${YC_TEST.webhookSecret}${created}`);
      return ycOk({ ...endpoint, enabledEvents: (call.body as { enabledEvents: string[] }).enabledEvents, secret: secrets.get(id) });
    },
    "GET /webhookEndpoints/:id": (call) => {
      const endpoint = endpoints.get(idOf(call));
      return endpoint ? ycOk(endpoint) : ycError(404, "NOT_FOUND");
    },
    "DELETE /webhookEndpoints/:id": (call) => (endpoints.delete(idOf(call)) ? ycOk({}) : ycError(404, "NOT_FOUND")),
    "POST /whatsapp/messages/sendDirectly": () => ycOk(sentMessageResponse()),
    "POST /whatsapp/media/:phone/upload": () => ycOk({ id: "media-subida-1" }),
    "POST /whatsapp/inboundMessages/:id/markAsRead": () => ycOk({}),
    "POST /whatsapp/inboundMessages/:id/typing": () => ycOk({ success: true }),
    ...overrides,
  });
  return { handler, endpoints, secrets };
}

// ─── Webhook events ─────────────────────────────────────────────────────────────────────────────────────

let eventSequence = 5_000;
const nextId = (prefix: string) => `${prefix}${++eventSequence}`;

type InboundOptions = { id?: string; wamid?: string | null; from?: string | null; fromUserId?: string | null; to?: string; sendTime?: string; name?: string | null };

/** `whatsapp.inbound_message.received` of the test customer; `content` is `type` plus Meta's own content object. */
export function inboundEvent(content: Record<string, unknown>, options: InboundOptions = {}) {
  const id = options.id ?? nextId("67aa");
  return {
    id: nextId("evt_in"),
    type: "whatsapp.inbound_message.received",
    apiVersion: "v2",
    createTime: "2026-09-26T10:00:01.000Z",
    whatsappInboundMessage: {
      id,
      ...(options.wamid === null ? {} : { wamid: options.wamid ?? `wamid.${id}` }),
      wabaId: YC_TEST.wabaId,
      ...(options.from === null ? {} : { from: options.from ?? YC_TEST.customer.phone }),
      ...(options.fromUserId === null ? {} : { fromUserId: options.fromUserId ?? YC_TEST.customer.bsuid }),
      customerProfile: { name: options.name === undefined ? YC_TEST.customer.name : options.name },
      to: options.to ?? YC_TEST.phoneNumber,
      sendTime: options.sendTime ?? "2026-09-26T10:00:00.000Z",
      ...content,
    },
  };
}

export const inboundText = (body = "Hola, ¿tenéis hueco mañana?", options?: InboundOptions) => inboundEvent({ type: "text", text: { body } }, options);

export const mediaLink = (mediaId: string) => `${FAKE_YCLOUD_BASE_URL}/whatsapp/media/download/${mediaId}?sig=firma&payload=datos`;

export const inboundImage = (caption?: string, options?: InboundOptions) =>
  inboundEvent({ type: "image", image: { link: mediaLink("592623615738103"), id: "592623615738103", mime_type: "image/jpeg", sha256: "hash", ...(caption ? { caption } : {}) } }, options);

export const inboundVoice = (options?: InboundOptions) =>
  inboundEvent({ type: "audio", audio: { link: mediaLink("592623615738104"), id: "592623615738104", mime_type: "audio/ogg; codecs=opus", voice: true } }, options);

/** `whatsapp.message.updated`: a status of a message this channel sent (by YCloud's id). */
export function statusEvent(messageId: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: nextId("evt_st"),
    type: "whatsapp.message.updated",
    apiVersion: "v2",
    createTime: "2026-09-26T10:00:10.000Z",
    whatsappMessage: {
      id: messageId,
      wamid: `wamid.${messageId}`,
      wabaId: YC_TEST.wabaId,
      from: YC_TEST.phoneNumber,
      to: YC_TEST.customer.phone,
      status,
      type: "text",
      text: { body: "Sí, a las 10." },
      createTime: "2026-09-26T10:00:06.000Z",
      sendTime: "2026-09-26T10:00:07.000Z",
      ...(status === "delivered" || status === "read" ? { deliverTime: "2026-09-26T10:00:08.000Z", pricingType: "regular", pricingCategory: "service", totalPrice: 0, currency: "USD" } : {}),
      ...(status === "read" ? { readTime: "2026-09-26T10:00:09.000Z" } : {}),
      ...overrides,
    },
  };
}

/** `whatsapp.smb.message.echoes`: what the business wrote to the test customer from the app on its phone (coexistence). */
export function echoEvent(content: Record<string, unknown> = { type: "text", text: { body: "Te espero a las 10." } }, overrides: Record<string, unknown> = {}) {
  const id = nextId("67ec");
  return {
    id: nextId("evt_ec"),
    type: "whatsapp.smb.message.echoes",
    apiVersion: "v2",
    createTime: "2026-09-26T10:00:20.000Z",
    whatsappMessage: {
      id,
      wamid: `wamid.${id}`,
      wabaId: YC_TEST.wabaId,
      from: YC_TEST.phoneNumber,
      to: YC_TEST.customer.phone,
      toUserId: YC_TEST.customer.bsuid,
      status: "sent",
      createTime: "2026-09-26T10:00:19.000Z",
      sendTime: "2026-09-26T10:00:19.000Z",
      customerProfile: { name: YC_TEST.customer.name },
      ...content,
      ...overrides,
    },
  };
}

export const templateReviewedEvent = () => ({
  id: nextId("evt_tp"),
  type: "whatsapp.template.reviewed",
  apiVersion: "v2",
  createTime: "2026-09-26T10:00:30.000Z",
  whatsappTemplate: { wabaId: YC_TEST.wabaId, name: "recordatorio_cita", language: "es", status: "APPROVED" },
});

/** The exact bytes YCloud would POST and their `YCloud-Signature` header, signed at `now`. */
export function signedEvent(event: unknown, secret: string, now: Date) {
  const raw = new TextEncoder().encode(typeof event === "string" ? event : JSON.stringify(event));
  return { raw, signature: computeYCloudSignature(secret, raw, Math.floor(now.getTime() / 1_000)) };
}

/** A few bytes that start like a real file of each kind. */
export const OGG_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
