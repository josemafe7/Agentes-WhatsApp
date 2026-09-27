// Our own Graph API client for the WhatsApp Cloud API (docs/integracion-whatsapp.md, docs/integracion-whatsapp-
// mensajes.md). Base URL from META_GRAPH_BASE_URL (the e2e mock server in tests) plus the channel's version in every
// path ([WA-49]); injectable fetch, so tests never call Meta. Two tokens: the system user's (Bearer) for everything
// about the number and the WABA, and the app token (APP_ID|APP_SECRET) ONLY for /debug_token and
// /{APP_ID}/subscriptions. Responses are parsed with Zod; failures become MetaGraphError with a Spanish message.
// Tokens never appear in errors or logs (the app token travels in the query: URLs are never logged).
import "server-only";
import type { z } from "zod";
import { describeMetaError, META_INVALID_RESPONSE, META_NETWORK_ERROR, META_TIMEOUT_ERROR, MetaGraphError, type MetaErrorInfo } from "./errors";
import {
  appSubscriptionsSchema,
  debugTokenSchema,
  graphErrorBodySchema,
  healthEntitySchema,
  mediaInfoSchema,
  phoneNumberSchema,
  sendMessageResponseSchema,
  subscribedAppsSchema,
  successSchema,
  templateSchema,
  templatesPageSchema,
  uploadMediaResponseSchema,
  wabaSchema,
  type AppSubscription,
  type DebugTokenData,
  type HealthEntity,
  type MediaInfo,
  type MetaTemplate,
  type PhoneNumberResponse,
  type SendMessageResponse,
  type SubscribedApp,
  type WabaResponse,
} from "./schemas";
import { DEFAULT_GRAPH_API_VERSION, isValidGraphVersion } from "./versions";

export const DEFAULT_META_GRAPH_BASE_URL = "https://graph.facebook.com";

/** Fields read from the number when validating and in the health check (docs/integracion-whatsapp.md §3.1). */
export const PHONE_NUMBER_FIELDS = [
  "id",
  "display_phone_number",
  "verified_name",
  "quality_rating",
  "code_verification_status",
  "name_status",
  "new_display_name",
  "new_name_status",
  "status",
  "whatsapp_business_manager_messaging_limit",
  "health_status",
] as const;

/** Webhook fields subscribed on the app (docs/integracion-whatsapp.md §4.1, «Campos recomendados»). */
export const WHATSAPP_WEBHOOK_FIELDS = [
  "messages",
  "account_update",
  "phone_number_quality_update",
  "phone_number_name_update",
  "message_template_status_update",
  "template_category_update",
  "message_template_quality_update",
  "business_capability_update",
  "account_alerts",
  "security",
] as const;

const DEFAULT_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 60_000;
/** A media URL may redirect a few times, each hop checked again (as src/server/web-fetch.ts does). */
const MAX_MEDIA_REDIRECTS = 3;
const TEMPLATE_PAGE_SIZE = 100;
const MAX_TEMPLATE_PAGES = 60;
/** Graph node ids (numbers, WABAs, apps, media) are digits: nothing else is put into a path. */
const NODE_ID = /^\d{1,32}$/;
/** Hosts Meta serves media from (docs/integracion-whatsapp-mensajes.md §10.2): the Bearer token goes to no other. */
const META_MEDIA_HOST_SUFFIXES = ["fbsbx.com", "facebook.com", "fbcdn.net", "whatsapp.net"];

/** Graph base URL without a trailing slash (META_GRAPH_BASE_URL or Meta's). */
export function metaGraphBaseUrl(): string {
  const fromEnv = process.env.META_GRAPH_BASE_URL?.trim();
  return (fromEnv || DEFAULT_META_GRAPH_BASE_URL).replace(/\/+$/, "");
}

export type MetaGraphClientOptions = {
  /** Permanent system user token: `Authorization: Bearer`. */
  accessToken?: string | null;
  /** App ID and App Secret form the app token (only for /debug_token and /{APP_ID}/subscriptions). */
  appId?: string | null;
  appSecret?: string | null;
  /** Graph API version of the channel ([WA-49]); v26.0 by default. */
  version?: string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type CallOptions = { timeoutMs?: number; signal?: AbortSignal };

export type DownloadedMetaMedia = { bytes: Uint8Array; contentType: string | null };

export type MetaGraphClient = {
  readonly version: string;
  /** Pass `fields` with "webhook_configuration" for the diagnosis: the app's URL and any override (§4.4). */
  getPhoneNumber(phoneNumberId: string, options?: CallOptions & { fields?: readonly string[] }): Promise<PhoneNumberResponse>;
  getWaba(wabaId: string, options?: CallOptions): Promise<WabaResponse>;
  /** App token. */
  debugToken(inputToken: string, options?: CallOptions): Promise<DebugTokenData>;
  /** App token. */
  listAppSubscriptions(options?: CallOptions): Promise<AppSubscription[]>;
  /** App token. Meta calls our GET verification during this request (§4.1). */
  subscribeApp(input: { callbackUrl: string; verifyToken: string; fields?: readonly string[] }, options?: CallOptions): Promise<boolean>;
  getSubscribedApps(wabaId: string, options?: CallOptions): Promise<SubscribedApp[]>;
  /** Without body: never override_callback_uri ([WA-15]). */
  subscribeWaba(wabaId: string, options?: CallOptions): Promise<boolean>;
  unsubscribeWaba(wabaId: string, options?: CallOptions): Promise<boolean>;
  register(phoneNumberId: string, pin: string, options?: CallOptions): Promise<boolean>;
  deregister(phoneNumberId: string, options?: CallOptions): Promise<boolean>;
  requestCode(phoneNumberId: string, method: "SMS" | "VOICE", options?: CallOptions & { language?: string }): Promise<boolean>;
  verifyCode(phoneNumberId: string, code: string, options?: CallOptions): Promise<boolean>;
  setTwoStepPin(phoneNumberId: string, pin: string, options?: CallOptions): Promise<boolean>;
  /** Every page, following the `after` cursor (never the absolute `next` URL). */
  listTemplates(wabaId: string, options?: CallOptions): Promise<MetaTemplate[]>;
  sendMessage(phoneNumberId: string, payload: Record<string, unknown>, options?: CallOptions): Promise<SendMessageResponse>;
  /** «Leído», and «escribiendo…» with `typing` (it also marks as read) ([WA-45]). */
  markRead(phoneNumberId: string, messageId: string, options?: CallOptions & { typing?: boolean }): Promise<boolean>;
  getMedia(mediaId: string, options?: CallOptions & { phoneNumberId?: string }): Promise<MediaInfo>;
  /** GET of a media URL with the same Bearer token; only Meta's hosts or the configured base URL. */
  downloadMedia(url: string, options?: CallOptions & { maxBytes?: number }): Promise<DownloadedMetaMedia>;
  uploadMedia(phoneNumberId: string, file: { bytes: Uint8Array; mimeType: string; fileName?: string | null }, options?: CallOptions): Promise<string>;
};

type Auth = "user" | "app";
type Body = { json: unknown } | { form: Record<string, string> } | { multipart: FormData } | undefined;
type GraphRequest = { method: "GET" | "POST" | "DELETE"; path: string; query?: Record<string, string>; body?: Body; auth: Auth } & CallOptions;

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function httpErrorInfo(status: number): MetaErrorInfo {
  if (status === 429 || status >= 500) return { ...META_NETWORK_ERROR, message: "Meta no está disponible ahora mismo. Se reintentará." };
  return describeMetaError(null);
}

function assertNode(id: string): string {
  if (!NODE_ID.test(id)) throw new MetaGraphError(400, 100, describeMetaError(100));
  return id;
}

/** Whether a media URL may receive the Bearer token: https on Meta's hosts, or the configured base URL (the mock). */
export function isAllowedMediaUrl(url: string, baseUrl: string = metaGraphBaseUrl()): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.origin === new URL(baseUrl).origin) return true;
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return META_MEDIA_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new MetaGraphError(413, 131052, describeMetaError(131052));
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
      throw new MetaGraphError(413, 131052, describeMetaError(131052));
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

function parseWith<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new MetaGraphError(502, null, META_INVALID_RESPONSE);
  return parsed.data;
}

/** The health entities of a number, skipping any odd entry (§3.2). */
export function healthEntitiesOf(phone: Pick<PhoneNumberResponse, "health_status">): HealthEntity[] {
  return (phone.health_status?.entities ?? []).flatMap((entry) => {
    const parsed = healthEntitySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export function createMetaGraphClient(options: MetaGraphClientOptions = {}): MetaGraphClient {
  const baseUrl = (options.baseUrl ?? metaGraphBaseUrl()).replace(/\/+$/, "");
  const version = options.version?.trim() || DEFAULT_GRAPH_API_VERSION;
  if (!isValidGraphVersion(version)) throw new MetaGraphError(400, 100, { ...describeMetaError(100), message: "La versión de la API de Meta no es válida." });
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = options.accessToken?.trim() ?? "";
  const appId = options.appId?.trim() ?? "";
  const appSecret = options.appSecret?.trim() ?? "";

  async function send(request: GraphRequest): Promise<Response> {
    const query = new URLSearchParams(request.query);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (request.auth === "user") {
      if (!accessToken) throw new MetaGraphError(401, 190, describeMetaError(190));
      headers.Authorization = `Bearer ${accessToken}`;
    } else {
      if (!NODE_ID.test(appId) || !appSecret) {
        throw new MetaGraphError(400, 100, { ...describeMetaError(100), message: "Faltan el App ID o el App Secret de la app de Meta." });
      }
      // The documented form of the app token (§2.2); the URL is never logged.
      query.set("access_token", `${appId}|${appSecret}`);
    }
    let body: BodyInit | undefined;
    if (request.body && "json" in request.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(request.body.json);
    } else if (request.body && "form" in request.body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(request.body.form).toString();
    } else if (request.body && "multipart" in request.body) {
      body = request.body.multipart;
    }
    const search = query.toString();
    const url = `${baseUrl}/${version}/${request.path}${search ? `?${search}` : ""}`;
    const timeout = AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      return await fetchImpl(url, { method: request.method, headers, body, signal, cache: "no-store" });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (timeout.aborted) throw new MetaGraphError(408, null, META_TIMEOUT_ERROR);
      // The network error's text may carry the URL (and the app token): not kept.
      throw new MetaGraphError(0, null, META_NETWORK_ERROR);
    }
  }

  async function call(request: GraphRequest): Promise<unknown> {
    const response = await send(request);
    let body: unknown;
    try {
      body = parseJson(await response.text());
    } catch {
      throw new MetaGraphError(0, null, META_NETWORK_ERROR);
    }
    const error = graphErrorBodySchema.safeParse(body);
    if (error.success) throw MetaGraphError.fromMeta(response.status, error.data.error);
    if (!response.ok) throw new MetaGraphError(response.status, null, httpErrorInfo(response.status));
    if (body === undefined || body === null || typeof body !== "object") throw new MetaGraphError(502, null, META_INVALID_RESPONSE);
    return body;
  }

  const success = async (request: GraphRequest) => parseWith(successSchema, await call(request)).success;

  return {
    version,

    async getPhoneNumber(phoneNumberId, opts) {
      const fields = (opts?.fields ?? PHONE_NUMBER_FIELDS).join(",");
      return parseWith(phoneNumberSchema, await call({ method: "GET", path: assertNode(phoneNumberId), query: { fields }, auth: "user", ...opts }));
    },

    async getWaba(wabaId, opts) {
      const fields = "id,name,account_review_status,business_verification_status,country,timezone_id,currency,status";
      return parseWith(wabaSchema, await call({ method: "GET", path: assertNode(wabaId), query: { fields }, auth: "user", ...opts }));
    },

    async debugToken(inputToken, opts) {
      const body = await call({ method: "GET", path: "debug_token", query: { input_token: inputToken }, auth: "app", ...opts });
      return parseWith(debugTokenSchema, body).data;
    },

    async listAppSubscriptions(opts) {
      return parseWith(appSubscriptionsSchema, await call({ method: "GET", path: `${assertNode(appId)}/subscriptions`, auth: "app", ...opts })).data;
    },

    async subscribeApp(input, opts) {
      const form = {
        object: "whatsapp_business_account",
        callback_url: input.callbackUrl,
        verify_token: input.verifyToken,
        fields: (input.fields ?? WHATSAPP_WEBHOOK_FIELDS).join(","),
        include_values: "true",
      };
      return success({ method: "POST", path: `${assertNode(appId)}/subscriptions`, body: { form }, auth: "app", ...opts });
    },

    async getSubscribedApps(wabaId, opts) {
      return parseWith(subscribedAppsSchema, await call({ method: "GET", path: `${assertNode(wabaId)}/subscribed_apps`, auth: "user", ...opts })).data;
    },

    subscribeWaba: (wabaId, opts) => success({ method: "POST", path: `${assertNode(wabaId)}/subscribed_apps`, auth: "user", ...opts }),
    unsubscribeWaba: (wabaId, opts) => success({ method: "DELETE", path: `${assertNode(wabaId)}/subscribed_apps`, auth: "user", ...opts }),

    register: (phoneNumberId, pin, opts) =>
      success({ method: "POST", path: `${assertNode(phoneNumberId)}/register`, body: { json: { messaging_product: "whatsapp", pin } }, auth: "user", ...opts }),
    deregister: (phoneNumberId, opts) => success({ method: "POST", path: `${assertNode(phoneNumberId)}/deregister`, auth: "user", ...opts }),

    requestCode: (phoneNumberId, method, opts) =>
      success({
        method: "POST",
        path: `${assertNode(phoneNumberId)}/request_code`,
        // Spanish by default ([WA-19]): the two-letter code of the template languages list (§5.2).
        body: { json: { code_method: method, language: opts?.language ?? "es" } },
        auth: "user",
        ...opts,
      }),
    verifyCode: (phoneNumberId, code, opts) =>
      success({ method: "POST", path: `${assertNode(phoneNumberId)}/verify_code`, body: { json: { code } }, auth: "user", ...opts }),
    setTwoStepPin: (phoneNumberId, pin, opts) => success({ method: "POST", path: assertNode(phoneNumberId), body: { json: { pin } }, auth: "user", ...opts }),

    async listTemplates(wabaId, opts) {
      const templates: MetaTemplate[] = [];
      let after: string | null = null;
      for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
        const query: Record<string, string> = {
          fields: "id,name,language,status,category,parameter_format,components,rejected_reason",
          limit: String(TEMPLATE_PAGE_SIZE),
          ...(after ? { after } : {}),
        };
        const body = parseWith(templatesPageSchema, await call({ method: "GET", path: `${assertNode(wabaId)}/message_templates`, query, auth: "user", ...opts }));
        for (const entry of body.data) {
          const template = templateSchema.safeParse(entry);
          if (template.success) templates.push(template.data);
        }
        after = body.paging?.next ? (body.paging.cursors?.after ?? null) : null;
        if (!after) break;
      }
      return templates;
    },

    async sendMessage(phoneNumberId, payload, opts) {
      const body = await call({
        method: "POST",
        path: `${assertNode(phoneNumberId)}/messages`,
        body: { json: { messaging_product: "whatsapp", ...payload } },
        auth: "user",
        timeoutMs: SEND_TIMEOUT_MS,
        ...opts,
      });
      return parseWith(sendMessageResponseSchema, body);
    },

    markRead: (phoneNumberId, messageId, opts) =>
      success({
        method: "POST",
        path: `${assertNode(phoneNumberId)}/messages`,
        body: { json: { messaging_product: "whatsapp", status: "read", message_id: messageId, ...(opts?.typing ? { typing_indicator: { type: "text" } } : {}) } },
        auth: "user",
        ...opts,
      }),

    async getMedia(mediaId, opts) {
      const query = opts?.phoneNumberId ? { phone_number_id: assertNode(opts.phoneNumberId) } : undefined;
      return parseWith(mediaInfoSchema, await call({ method: "GET", path: assertNode(mediaId), query, auth: "user", ...opts }));
    },

    async downloadMedia(url, opts) {
      if (!accessToken) throw new MetaGraphError(401, 190, describeMetaError(190));
      const notMeta = () => new MetaGraphError(400, null, { ...describeMetaError(null), message: "La dirección del archivo no es de Meta." });
      if (!isAllowedMediaUrl(url, baseUrl)) throw notMeta();
      const timeout = AbortSignal.timeout(opts?.timeoutMs ?? MEDIA_TIMEOUT_MS);
      const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const firstOrigin = new URL(url).origin;
      let target = url;
      let response: Response;
      // Redirects are followed by hand: every address is checked again, and the token only goes to the first host.
      for (let hop = 0; ; hop += 1) {
        const headers: Record<string, string> = new URL(target).origin === firstOrigin ? { Authorization: `Bearer ${accessToken}` } : {};
        try {
          response = await fetchImpl(target, { method: "GET", headers, redirect: "manual", signal, cache: "no-store" });
        } catch (error) {
          if (opts?.signal?.aborted) throw error;
          throw new MetaGraphError(timeout.aborted ? 408 : 0, null, timeout.aborted ? META_TIMEOUT_ERROR : META_NETWORK_ERROR);
        }
        if (response.status < 300 || response.status > 399) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || hop >= MAX_MEDIA_REDIRECTS) throw new MetaGraphError(response.status, null, httpErrorInfo(response.status));
        let next: string;
        try {
          next = new URL(location, target).toString();
        } catch {
          throw notMeta();
        }
        if (!isAllowedMediaUrl(next, baseUrl)) throw notMeta();
        target = next;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new MetaGraphError(response.status, null, httpErrorInfo(response.status));
      }
      const bytes = await readLimited(response, opts?.maxBytes ?? Number.MAX_SAFE_INTEGER);
      return { bytes, contentType: response.headers.get("content-type") };
    },

    async uploadMedia(phoneNumberId, file, opts) {
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      // Marked as required in the parameter table although the example omits it (§10.4): always sent.
      form.set("type", file.mimeType);
      form.set("file", new Blob([file.bytes.slice()], { type: file.mimeType }), file.fileName || "archivo");
      const body = await call({ method: "POST", path: `${assertNode(phoneNumberId)}/media`, body: { multipart: form }, auth: "user", timeoutMs: MEDIA_TIMEOUT_MS, ...opts });
      return parseWith(uploadMediaResponseSchema, body).id;
    },
  };
}
