import { describe, expect, it } from "vitest";
import { botResponse, fakeTelegramFetch, FAKE_TELEGRAM_BASE_URL, JPEG_BYTES, sentMessageResponse, telegramRoutes, TG_TEST, tgError, tgFile, tgOk, webhookInfoResponse } from "@/test/fixtures/telegram";
import { createTelegramClient, isTelegramToken, TELEGRAM_ALLOWED_UPDATES } from "./client";
import { describeTelegramError, isTelegramApiError, TelegramApiError } from "./errors";

function client(handlers: Parameters<typeof telegramRoutes>[0], token: string = TG_TEST.botToken) {
  const fake = fakeTelegramFetch(telegramRoutes(handlers));
  return { calls: fake.calls, api: createTelegramClient({ token, ...fake.deps }) };
}

async function failure(run: () => Promise<unknown>): Promise<TelegramApiError> {
  try {
    await run();
  } catch (error) {
    if (isTelegramApiError(error)) return error;
    throw error;
  }
  throw new Error("La llamada tendría que haber fallado.");
}

describe("Telegram Bot API client (docs/integracion-telegram.md)", () => {
  it("calls <base>/bot<token>/<method> and reads `result` [TG-01]", async () => {
    const { api, calls } = client({ getMe: () => tgOk(botResponse()) });
    const me = await api.getMe();
    expect(me).toMatchObject({ id: TG_TEST.botId, username: TG_TEST.botUsername, first_name: TG_TEST.botName });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "getMe", token: TG_TEST.botToken, httpMethod: "POST" });
  });

  it("a text that does not look like a token never reaches a URL [SEG-05]", () => {
    const fake = fakeTelegramFetch(telegramRoutes({}));
    for (const token of ["", "hola", "123456", "123:abc/../../x", "123:abc?x=1", `${TG_TEST.botToken}/getMe`]) {
      expect(isTelegramToken(token)).toBe(false);
      expect(() => createTelegramClient({ token, ...fake.deps })).toThrow(TelegramApiError);
    }
    expect(isTelegramToken(TG_TEST.botToken)).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it("setWebhook always sends the secret and only asks for messages [TG-01]", async () => {
    const { api, calls } = client({ setWebhook: () => tgOk(true) });
    await api.setWebhook({ url: "https://agentes.example.com/api/webhooks/telegram/abc", secretToken: TG_TEST.webhookSecret });
    expect(calls[0].body).toEqual({ url: "https://agentes.example.com/api/webhooks/telegram/abc", secret_token: TG_TEST.webhookSecret, allowed_updates: [...TELEGRAM_ALLOWED_UPDATES] });
    expect(TELEGRAM_ALLOWED_UPDATES).toEqual(["message"]);
  });

  it("getUpdates asks only for messages from the offset, and skips an odd entry [TG-06]", async () => {
    const { api, calls } = client({ getUpdates: () => tgOk([{ update_id: 11, message: { message_id: 1 } }, "roto", { update_id: 12 }]) });
    const updates = await api.getUpdates({ offset: 11 });
    expect(updates.map((update) => update.update_id)).toEqual([11, 12]);
    expect(calls[0].body).toEqual({ offset: 11, limit: 100, timeout: 0, allowed_updates: ["message"] });
  });

  it("errors come in Spanish by code and never carry the token or Telegram's text [TG-09] [SEG-02]", async () => {
    const { api } = client({
      getMe: () => tgError(401, "Unauthorized"),
      sendMessage: () => tgError(403, "Forbidden: bot was blocked by the user"),
      getUpdates: () => tgError(409, "Conflict: can't use getUpdates method while webhook is active"),
      getWebhookInfo: () => tgError(502, "Bad Gateway"),
    });
    const unauthorized = await failure(() => api.getMe());
    expect(unauthorized).toMatchObject({ code: 401, retryable: false });
    expect(unauthorized.userMessage).toMatch(/token del bot no es válido/);
    const blocked = await failure(() => api.sendMessage({ chatId: "1", text: "hola" }));
    expect(blocked).toMatchObject({ code: 403, retryable: false });
    expect(blocked.userMessage).toMatch(/bloqueado el bot/);
    expect(await failure(() => api.getUpdates())).toMatchObject({ code: 409, retryable: false });
    expect(await failure(() => api.getWebhookInfo())).toMatchObject({ code: 502, retryable: true });
    for (const error of [unauthorized, blocked]) {
      expect(`${error.message} ${error.userMessage} ${error.action}`).not.toContain(TG_TEST.botToken);
      expect(error.message).not.toMatch(/Unauthorized|Forbidden/);
    }
  });

  it("a 429 says how long to wait and is worth another try [TG-09]", async () => {
    const { api } = client({ sendMessage: () => tgError(429, "Too Many Requests: retry after 3", { retry_after: 3 }) });
    expect(await failure(() => api.sendMessage({ chatId: "1", text: "hola" }))).toMatchObject({ code: 429, retryable: true, retryAfterSec: 3 });
  });

  it("a network failure keeps neither the URL nor the token [SEG-02]", async () => {
    const api = createTelegramClient({
      token: TG_TEST.botToken,
      baseUrl: FAKE_TELEGRAM_BASE_URL,
      fetchImpl: (async (input: string | URL | Request) => {
        throw new Error(`connect ECONNREFUSED ${String(input)}`);
      }) as typeof fetch,
    });
    const error = await failure(() => api.getMe());
    expect(error.retryable).toBe(true);
    expect(`${error.message} ${error.userMessage}`).not.toContain(TG_TEST.botToken);
  });

  it("an unknown code shows the code; a 5xx is Telegram's own failure", () => {
    expect(describeTelegramError(418).message).toContain("418");
    expect(describeTelegramError(503)).toMatchObject({ retryable: true });
    expect(describeTelegramError(null).retryable).toBe(false);
  });

  it("downloads a file from /file/bot<token>/<path>, never a path that leaves it, never past the limit [TG-11]", async () => {
    const { api, calls } = client({ getFile: () => tgOk({ file_id: "f", file_unique_id: "u", file_size: JPEG_BYTES.length, file_path: "photos/file_1.jpg" }), file: () => tgFile(JPEG_BYTES, "image/jpeg") });
    const info = await api.getFile("f");
    const file = await api.downloadFile(info.file_path ?? "");
    expect([...file.bytes]).toEqual([...JPEG_BYTES]);
    expect(calls[1]).toMatchObject({ method: "file", filePath: "photos/file_1.jpg", httpMethod: "GET" });
    for (const path of ["../getMe", "photos/../../x", "https://evil.example/x", "photos/file 1.jpg", ""]) {
      expect(await failure(() => api.downloadFile(path))).toMatchObject({ code: 400 });
    }
    expect(await failure(() => api.downloadFile("photos/file_1.jpg", { maxBytes: 4 }))).toMatchObject({ code: 413 });
    expect(calls.filter((call) => call.method === "file")).toHaveLength(2);
  });

  it("sends text as JSON without parse_mode and a photo as multipart with its caption [TG-03]", async () => {
    const { api, calls } = client({ sendMessage: () => tgOk(sentMessageResponse(901)), sendPhoto: () => tgOk(sentMessageResponse(902)), sendChatAction: () => tgOk(true) });
    expect(await api.sendMessage({ chatId: TG_TEST.customer.id, text: "Hola *Ana*" })).toMatchObject({ message_id: 901, chat: { id: TG_TEST.customer.id } });
    expect(calls[0].body).toEqual({ chat_id: TG_TEST.customer.id, text: "Hola *Ana*" });
    await api.sendPhoto({ chatId: TG_TEST.customer.id, file: { bytes: JPEG_BYTES, mimeType: "image/jpeg", fileName: "corte.jpg" }, caption: "Así queda" });
    const form = calls[1].body as FormData;
    expect(form.get("chat_id")).toBe(TG_TEST.customer.id);
    expect(form.get("caption")).toBe("Así queda");
    expect((form.get("photo") as File).name).toBe("corte.jpg");
    expect(await api.sendTyping(TG_TEST.customer.id)).toBe(true);
    expect(calls[2].body).toEqual({ chat_id: TG_TEST.customer.id, action: "typing" });
  });

  it("an answer that is not what the API documents is an error, not a crash", async () => {
    const { api } = client({ getMe: () => tgOk({ id: 1, is_bot: false }), getWebhookInfo: () => new Response("<html>", { status: 200 }) });
    expect(await failure(() => api.getMe())).toMatchObject({ retryable: true });
    expect(await failure(() => api.getWebhookInfo())).toMatchObject({ retryable: true });
    expect(webhookInfoResponse().url).toBe("");
  });
});
