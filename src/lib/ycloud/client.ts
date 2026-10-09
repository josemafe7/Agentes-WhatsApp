// Our own client of YCloud's API (docs/integracion-ycloud.md): the official WhatsApp API through a Meta partner. Base
// URL from YCLOUD_API_BASE_URL (the e2e mock server in tests); injectable fetch, so tests never call YCloud. Every call
// carries the account's key in the `X-API-Key` header, which never appears in errors or logs. Answers are parsed with
// Zod; failures become YCloudApiError with a Spanish message.
import "server-only";
import type { z } from "zod";
import { describeYCloudError, metaCodeOf, YCLOUD_FILE_TOO_BIG, YCLOUD_INVALID_RESPONSE, YCLOUD_MISSING_KEY, YCLOUD_NETWORK_ERROR, YCLOUD_TIMEOUT_ERROR, YCloudApiError } from "./errors";
import {
  ycloudBalanceSchema,
  ycloudErrorBodySchema,
  ycloudMediaUploadSchema,
  ycloudMessageSchema,
  ycloudPageSchema,
  ycloudPhoneNumberSchema,
  ycloudTemplateSchema,
  ycloudWebhookEndpointSchema,
  type YCloudBalance,
  type YCloudMessage,
  type YCloudPhoneNumber,
  type YCloudTemplate,
  type YCloudWebhookEndpoint,
} from "./schemas";

export const DEFAULT_YCLOUD_API_BASE_URL = "https://api.ycloud.com/v2";

/** What the channel's webhook asks YCloud for: messages, statuses, what is sent from the phone (coexistence) and templates. */
export const YCLOUD_WEBHOOK_EVENTS = [
  "whatsapp.inbound_message.received",
  "whatsapp.message.updated",
  "whatsapp.smb.message.echoes",
  "whatsapp.template.reviewed",
] as const;
/** A message's text: up to 4,096 characters («Sending»). */
export const YCLOUD_MAX_TEXT = 4_096;

const DEFAULT_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 60_000;
const PAGE_SIZE = 100;
/** Pages read of a list at most: an account has a few numbers and some dozens of templates. */
const MAX_PAGES = 20;
const MAX_KEY_LENGTH = 500;
/** Header values are visible ASCII: a key with anything else is not a key. */
const API_KEY = /^[\x21-\x7e]+$/;

/** YCloud's base URL without a trailing slash (YCLOUD_API_BASE_URL or YCloud's). */
export function ycloudApiBaseUrl(): string {
  const fromEnv = process.env.YCLOUD_API_BASE_URL?.trim();
  return (fromEnv || DEFAULT_YCLOUD_API_BASE_URL).replace(/\/+$/, "");
}

export type YCloudClientOptions = { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
export type CallOptions = { timeoutMs?: number; signal?: AbortSignal };
export type DownloadedYCloudMedia = { bytes: Uint8Array; contentType: string | null };

export type YCloudClient = {
  /** The cheapest call that proves the key works («Check account balance»). */
  getBalance(options?: CallOptions): Promise<YCloudBalance>;
  /** Every WhatsApp number of the account, following the pages. */
  listPhoneNumbers(options?: CallOptions): Promise<YCloudPhoneNumber[]>;
  getPhoneNumber(wabaId: string, phoneNumber: string, options?: CallOptions): Promise<YCloudPhoneNumber>;
  /** Every template of a WhatsApp Business account, following the pages. */
  listTemplates(wabaId: string, options?: CallOptions): Promise<YCloudTemplate[]>;
  /** Sent to Meta during the call (`sendDirectly`): a refusal of Meta comes back as an error, with Meta's code. */
  sendMessage(payload: Record<string, unknown>, options?: CallOptions): Promise<YCloudMessage>;
  uploadMedia(phoneNumber: string, file: { bytes: Uint8Array; mimeType: string; fileName?: string | null }, options?: CallOptions): Promise<string>;
  /** `messageId`: the inbound message's YCloud id or its wamid. It also marks the earlier ones as read. */
  markAsRead(messageId: string, options?: CallOptions): Promise<void>;
  /** «escribiendo…» (and read) until the reply or 25 seconds. */
  sendTyping(messageId: string, options?: CallOptions): Promise<void>;
  createWebhookEndpoint(input: { url: string; description?: string }, options?: CallOptions): Promise<YCloudWebhookEndpoint>;
  getWebhookEndpoint(id: string, options?: CallOptions): Promise<YCloudWebhookEndpoint>;
  deleteWebhookEndpoint(id: string, options?: CallOptions): Promise<void>;
  /** GET of a media link of YCloud with the key; only YCloud's own host. Stops reading past `maxBytes`. */
  downloadMedia(url: string, options: CallOptions & { maxBytes: number }): Promise<DownloadedYCloudMedia>;
};

type Body = { json: unknown } | { multipart: FormData } | undefined;
type ApiRequest = { method: "GET" | "POST" | "DELETE"; path: string; query?: Record<string, string>; body?: Body } & CallOptions;

function parseJson(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new YCloudApiError(502, null, YCLOUD_INVALID_RESPONSE);
  return parsed.data;
}

const segment = (value: string) => encodeURIComponent(value);

/** Whether a media link may receive the key: YCloud's own origin (the configured base URL), nothing else. */
export function isYCloudMediaUrl(url: string, baseUrl: string = ycloudApiBaseUrl()): boolean {
  try {
    const parsed = new URL(url);
    return !parsed.username && !parsed.password && parsed.origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const tooBig = () => new YCloudApiError(413, "CONTENT_TOO_LARGE", YCLOUD_FILE_TOO_BIG);
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw tooBig();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function failureOf(response: Response, body: unknown): YCloudApiError {
  const parsed = ycloudErrorBodySchema.safeParse(body);
  const error = parsed.success ? parsed.data.error : null;
  const metaCode = metaCodeOf(error?.whatsappApiError?.code);
  const described = describeYCloudError({ code: error?.code, httpStatus: response.status, metaCode, metaTransient: error?.whatsappApiError?.is_transient === true });
  const retryAfter = Number(response.headers.get("retry-after") ?? "");
  return new YCloudApiError(response.status, described.code, described, described.metaCode, response.status === 429 && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null);
}

export function createYCloudClient(options: YCloudClientOptions): YCloudClient {
  const baseUrl = (options.baseUrl ?? ycloudApiBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey.trim();
  if (!apiKey || apiKey.length > MAX_KEY_LENGTH || !API_KEY.test(apiKey)) throw new YCloudApiError(401, "UNAUTHORIZED", YCLOUD_MISSING_KEY);

  async function send(url: string, init: RequestInit, request: CallOptions, fallbackTimeoutMs: number): Promise<Response> {
    const timeout = AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs ?? fallbackTimeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      return await fetchImpl(url, { ...init, headers: { Accept: "application/json", ...init.headers, "X-API-Key": apiKey }, signal, cache: "no-store" });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (timeout.aborted) throw new YCloudApiError(408, null, YCLOUD_TIMEOUT_ERROR);
      throw new YCloudApiError(0, null, YCLOUD_NETWORK_ERROR);
    }
  }

  async function call(request: ApiRequest, fallbackTimeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const headers: Record<string, string> = {};
    let body: BodyInit | undefined;
    if (request.body && "json" in request.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(request.body.json);
    } else if (request.body && "multipart" in request.body) {
      body = request.body.multipart;
    }
    const search = new URLSearchParams(request.query).toString();
    const response = await send(`${baseUrl}${request.path}${search ? `?${search}` : ""}`, { method: request.method, headers, body }, request, fallbackTimeoutMs);
    let parsed: unknown;
    try {
      parsed = parseJson(await response.text());
    } catch {
      throw new YCloudApiError(0, null, YCLOUD_NETWORK_ERROR);
    }
    if (!response.ok) throw failureOf(response, parsed);
    return parsed;
  }

  /** Every item of a paged list, while a page comes full («Pagination»). */
  async function list<T extends z.ZodType>(path: string, schema: T, query: Record<string, string>, opts?: CallOptions): Promise<z.infer<T>[]> {
    const items: z.infer<T>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = parseWith(ycloudPageSchema, await call({ method: "GET", path, query: { ...query, page: String(page), limit: String(PAGE_SIZE) }, ...opts }));
      // An odd entry is skipped instead of dropping the whole list.
      for (const item of body.items) {
        const parsed = schema.safeParse(item);
        if (parsed.success) items.push(parsed.data);
      }
      if (body.items.length < PAGE_SIZE) break;
    }
    return items;
  }

  return {
    async getBalance(opts) {
      return parseWith(ycloudBalanceSchema, await call({ method: "GET", path: "/balance", ...opts }));
    },

    listPhoneNumbers(opts) {
      return list("/whatsapp/phoneNumbers", ycloudPhoneNumberSchema, {}, opts);
    },

    async getPhoneNumber(wabaId, phoneNumber, opts) {
      return parseWith(ycloudPhoneNumberSchema, await call({ method: "GET", path: `/whatsapp/phoneNumbers/${segment(wabaId)}/${segment(phoneNumber)}`, ...opts }));
    },

    listTemplates(wabaId, opts) {
      return list("/whatsapp/templates", ycloudTemplateSchema, { "filter.wabaId": wabaId }, opts);
    },

    async sendMessage(payload, opts) {
      return parseWith(ycloudMessageSchema, await call({ method: "POST", path: "/whatsapp/messages/sendDirectly", body: { json: payload }, ...opts }, SEND_TIMEOUT_MS));
    },

    async uploadMedia(phoneNumber, file, opts) {
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName?.trim() || "archivo");
      const body = await call({ method: "POST", path: `/whatsapp/media/${segment(phoneNumber)}/upload`, body: { multipart: form }, ...opts }, MEDIA_TIMEOUT_MS);
      return parseWith(ycloudMediaUploadSchema, body).id;
    },

    async markAsRead(messageId, opts) {
      await call({ method: "POST", path: `/whatsapp/inboundMessages/${segment(messageId)}/markAsRead`, ...opts });
    },

    async sendTyping(messageId, opts) {
      await call({ method: "POST", path: `/whatsapp/inboundMessages/${segment(messageId)}/typing`, ...opts });
    },

    async createWebhookEndpoint(input, opts) {
      const json = { url: input.url, enabledEvents: [...YCLOUD_WEBHOOK_EVENTS], status: "active", ...(input.description ? { description: input.description } : {}) };
      return parseWith(ycloudWebhookEndpointSchema, await call({ method: "POST", path: "/webhookEndpoints", body: { json }, ...opts }));
    },

    async getWebhookEndpoint(id, opts) {
      return parseWith(ycloudWebhookEndpointSchema, await call({ method: "GET", path: `/webhookEndpoints/${segment(id)}`, ...opts }));
    },

    async deleteWebhookEndpoint(id, opts) {
      await call({ method: "DELETE", path: `/webhookEndpoints/${segment(id)}`, ...opts });
    },

    async downloadMedia(url, opts) {
      // The key only ever goes to YCloud's own host, whatever a webhook says.
      if (!isYCloudMediaUrl(url, baseUrl)) throw new YCloudApiError(400, "PARAM_INVALID", describeYCloudError({ code: "PARAM_INVALID" }));
      const response = await send(url, { method: "GET", redirect: "error" }, opts, MEDIA_TIMEOUT_MS);
      if (!response.ok) {
        await response.body?.cancel();
        throw failureOf(response, null);
      }
      return { bytes: await readLimited(response, opts.maxBytes), contentType: response.headers.get("content-type") };
    },
  };
}
