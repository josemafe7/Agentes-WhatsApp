// Our own client of the Instagram API with Instagram Login (docs/integracion-instagram.md, decision 0029): the business's
// account token as `Authorization: Bearer` on graph.instagram.com, version v25.0. Base URL from INSTAGRAM_GRAPH_BASE_URL
// (the e2e mock server in tests); injectable fetch, so tests never call Instagram. The token renewal is the one documented
// call with the token in the query: no URL is ever logged, stored or put into an error. Answers are parsed with Zod;
// failures become InstagramApiError with a Spanish message.
import "server-only";
import type { z } from "zod";
import { describeInstagramError, INSTAGRAM_BAD_FILE_URL, INSTAGRAM_FILE_TOO_BIG, INSTAGRAM_INVALID_RESPONSE, INSTAGRAM_NETWORK_ERROR, INSTAGRAM_TIMEOUT_ERROR, InstagramApiError } from "./errors";
import {
  graphErrorBodySchema,
  meSchema,
  refreshedTokenSchema,
  sentMessageSchema,
  successSchema,
  userProfileSchema,
  type InstagramAccount,
  type InstagramRefreshedToken,
  type InstagramSentMessage,
  type InstagramUserProfile,
} from "./schemas";

export const DEFAULT_INSTAGRAM_GRAPH_BASE_URL = "https://graph.instagram.com";
/** The version of Instagram's own examples (§3); valid until 29-07-2028. */
export const INSTAGRAM_GRAPH_VERSION = "v25.0";
/** What the account is subscribed to (§4.4): messages (and the echoes), reactions and «seen». */
export const INSTAGRAM_WEBHOOK_FIELDS = ["messages", "message_reactions", "messaging_seen"] as const;
/** A message's text: 1,000 bytes of UTF-8 at most (§6.1). */
export const INSTAGRAM_MAX_TEXT_BYTES = 1_000;
/** Files a customer sends are downloaded up to this size (images 8 MB, audio and PDF 25 MB, §6.1). */
export const INSTAGRAM_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
/** Hosts Instagram serves the customers' files from (CDN, §7); nothing is downloaded from any other. */
const MEDIA_HOST_SUFFIXES = ["cdninstagram.com", "fbcdn.net", "fbsbx.com", "facebook.com", "instagram.com"];

const DEFAULT_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 60_000;
/** A file's address may redirect a few times inside the CDN, each hop checked again. */
const MAX_MEDIA_REDIRECTS = 3;
/** Instagram-scoped user ids and account ids are digits: nothing else is put into a path. */
const NODE_ID = /^\d{1,32}$/;

/** Graph base URL without a trailing slash (INSTAGRAM_GRAPH_BASE_URL or Instagram's). */
export function instagramGraphBaseUrl(): string {
  const fromEnv = process.env.INSTAGRAM_GRAPH_BASE_URL?.trim();
  return (fromEnv || DEFAULT_INSTAGRAM_GRAPH_BASE_URL).replace(/\/+$/, "");
}

/** The text cut to Instagram's 1,000 bytes without splitting a character, ending in «…»; never two messages ([IG-05]). */
export function fitInstagramText(text: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= INSTAGRAM_MAX_TEXT_BYTES) return text;
  const ellipsis = "…";
  const room = INSTAGRAM_MAX_TEXT_BYTES - encoder.encode(ellipsis).byteLength;
  let bytes = 0;
  let cut = "";
  for (const character of text) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > room) break;
    bytes += size;
    cut += character;
  }
  return `${cut.trimEnd()}${ellipsis}`;
}

/** Whether a customer's file may be downloaded from this URL: https on Instagram's CDN, or the configured base URL. */
export function isInstagramMediaUrl(url: string, baseUrl: string = instagramGraphBaseUrl()): boolean {
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
  return MEDIA_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export type InstagramClientOptions = { accessToken: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
export type CallOptions = { timeoutMs?: number; signal?: AbortSignal };
export type DownloadedInstagramFile = { bytes: Uint8Array; contentType: string | null };

export type InstagramClient = {
  /** The professional account of the token (§2.3). */
  getMe(options?: CallOptions): Promise<InstagramAccount>;
  /** Subscribes the account to INSTAGRAM_WEBHOOK_FIELDS (§4.4). */
  subscribeApp(options?: CallOptions): Promise<boolean>;
  /** One text message, already fitted to 1,000 bytes ([IG-05]). */
  sendText(input: { recipientId: string; text: string }, options?: CallOptions): Promise<InstagramSentMessage>;
  /** A new token for 60 more days (§2.2): only with a token at least 24 hours old and not expired. */
  refreshToken(options?: CallOptions): Promise<InstagramRefreshedToken>;
  /** The customer's name and username (§9), once they wrote to the account. */
  getUserProfile(userId: string, options?: CallOptions): Promise<InstagramUserProfile>;
  /** GET of a customer's file on Instagram's CDN, without the token; stops reading past `maxBytes`. */
  downloadFile(url: string, options?: CallOptions & { maxBytes?: number }): Promise<DownloadedInstagramFile>;
};

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InstagramApiError(502, null, INSTAGRAM_INVALID_RESPONSE);
  return parsed.data;
}

function assertNode(id: string): string {
  if (!NODE_ID.test(id)) throw new InstagramApiError(400, 100, describeInstagramError(100));
  return id;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const tooBig = () => new InstagramApiError(413, null, INSTAGRAM_FILE_TOO_BIG);
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

type Request = { method: "GET" | "POST"; path: string; versioned?: boolean; query?: Record<string, string>; json?: unknown; tokenInQuery?: boolean } & CallOptions;

export function createInstagramClient(options: InstagramClientOptions): InstagramClient {
  const baseUrl = (options.baseUrl ?? instagramGraphBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.accessToken.trim();
  if (!token || /\s/.test(token)) throw new InstagramApiError(401, 190, describeInstagramError(190));

  async function call(request: Request): Promise<unknown> {
    const query = new URLSearchParams(request.query);
    const headers: Record<string, string> = { Accept: "application/json" };
    // The renewal is documented with the token in the query (§2.2); everything else uses the header (§3).
    if (request.tokenInQuery) query.set("access_token", token);
    else headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (request.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(request.json);
    }
    const search = query.toString();
    const url = `${baseUrl}/${request.versioned === false ? "" : `${INSTAGRAM_GRAPH_VERSION}/`}${request.path}${search ? `?${search}` : ""}`;
    const timeout = AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchImpl(url, { method: request.method, headers, body, signal, cache: "no-store" });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (timeout.aborted) throw new InstagramApiError(408, null, INSTAGRAM_TIMEOUT_ERROR);
      // The network error's text may carry the URL (and so the token): not kept.
      throw new InstagramApiError(0, null, INSTAGRAM_NETWORK_ERROR);
    }
    const parsed = parseJson(await response.text());
    if (response.ok) return parsed;
    const error = graphErrorBodySchema.safeParse(parsed);
    if (error.success) {
      const code = error.data.error.code ?? null;
      const subcode = error.data.error.error_subcode ?? null;
      const described = describeInstagramError(code, subcode);
      // Meta marks some failures transient: worth another try whatever the code says.
      const info = error.data.error.is_transient ? { ...described, kind: "retryable" as const } : described;
      throw new InstagramApiError(response.status, code, info, subcode);
    }
    if (response.status === 429 || response.status >= 500) throw new InstagramApiError(response.status, null, INSTAGRAM_NETWORK_ERROR);
    throw new InstagramApiError(response.status, null, describeInstagramError(null));
  }

  return {
    async getMe(callOptions = {}) {
      return parseWith(meSchema, await call({ method: "GET", path: "me", query: { fields: "user_id,username,name,account_type" }, ...callOptions }));
    },

    async subscribeApp(callOptions = {}) {
      const body = parseWith(successSchema, await call({ method: "POST", path: "me/subscribed_apps", query: { subscribed_fields: INSTAGRAM_WEBHOOK_FIELDS.join(",") }, ...callOptions }));
      return body.success;
    },

    async sendText(input, callOptions = {}) {
      const json = { recipient: { id: assertNode(input.recipientId) }, message: { text: fitInstagramText(input.text) } };
      return parseWith(sentMessageSchema, await call({ method: "POST", path: "me/messages", json, timeoutMs: SEND_TIMEOUT_MS, ...callOptions }));
    },

    async refreshToken(callOptions = {}) {
      return parseWith(refreshedTokenSchema, await call({ method: "GET", path: "refresh_access_token", versioned: false, query: { grant_type: "ig_refresh_token" }, tokenInQuery: true, ...callOptions }));
    },

    async getUserProfile(userId, callOptions = {}) {
      return parseWith(userProfileSchema, await call({ method: "GET", path: assertNode(userId), query: { fields: "name,username" }, ...callOptions }));
    },

    async downloadFile(url, callOptions = {}) {
      const notInstagram = () => new InstagramApiError(400, null, INSTAGRAM_BAD_FILE_URL);
      if (!isInstagramMediaUrl(url, baseUrl)) throw notInstagram();
      const timeout = AbortSignal.timeout(callOptions.timeoutMs ?? MEDIA_TIMEOUT_MS);
      const signal = callOptions.signal ? AbortSignal.any([callOptions.signal, timeout]) : timeout;
      let target = url;
      let response: Response;
      // A CDN address, never with the token; redirects are followed by hand and each address is checked again.
      for (let hop = 0; ; hop += 1) {
        try {
          response = await fetchImpl(target, { method: "GET", redirect: "manual", signal, cache: "no-store" });
        } catch (error) {
          if (callOptions.signal?.aborted) throw error;
          throw new InstagramApiError(timeout.aborted ? 408 : 0, null, timeout.aborted ? INSTAGRAM_TIMEOUT_ERROR : INSTAGRAM_NETWORK_ERROR);
        }
        if (response.status < 300 || response.status > 399) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || hop >= MAX_MEDIA_REDIRECTS) throw new InstagramApiError(response.status, null, INSTAGRAM_NETWORK_ERROR);
        let next: string;
        try {
          next = new URL(location, target).toString();
        } catch {
          throw notInstagram();
        }
        if (!isInstagramMediaUrl(next, baseUrl)) throw notInstagram();
        target = next;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new InstagramApiError(response.status, null, response.status >= 500 ? INSTAGRAM_NETWORK_ERROR : describeInstagramError(null));
      }
      const bytes = await readLimited(response, callOptions.maxBytes ?? INSTAGRAM_MAX_DOWNLOAD_BYTES);
      return { bytes, contentType: response.headers.get("content-type") };
    },
  };
}
