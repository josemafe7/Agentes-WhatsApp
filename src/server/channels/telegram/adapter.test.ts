import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages } from "@/db/schema";
import { createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { connectedBotRoutes, fakeTelegramFetch, JPEG_BYTES, sentMessageResponse, textUpdate, TG_TEST, tgError, tgFile, tgOk, voiceUpdate, type TelegramHandler } from "@/test/fixtures/telegram";
import { ChannelSendError, type ChannelRecord } from "../types";
import { createTelegramAdapter } from "./adapter";
import { encryptTelegramSecrets } from "./config";

function adapter(handler: TelegramHandler = connectedBotRoutes()) {
  const fake = fakeTelegramFetch(handler);
  return { calls: fake.calls, adapter: createTelegramAdapter(fake.deps) };
}

const bot = (overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> =>
  createChannel({
    type: "telegram",
    name: "Telegram",
    config: { botId: TG_TEST.botId, botUsername: TG_TEST.botUsername, receiveMode: "webhook" },
    secretsEnc: encryptTelegramSecrets({ botToken: TG_TEST.botToken, webhookSecret: TG_TEST.webhookSecret }),
    ...overrides,
  });

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts]) await db.delete(table);
  await db.delete(channels);
});

describe("TelegramAdapter [TG-01] [TG-03] [TG-04]", () => {
  it("validateAndConnect checks the token and returns what to store, never storing anything itself [CAN-17]", async () => {
    const draft = await createChannel({ type: "telegram", status: "draft" });
    const fresh = adapter();
    const result = await fresh.adapter.validateAndConnect(draft, { botToken: TG_TEST.botToken });
    expect(result).toMatchObject({ ok: true, config: { botId: TG_TEST.botId, botUsername: TG_TEST.botUsername, botName: TG_TEST.botName }, secrets: { bot_token: TG_TEST.botToken } });
    expect(String(result.secrets?.webhook_secret)).toMatch(/^[A-Za-z0-9_-]{20,256}$/);
    expect((await db.select().from(channels))[0].secretsEnc).toBeNull();

    // «Revalidar»: without a token it checks the stored one and keeps the channel's secret.
    const connected = await bot();
    expect((await adapter().adapter.validateAndConnect(connected, {})).secrets).toEqual({ bot_token: TG_TEST.botToken, webhook_secret: TG_TEST.webhookSecret });
    expect(await adapter().adapter.validateAndConnect(draft, {})).toEqual({ ok: false, error: "Falta el token del bot." });
    expect((await adapter(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized") })).adapter.validateAndConnect(draft, { botToken: TG_TEST.botToken })).ok).toBe(false);
    expect((await adapter().adapter.validateAndConnect(draft, { otra: "cosa" })).ok).toBe(false);
  });

  it("handleWebhook turns an already verified update into this channel's event, never calling Telegram [CAN-10]", async () => {
    const { adapter: telegram, calls } = adapter();
    const channel = await bot();
    expect(await telegram.handleWebhook(channel, { body: textUpdate("Hola") })).toMatchObject([{ kind: "inbound_message", contentType: "text", text: "Hola" }]);
    expect(await telegram.handleWebhook(channel, { body: { update_id: 1 } })).toEqual([]);
    expect(await telegram.handleWebhook(channel, { body: "nada" })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("sends to the chat of the conversation and shows «escribiendo…» in the chat of the message [TG-09]", async () => {
    const channel = await bot();
    const { contact } = await createContactWithIdentity("telegram", { externalId: TG_TEST.customer.id });
    const conversation = await createConversation(channel.id, contact.id);
    await createMessage(conversation, { externalId: `${TG_TEST.customer.id}:7`, metadata: { telegramChatId: TG_TEST.customer.id } });
    const { adapter: telegram, calls } = adapter(connectedBotRoutes({ sendMessage: () => tgOk(sentMessageResponse(8)) }));
    const sent = await telegram.send(channel, {
      messageId: crypto.randomUUID(),
      conversationId: conversation.id,
      recipient: { externalIds: [TG_TEST.customer.id], phone: null, email: null, name: "Ana" },
      threadId: null,
      contentType: "text",
      text: "¡Hola, Ana!",
    });
    expect(sent).toMatchObject({ externalId: `${TG_TEST.customer.id}:8`, status: "sent" });
    await telegram.sendTyping?.(channel, `${TG_TEST.customer.id}:7`);
    expect(calls.map((call) => [call.method, (call.body as { chat_id: string }).chat_id])).toEqual([["sendMessage", TG_TEST.customer.id], ["sendChatAction", TG_TEST.customer.id]]);
    // Telegram has no read receipts for bots.
    expect(telegram.markRead).toBeUndefined();
  });

  it("a bot without its token, or a contact without a chat, fails to send with a Spanish reason", async () => {
    const { adapter: telegram, calls } = adapter();
    const message = { messageId: crypto.randomUUID(), conversationId: crypto.randomUUID(), recipient: { externalIds: [], phone: null, email: null, name: null }, threadId: null, contentType: "text" as const, text: "Hola" };
    await expect(telegram.send(await bot({ secretsEnc: null }), message)).rejects.toThrow(ChannelSendError);
    await expect(telegram.send(await bot(), message)).rejects.toThrow(/no tiene un chat de Telegram/);
    expect(calls).toHaveLength(0);
  });

  it("downloads a customer's file by its id, and «Desconectar» removes the webhook", async () => {
    const channel = await bot();
    const { adapter: telegram, calls } = adapter(connectedBotRoutes({ getFile: () => tgOk({ file_id: "f", file_unique_id: "u", file_size: JPEG_BYTES.length, file_path: "photos/file_2.jpg" }), file: () => tgFile(JPEG_BYTES) }));
    const file = await telegram.downloadMedia(channel, { externalMediaId: "f", mimeType: "image/jpeg" });
    expect(file).toMatchObject({ mimeType: "image/jpeg" });
    expect([...file.bytes]).toEqual([...JPEG_BYTES]);
    await telegram.disconnect(channel);
    await telegram.disconnect(await bot({ secretsEnc: null }));
    expect(calls.map((call) => call.method)).toEqual(["getFile", "file", "deleteWebhook"]);
    expect(voiceUpdate().message).toHaveProperty("voice");
  });
});
