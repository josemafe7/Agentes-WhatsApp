import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import { createTelegramClient, TELEGRAM_MAX_TEXT } from "@/lib/telegram/client";
import { createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { fakeTelegramFetch, JPEG_BYTES, sentMessageResponse, telegramRoutes, TG_TEST, tgError, tgOk, type TelegramHandler } from "@/test/fixtures/telegram";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { ChannelSendError, type OutboundMessage } from "../types";
import { fitTelegramText, loadTelegramChatId, SEND_MAX_ATTEMPTS, sendRetryDelayMs, sendTelegramMessage } from "./send";

const CHAT = TG_TEST.customer.id;

function outbound(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    messageId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    recipient: { externalIds: [CHAT], phone: null, email: null, name: "Ana" },
    threadId: null,
    contentType: "text",
    text: "Hola, Ana",
    ...overrides,
  };
}

function setup(handlers: Record<string, TelegramHandler>) {
  const fake = fakeTelegramFetch(telegramRoutes(handlers));
  const waits: number[] = [];
  const memory = memoryFileStorage();
  const client = createTelegramClient({ token: TG_TEST.botToken, ...fake.deps });
  const send = (message: OutboundMessage) => sendTelegramMessage(client, CHAT, message, { sleep: async (ms) => void waits.push(ms), storage: memory.storage });
  return { calls: fake.calls, waits, memory, send };
}

async function sendError(run: () => Promise<unknown>): Promise<ChannelSendError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ChannelSendError) return error;
    throw error;
  }
  throw new Error("El envío tendría que haber fallado.");
}

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts]) await db.delete(table);
  await db.delete(channels);
});

describe("sending by Telegram [TG-03] [TG-09]", () => {
  it("one text message per call; its id in the channel is chat:message", async () => {
    const { send, calls } = setup({ sendMessage: () => tgOk(sentMessageResponse(321)) });
    const result = await send(outbound());
    expect(result).toMatchObject({ externalId: `${CHAT}:321`, status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ chat_id: CHAT, text: "Hola, Ana" });
  });

  it("a text longer than Telegram takes is cut, never split in two messages [WA-44]", async () => {
    const { send, calls } = setup({ sendMessage: () => tgOk(sentMessageResponse()) });
    await send(outbound({ text: "a".repeat(TELEGRAM_MAX_TEXT + 500) }));
    expect(calls).toHaveLength(1);
    const sent = (calls[0].body as { text: string }).text;
    expect(sent).toHaveLength(TELEGRAM_MAX_TEXT);
    expect(sent.endsWith("…")).toBe(true);
  });

  it("the cut never leaves half an emoji", () => {
    expect(fitTelegramText("hola")).toBe("hola");
    const cut = fitTelegramText(`${"a".repeat(8)}😀😀`, 10);
    expect(cut).toBe(`${"a".repeat(8)}…`);
    expect(cut.isWellFormed()).toBe(true);
    expect(fitTelegramText("😀😀😀", 4)).toBe("😀…");
  });

  it("a 429 waits what Telegram asks and tries again [TG-09]", async () => {
    let attempt = 0;
    const { send, waits, calls } = setup({ sendMessage: () => (++attempt === 1 ? tgError(429, "Too Many Requests: retry after 2", { retry_after: 2 }) : tgOk(sentMessageResponse(5))) });
    expect(await send(outbound())).toMatchObject({ externalId: `${CHAT}:5` });
    expect(waits).toEqual([2_000]);
    expect(calls).toHaveLength(2);
    expect(sendRetryDelayMs(null, 0)).toBe(1_000);
    expect(sendRetryDelayMs(null, 2)).toBe(4_000);
  });

  it("a wait longer than the reply can afford, or too many tries, ends as a final failure", async () => {
    const long = setup({ sendMessage: () => tgError(429, "Too Many Requests", { retry_after: 60 }) });
    expect(await sendError(() => long.send(outbound()))).toMatchObject({ retryable: false, channelCode: 429 });
    expect(long.calls).toHaveLength(1);
    const down = setup({ sendMessage: () => tgError(502, "Bad Gateway") });
    expect((await sendError(() => down.send(outbound()))).retryable).toBe(false);
    expect(down.calls).toHaveLength(SEND_MAX_ATTEMPTS);
  });

  it("a customer who blocked the bot: failed at once, in Spanish, without retries [TG-09]", async () => {
    const { send, calls } = setup({ sendMessage: () => tgError(403, "Forbidden: bot was blocked by the user") });
    const error = await sendError(() => send(outbound()));
    expect(error).toMatchObject({ retryable: false, channelCode: 403 });
    expect(error.userMessage).toMatch(/bloqueado el bot/);
    expect(calls).toHaveLength(1);
  });

  it("a person's image goes as a photo with its text as the caption", async () => {
    const { send, calls, memory } = setup({ sendPhoto: () => tgOk(sentMessageResponse(77)) });
    await memory.storage.put("media/2026/09/foto.jpg", JPEG_BYTES, "image/jpeg");
    const result = await send(outbound({ contentType: "image", text: "Así queda", media: { fileKey: "media/2026/09/foto.jpg", mimeType: "image/jpeg", fileName: "corte.jpg" } }));
    expect(result.externalId).toBe(`${CHAT}:77`);
    const form = calls[0].body as FormData;
    expect(form.get("caption")).toBe("Así queda");
    expect((form.get("photo") as File).size).toBe(JPEG_BYTES.length);
  });

  it("nothing is sent for an empty text, a missing file or a kind Telegram is not used for", async () => {
    const { send, calls } = setup({});
    expect((await sendError(() => send(outbound({ text: "  " })))).userMessage).toBe("El mensaje está vacío.");
    expect((await sendError(() => send(outbound({ contentType: "image", media: { fileKey: "media/no-existe.jpg" } })))).userMessage).toMatch(/archivo/);
    expect((await sendError(() => send(outbound({ contentType: "template" })))).userMessage).toMatch(/no se puede enviar por Telegram/);
    expect(calls).toHaveLength(0);
  });

  it("the chat to answer in is the one the customer's last message came from, else the contact's id", async () => {
    const channel = await createChannel({ type: "telegram" });
    const { contact } = await createContactWithIdentity("telegram", { externalId: CHAT });
    const conversation = await createConversation(channel.id, contact.id);
    expect(await loadTelegramChatId(conversation.id, [CHAT])).toBe(CHAT);
    expect(await loadTelegramChatId(conversation.id, ["no-es-un-id"])).toBeNull();
    await createMessage(conversation, { metadata: { telegramChatId: "424242" } });
    expect(await loadTelegramChatId(conversation.id, [CHAT])).toBe("424242");
  });
});
