// A fake Instagram Graph API for Vitest and realistic webhooks (docs/integracion-instagram.md, official shapes, invented
// data): an injectable fetch that records every call and answers like graph.instagram.com, and a signer for webhook
// bodies. Tests never call Instagram.
import { computeMetaSignature } from "@/lib/meta/signature";

/** Tokens are put together at runtime: no literal in the repository may look like a real key to secret scanners. */
const fakeToken = (seed: string) => ["prueba", seed.repeat(8)].join("-");

export const FAKE_INSTAGRAM_BASE_URL = "https://graph.instagram.test";
/** Instagram's CDN, where the customers' files are (§7). */
export const FAKE_INSTAGRAM_CDN = "https://scontent.cdninstagram.com";

export const IG_TEST = {
  /** `user_id` of /me: the professional account, `entry[].id` of its webhooks. */
  accountId: "17840000000000001",
  /** `id` of /me: the app-scoped id (never the channel's key). */
  appScopedId: "9000000000000002",
  username: "peluqueria_ejemplo",
  accountName: "Peluquería Ejemplo",
  accessToken: fakeToken("FALSOPRUEBA0"),
  /** What the renewal gives back. */
  renewedToken: fakeToken("RENOVADO0001"),
  /** A token of another account. */
  otherAccountToken: fakeToken("OTRACUENTA00"),
  /** The two secrets of the doc's test vectors (§4.3): the Instagram app secret and the Meta app secret. */
  appSecret: "test_ig_app_secret",
  metaAppSecret: "test_app_secret",
  verifyToken: "token-de-verificacion-de-prueba-0123",
  otherAccount: { accountId: "17840000000000099", username: "otra_cuenta" },
  customer: { id: "1100000000000003", name: "Ana Pruebas", username: "ana_pruebas" },
  mid: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQw",
} as const;

export type InstagramCall = {
  httpMethod: string;
  /** Path after the base URL, without the version: «me», «me/messages», «refresh_access_token», «<IGSID>»; «file» for the CDN. */
  route: string;
  /** The version in the path, or null («refresh_access_token» goes without one, a file too). */
  version: string | null;
  url: URL;
  /** From `Authorization: Bearer` or, for the renewal, the `access_token` of the query. */
  token: string | null;
  headers: Headers;
  body: unknown;
};

export type InstagramHandler = (call: InstagramCall) => Response | Promise<Response>;

export function igOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Graph's error body (§3): `{ error: { message, type, code, error_subcode?, fbtrace_id } }`. */
export function igError(code: number, subcode?: number, status = 400, extra: Record<string, unknown> = {}): Response {
  const error = { message: "Error de prueba", type: "OAuthException", code, ...(subcode !== undefined ? { error_subcode: subcode } : {}), fbtrace_id: "AbCdEf123", ...extra };
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}

export function igFile(bytes: Uint8Array, contentType = "application/octet-stream"): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

function parseBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  return typeof body === "string" ? (JSON.parse(body) as unknown) : body;
}

export function fakeInstagramFetch(handler: InstagramHandler) {
  const calls: InstagramCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const bearer = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1] ?? null;
    let call: InstagramCall;
    if (url.origin === FAKE_INSTAGRAM_BASE_URL) {
      const match = /^\/(?:(v\d+\.\d+)\/)?(.+)$/.exec(url.pathname);
      if (!match) return new Response("Not Found", { status: 404 });
      call = { httpMethod: (init?.method ?? "GET").toUpperCase(), route: match[2], version: match[1] ?? null, url, token: bearer ?? url.searchParams.get("access_token"), headers, body: parseBody(init) };
    } else if (url.protocol === "https:" && (url.hostname.endsWith(".cdninstagram.com") || url.hostname.endsWith(".fbcdn.net"))) {
      call = { httpMethod: (init?.method ?? "GET").toUpperCase(), route: "file", version: null, url, token: bearer, headers, body: undefined };
    } else {
      throw new Error(`Llamada fuera del Instagram simulado: ${url.origin}`);
    }
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl as typeof fetch, calls, deps: { fetchImpl: fetchImpl as typeof fetch, baseUrl: FAKE_INSTAGRAM_BASE_URL } };
}

/**
 * Routes by «METHOD route» («GET me», «POST me/messages», «GET refresh_access_token», «GET file»); a customer's profile
 * is «GET user» (any id of digits). Anything else answers 501 so a missing stub is loud.
 */
export function instagramRoutes(table: Record<string, InstagramHandler>): InstagramHandler {
  return (call) => {
    const key = /^\d+$/.test(call.route) ? `${call.httpMethod} user` : `${call.httpMethod} ${call.route}`;
    const handler = table[key];
    return handler ? handler(call) : igError(1, undefined, 501, { message: `No simulado: ${key}` });
  };
}

// ─── Documented answers ─────────────────────────────────────────────────────────────────────────────────

export function meResponse(overrides: Record<string, unknown> = {}) {
  return { user_id: IG_TEST.accountId, id: IG_TEST.appScopedId, username: IG_TEST.username, name: IG_TEST.accountName, account_type: "Business", ...overrides };
}

export function sentResponse(messageId: string = `m_${crypto.randomUUID()}`, recipientId: string = IG_TEST.customer.id) {
  return { recipient_id: recipientId, message_id: messageId };
}

/** 60 days in seconds, like a fresh token (§2.2). */
export const SIXTY_DAYS_S = 60 * 24 * 60 * 60;

/** An account that answers everything a connection and a reply need; pass overrides for what a test cares about. */
export function connectedAccountRoutes(overrides: Record<string, InstagramHandler> = {}): InstagramHandler {
  return instagramRoutes({
    "GET me": () => igOk(meResponse()),
    "POST me/subscribed_apps": () => igOk({ success: true }),
    "POST me/messages": () => igOk(sentResponse()),
    "GET refresh_access_token": () => igOk({ access_token: IG_TEST.renewedToken, token_type: "bearer", expires_in: SIXTY_DAYS_S }),
    "GET user": () => igOk({ name: IG_TEST.customer.name, username: IG_TEST.customer.username }),
    ...overrides,
  });
}

// ─── Webhooks (§5) ──────────────────────────────────────────────────────────────────────────────────────

let midSequence = 0;
/** A new message id, shaped like Instagram's. */
export const nextMid = () => `aWdfZAG1faXRlbToxOklHTWVzc2FnZA${String(++midSequence).padStart(6, "0")}`;

/** 2026-10-16T08:00:00.123Z, in milliseconds like Meta's examples. */
export const T_MS = 1_792_137_600_123;

export type MessagingOptions = { mid?: string; timestamp?: number; from?: string; to?: string };

/** The webhook body around some `messaging[]` items, for one account. */
export function instagramWebhook(messaging: unknown[], accountId: string = IG_TEST.accountId) {
  return { object: "instagram", entry: [{ id: accountId, time: T_MS + 500, messaging }] };
}

/** A customer's message to the account; `message` is what it carries (text, attachments…). */
export function customerMessage(message: Record<string, unknown>, options: MessagingOptions = {}) {
  return {
    sender: { id: options.from ?? IG_TEST.customer.id },
    recipient: { id: options.to ?? IG_TEST.accountId },
    timestamp: options.timestamp ?? T_MS,
    message: { mid: options.mid ?? nextMid(), ...message },
  };
}

export const textMessage = (text = "Hola, ¿tenéis cita el viernes?", options?: MessagingOptions) => customerMessage({ text }, options);

export const attachmentMessage = (type: string, url = `${FAKE_INSTAGRAM_CDN}/v/t51.2885-15/archivo_${type}.bin`, options?: MessagingOptions) =>
  customerMessage({ attachments: [{ type, payload: { url } }] }, options);

/** What the business account sent (an echo): from the account to the customer. */
export function echoMessage(message: Record<string, unknown>, options: MessagingOptions = {}) {
  return {
    sender: { id: options.from ?? IG_TEST.accountId },
    recipient: { id: options.to ?? IG_TEST.customer.id },
    timestamp: options.timestamp ?? T_MS,
    message: { mid: options.mid ?? nextMid(), is_echo: true, ...message },
  };
}

export const reactionEvent = (mid: string, emoji: string | null, options: MessagingOptions = {}) => ({
  sender: { id: options.from ?? IG_TEST.customer.id },
  recipient: { id: IG_TEST.accountId },
  timestamp: options.timestamp ?? T_MS,
  reaction: emoji === null ? { mid, action: "unreact" } : { mid, action: "react", reaction: "love", emoji },
});

export const readEvent = (mid: string, options: MessagingOptions = {}) => ({
  sender: { id: options.from ?? IG_TEST.customer.id },
  recipient: { id: IG_TEST.accountId },
  timestamp: options.timestamp ?? T_MS,
  read: { mid },
});

export const deletedMessage = (mid: string, options: MessagingOptions = {}) => customerMessage({ is_deleted: true }, { ...options, mid });

/** The exact bytes of a body and their X-Hub-Signature-256 with `secret` (the Instagram app secret by default). */
export function signedBody(body: unknown, secret: string = IG_TEST.appSecret): { raw: Uint8Array; text: string; signature: string } {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { raw: new TextEncoder().encode(text), text, signature: computeMetaSignature(secret, text) };
}

/** A few bytes that start like a real file of each kind. */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const M4A_BYTES = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 1, 2, 3, 4]);
export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n%prueba\n");
