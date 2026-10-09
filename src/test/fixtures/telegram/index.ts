// A fake Telegram Bot API for Vitest and realistic updates (docs/integracion-telegram.md, official shape, invented data):
// an injectable fetch that records every call and answers `{ ok, result }` like Telegram. Tests never call Telegram.

/** Tokens are put together at runtime: no literal in the repository may look like a real key to secret scanners. */
const fakeTokenBody = (seed: string, length: number) => seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
const fakeToken = (botId: string, seed: string) => [botId, fakeTokenBody(seed, 35)].join(":");

export const FAKE_TELEGRAM_BASE_URL = "https://api.telegram.test";

export const TG_TEST = {
  botId: "7000000001",
  botToken: fakeToken("7000000001", "FALSOPRUEBA0"),
  /** Another valid token of the same bot (after /revoke in @BotFather). */
  newBotToken: fakeToken("7000000001", "NUEVOPRUEBA1"),
  /** A token of another bot. */
  otherBotToken: fakeToken("7000000002", "OTROBOTFALSO"),
  botUsername: "peluqueria_ejemplo_bot",
  botName: "Peluquería Ejemplo",
  webhookSecret: "secreto-de-prueba_0123456789",
  customer: { id: "5550001111", firstName: "Ana", lastName: "Pruebas", username: "ana_pruebas" },
} as const;

export type TelegramCall = {
  /** Bot API method (`getMe`, `sendMessage`…) or `file` for a download. */
  method: string;
  token: string;
  /** Path of a downloaded file (after `/file/bot<token>/`). */
  filePath: string | null;
  httpMethod: string;
  headers: Headers;
  /** Parsed JSON, a FormData, or undefined. */
  body: unknown;
};

export type TelegramHandler = (call: TelegramCall) => Response | Promise<Response>;

export function tgOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "content-type": "application/json" } });
}

/** Telegram's error body: `{ ok: false, error_code, description, parameters? }`. */
export function tgError(code: number, description = "Error de prueba", parameters?: { retry_after?: number }): Response {
  return new Response(JSON.stringify({ ok: false, error_code: code, description, ...(parameters ? { parameters } : {}) }), {
    status: code,
    headers: { "content-type": "application/json" },
  });
}

export function tgFile(bytes: Uint8Array, contentType = "application/octet-stream"): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

function parseBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  return typeof body === "string" ? (JSON.parse(body) as unknown) : body;
}

export function fakeTelegramFetch(handler: TelegramHandler) {
  const calls: TelegramCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.origin !== FAKE_TELEGRAM_BASE_URL) throw new Error(`Llamada fuera del Telegram simulado: ${url.origin}`);
    const file = url.pathname.match(/^\/file\/bot([^/]+)\/(.+)$/);
    const api = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
    if (!file && !api) return new Response("Not Found", { status: 404 });
    const call: TelegramCall = {
      method: file ? "file" : (api?.[2] ?? ""),
      token: (file ?? api)?.[1] ?? "",
      filePath: file ? file[2] : null,
      httpMethod: (init?.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers),
      body: parseBody(init),
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl as typeof fetch, calls, deps: { fetchImpl: fetchImpl as typeof fetch, baseUrl: FAKE_TELEGRAM_BASE_URL } };
}

/** Routes by Bot API method (`file` for downloads); anything else answers 501 so a missing stub is loud. */
export function telegramRoutes(table: Record<string, TelegramHandler>): TelegramHandler {
  return (call) => {
    const handler = table[call.method];
    return handler ? handler(call) : tgError(501, `No simulado: ${call.method}`);
  };
}

// ─── Documented answers ─────────────────────────────────────────────────────────────────────────────────

export function botResponse(overrides: Record<string, unknown> = {}) {
  return { id: Number(TG_TEST.botId), is_bot: true, first_name: TG_TEST.botName, username: TG_TEST.botUsername, can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, ...overrides };
}

export function webhookInfoResponse(overrides: Record<string, unknown> = {}) {
  return { url: "", has_custom_certificate: false, pending_update_count: 0, ...overrides };
}

export function sentMessageResponse(messageId = 900, chatId: string = TG_TEST.customer.id) {
  return { message_id: messageId, date: 1_790_416_805, chat: { id: Number(chatId), type: "private", first_name: TG_TEST.customer.firstName }, from: botResponse(), text: "…" };
}

/** A bot that answers everything a connection needs; pass overrides for the methods a test cares about. */
export function connectedBotRoutes(overrides: Record<string, TelegramHandler> = {}): TelegramHandler {
  return telegramRoutes({
    getMe: () => tgOk(botResponse()),
    getWebhookInfo: () => tgOk(webhookInfoResponse()),
    setWebhook: () => tgOk(true),
    deleteWebhook: () => tgOk(true),
    getUpdates: () => tgOk([]),
    sendMessage: () => tgOk(sentMessageResponse()),
    sendChatAction: () => tgOk(true),
    ...overrides,
  });
}

// ─── Updates ────────────────────────────────────────────────────────────────────────────────────────────

let updateSequence = 1_000;

type UpdateOptions = { updateId?: number; messageId?: number; date?: number; from?: Record<string, unknown> | null; chat?: Record<string, unknown> };

const customerUser = () => ({ id: Number(TG_TEST.customer.id), is_bot: false, first_name: TG_TEST.customer.firstName, last_name: TG_TEST.customer.lastName, username: TG_TEST.customer.username, language_code: "es" });
const privateChat = () => ({ id: Number(TG_TEST.customer.id), type: "private", first_name: TG_TEST.customer.firstName, last_name: TG_TEST.customer.lastName, username: TG_TEST.customer.username });

/** An update with a message of the test customer in a private chat; `content` is what the message carries. */
export function telegramUpdate(content: Record<string, unknown>, options: UpdateOptions = {}) {
  const updateId = options.updateId ?? ++updateSequence;
  return {
    update_id: updateId,
    message: {
      message_id: options.messageId ?? updateId,
      ...(options.from === null ? {} : { from: options.from ?? customerUser() }),
      chat: options.chat ?? privateChat(),
      // 2026-09-26T10:00:00Z
      date: options.date ?? 1_790_416_800,
      ...content,
    },
  };
}

export const textUpdate = (text = "Hola, ¿tenéis hueco mañana?", options?: UpdateOptions) => telegramUpdate({ text }, options);

export const voiceUpdate = (options?: UpdateOptions) =>
  telegramUpdate({ voice: { file_id: "AwACAgQAAxkBAAIvoz", file_unique_id: "AgADvoz", duration: 4, mime_type: "audio/ogg", file_size: 9_210 } }, options);

export const photoUpdate = (caption?: string, options?: UpdateOptions) =>
  telegramUpdate(
    {
      photo: [
        { file_id: "AgACAgQAAxkBAAIpequena", file_unique_id: "AQADpeq", width: 90, height: 60, file_size: 1_200 },
        { file_id: "AgACAgQAAxkBAAIgrande", file_unique_id: "AQADgra", width: 1280, height: 853, file_size: 98_000 },
        { file_id: "AgACAgQAAxkBAAImediana", file_unique_id: "AQADmed", width: 320, height: 213, file_size: 14_000 },
      ],
      ...(caption ? { caption } : {}),
    },
    options,
  );

export const documentUpdate = (options?: UpdateOptions) =>
  telegramUpdate({ document: { file_id: "BQACAgQAAxkBAAIdoc", file_unique_id: "AgADdoc", file_name: "presupuesto.pdf", mime_type: "application/pdf", file_size: 48_000 } }, options);

/** The same customer writing in a group the bot is in: ignored. */
export const groupUpdate = (options?: UpdateOptions) => telegramUpdate({ text: "Hola a todos" }, { ...options, chat: { id: -1001234567890, type: "supergroup", title: "Vecinos" } });

/** A few bytes that start like a real file of each kind. */
export const OGG_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
