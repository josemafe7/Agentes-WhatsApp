// Our own client of the Telegram Bot API (docs/integracion-telegram.md). Base URL from TELEGRAM_API_BASE_URL (the e2e
// mock server in tests); injectable fetch, so tests never call Telegram. Every call goes to
// `<base>/bot<token>/<method>` and files to `<base>/file/bot<token>/<file_path>`: THE TOKEN TRAVELS IN THE URL, so a URL
// is never logged, stored or put into an error. Answers are parsed with Zod; failures become TelegramApiError with a
// Spanish message.
import "server-only";
import type { z } from "zod";
import { describeTelegramError, TELEGRAM_FILE_TOO_BIG, TELEGRAM_INVALID_RESPONSE, TELEGRAM_NETWORK_ERROR, TELEGRAM_TIMEOUT_ERROR, TelegramApiError } from "./errors";
import {
  telegramBotSchema,
  telegramErrorBodySchema,
  telegramFileSchema,
  telegramOkBodySchema,
  telegramSentMessageSchema,
  telegramUpdateSchema,
  telegramWebhookInfoSchema,
  type TelegramBot,
  type TelegramFile,
  type TelegramSentMessage,
  type TelegramUpdate,
  type TelegramWebhookInfo,
} from "./schemas";

export const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";

/**
 * Numbers, a colon and letters, as @BotFather gives it (`123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`). Telegram documents
 * the token only by example, so this is no more than what makes it safe inside a URL path; the real check is getMe.
 */
export const TELEGRAM_TOKEN_PATTERN = /^\d{1,20}:[A-Za-z0-9_-]{1,200}$/;
/**
 * The only updates this app wants: messages, the taps on a reminder's buttons and the customer blocking or unblocking
 * the bot ([TG-12], [TG-13]). Every setWebhook and getUpdates says so (docs/integracion-telegram.md).
 */
export const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"] as const;
/** A message's text: 1–4,096 characters («Envío»). */
export const TELEGRAM_MAX_TEXT = 4_096;
/** A file's caption: 0–1,024 characters. */
export const TELEGRAM_MAX_CAPTION = 1_024;
/** Bots download files of up to 20 MB («Archivos»). */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** At most this many updates per getUpdates call (the API's own maximum). */
export const TELEGRAM_UPDATES_LIMIT = 100;

const DEFAULT_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 60_000;
/** Added to a long poll's own wait, so the request outlives it. */
const LONG_POLL_MARGIN_MS = 10_000;
/** `photos/file_1.jpg`: plain path segments, as getFile gives them. */
const FILE_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

/** Bot API base URL without a trailing slash (TELEGRAM_API_BASE_URL or Telegram's). */
export function telegramApiBaseUrl(): string {
  const fromEnv = process.env.TELEGRAM_API_BASE_URL?.trim();
  return (fromEnv || DEFAULT_TELEGRAM_API_BASE_URL).replace(/\/+$/, "");
}

/** Whether `value` looks like a bot token (the real check is getMe). */
export function isTelegramToken(value: string): boolean {
  return TELEGRAM_TOKEN_PATTERN.test(value);
}

export type TelegramClientOptions = {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type CallOptions = { timeoutMs?: number; signal?: AbortSignal };

export type TelegramUpload = { bytes: Uint8Array; mimeType: string; fileName?: string | null };
export type DownloadedTelegramFile = { bytes: Uint8Array; contentType: string | null };

export type TelegramClient = {
  getMe(options?: CallOptions): Promise<TelegramBot>;
  getWebhookInfo(options?: CallOptions): Promise<TelegramWebhookInfo>;
  /** Always with TELEGRAM_ALLOWED_UPDATES: omitting it keeps whatever list the bot had. */
  setWebhook(input: { url: string; secretToken: string; dropPendingUpdates?: boolean }, options?: CallOptions): Promise<boolean>;
  deleteWebhook(input?: { dropPendingUpdates?: boolean }, options?: CallOptions): Promise<boolean>;
  /** Only works while the bot has no webhook (409 otherwise). `timeoutSec` > 0 = long polling. */
  getUpdates(input?: { offset?: number; limit?: number; timeoutSec?: number }, options?: CallOptions): Promise<TelegramUpdate[]>;
  getFile(fileId: string, options?: CallOptions): Promise<TelegramFile>;
  /** GET of `<base>/file/bot<token>/<file_path>`; stops reading past `maxBytes`. */
  downloadFile(filePath: string, options?: CallOptions & { maxBytes?: number }): Promise<DownloadedTelegramFile>;
  /** Plain text, without parse_mode (nothing to escape); with buttons, one row of them ([TG-13]). */
  sendMessage(input: { chatId: string; text: string; buttons?: readonly { text: string; data: string }[] }, options?: CallOptions): Promise<TelegramSentMessage>;
  /** Answers a button's tap, always: until then the customer sees a progress bar. */
  answerCallbackQuery(input: { callbackQueryId: string; text?: string }, options?: CallOptions): Promise<boolean>;
  /** The file is uploaded with the call (multipart): ours are private, so there is no URL to give. */
  sendPhoto(input: { chatId: string; file: TelegramUpload; caption?: string | null }, options?: CallOptions): Promise<TelegramSentMessage>;
  /** «escribiendo…» for 5 seconds at most, or until the message arrives. */
  sendTyping(chatId: string, options?: CallOptions): Promise<boolean>;
};

type Body = { json: Record<string, unknown> } | { multipart: FormData } | undefined;
type ApiRequest = { method: string; body?: Body } & CallOptions;

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
  if (!parsed.success) throw new TelegramApiError(502, null, TELEGRAM_INVALID_RESPONSE);
  return parsed.data;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const tooBig = () => new TelegramApiError(413, 413, TELEGRAM_FILE_TOO_BIG);
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

export function createTelegramClient(options: TelegramClientOptions): TelegramClient {
  const baseUrl = (options.baseUrl ?? telegramApiBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token.trim();
  // A token that does not look like one never reaches a URL: it is simply not valid.
  if (!isTelegramToken(token)) throw new TelegramApiError(401, 401, describeTelegramError(401));

  async function send(url: string, init: RequestInit, request: CallOptions, fallbackTimeoutMs: number): Promise<Response> {
    const timeout = AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs ?? fallbackTimeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      return await fetchImpl(url, { ...init, signal, cache: "no-store" });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (timeout.aborted) throw new TelegramApiError(408, null, TELEGRAM_TIMEOUT_ERROR);
      // The network error's text may carry the URL (and with it the token): not kept.
      throw new TelegramApiError(0, null, TELEGRAM_NETWORK_ERROR);
    }
  }

  async function call(request: ApiRequest, fallbackTimeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    let body: BodyInit | undefined;
    if (request.body && "json" in request.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(request.body.json);
    } else if (request.body && "multipart" in request.body) {
      body = request.body.multipart;
    }
    const response = await send(`${baseUrl}/bot${token}/${request.method}`, { method: "POST", headers, body }, request, fallbackTimeoutMs);
    let parsed: unknown;
    try {
      parsed = parseJson(await response.text());
    } catch {
      throw new TelegramApiError(0, null, TELEGRAM_NETWORK_ERROR);
    }
    const failure = telegramErrorBodySchema.safeParse(parsed);
    if (failure.success) throw TelegramApiError.fromTelegram(response.status, failure.data);
    if (!response.ok) throw TelegramApiError.fromTelegram(response.status, null);
    return parseWith(telegramOkBodySchema, parsed).result;
  }

  const truthy = async (request: ApiRequest) => (await call(request)) === true;

  return {
    async getMe(opts) {
      return parseWith(telegramBotSchema, await call({ method: "getMe", ...opts }));
    },

    async getWebhookInfo(opts) {
      return parseWith(telegramWebhookInfoSchema, await call({ method: "getWebhookInfo", ...opts }));
    },

    async setWebhook(input, opts) {
      const json = {
        url: input.url,
        secret_token: input.secretToken,
        allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
        ...(input.dropPendingUpdates ? { drop_pending_updates: true } : {}),
      };
      return truthy({ method: "setWebhook", body: { json }, ...opts });
    },

    async deleteWebhook(input, opts) {
      return truthy({ method: "deleteWebhook", body: { json: input?.dropPendingUpdates ? { drop_pending_updates: true } : {} }, ...opts });
    },

    async getUpdates(input, opts) {
      const timeoutSec = Math.max(0, Math.floor(input?.timeoutSec ?? 0));
      const json = {
        ...(input?.offset !== undefined ? { offset: input.offset } : {}),
        limit: Math.min(Math.max(1, input?.limit ?? TELEGRAM_UPDATES_LIMIT), TELEGRAM_UPDATES_LIMIT),
        timeout: timeoutSec,
        allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
      };
      const result = await call({ method: "getUpdates", body: { json }, ...opts }, timeoutSec * 1_000 + LONG_POLL_MARGIN_MS);
      if (!Array.isArray(result)) throw new TelegramApiError(502, null, TELEGRAM_INVALID_RESPONSE);
      // An odd entry is skipped instead of dropping the whole batch.
      return result.flatMap((entry) => {
        const parsed = telegramUpdateSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      });
    },

    async getFile(fileId, opts) {
      return parseWith(telegramFileSchema, await call({ method: "getFile", body: { json: { file_id: fileId } }, ...opts }));
    },

    async downloadFile(filePath, opts) {
      if (!FILE_PATH.test(filePath) || filePath.split("/").includes("..")) throw new TelegramApiError(400, 400, describeTelegramError(400));
      const response = await send(`${baseUrl}/file/bot${token}/${filePath}`, { method: "GET" }, opts ?? {}, MEDIA_TIMEOUT_MS);
      if (!response.ok) {
        await response.body?.cancel();
        throw TelegramApiError.fromTelegram(response.status, null);
      }
      const bytes = await readLimited(response, opts?.maxBytes ?? TELEGRAM_MAX_DOWNLOAD_BYTES);
      return { bytes, contentType: response.headers.get("content-type") };
    },

    async sendMessage(input, opts) {
      const keyboard = input.buttons?.length ? { reply_markup: { inline_keyboard: [input.buttons.map((button) => ({ text: button.text, callback_data: button.data }))] } } : {};
      const result = await call({ method: "sendMessage", body: { json: { chat_id: input.chatId, text: input.text, ...keyboard } }, ...opts }, SEND_TIMEOUT_MS);
      return parseWith(telegramSentMessageSchema, result);
    },

    answerCallbackQuery(input, opts) {
      return truthy({ method: "answerCallbackQuery", body: { json: { callback_query_id: input.callbackQueryId, ...(input.text ? { text: input.text } : {}) } }, ...opts });
    },

    async sendPhoto(input, opts) {
      const form = new FormData();
      form.set("chat_id", input.chatId);
      if (input.caption) form.set("caption", input.caption);
      form.set("photo", new Blob([new Uint8Array(input.file.bytes)], { type: input.file.mimeType }), input.file.fileName?.trim() || "imagen");
      return parseWith(telegramSentMessageSchema, await call({ method: "sendPhoto", body: { multipart: form }, ...opts }, MEDIA_TIMEOUT_MS));
    },

    async sendTyping(chatId, opts) {
      return truthy({ method: "sendChatAction", body: { json: { chat_id: chatId, action: "typing" } }, ...opts });
    },
  };
}
