import { describe, expect, it } from "vitest";
import { documentUpdate, groupUpdate, photoUpdate, telegramUpdate, textUpdate, TG_TEST, voiceUpdate } from "@/test/fixtures/telegram";
import { UNSUPPORTED_TEXT } from "../whatsapp/normalize";
import { normalizeTelegramUpdate, telegramExternalId } from "./normalize";

describe("Telegram updates → normalized events [TG-03]", () => {
  it("a text of a private chat: the identity is the user's id, never a phone [CAN-13]", () => {
    const update = normalizeTelegramUpdate(textUpdate("Hola", { updateId: 41, messageId: 7 }));
    expect(update?.updateId).toBe(41);
    expect(update?.download).toBeNull();
    expect(update?.event).toMatchObject({
      kind: "inbound_message",
      externalId: telegramExternalId(TG_TEST.customer.id, 7),
      contentType: "text",
      text: "Hola",
      sender: { externalIds: [TG_TEST.customer.id], displayName: "Ana Pruebas" },
      metadata: { telegramChatId: TG_TEST.customer.id, telegramUsername: TG_TEST.customer.username },
    });
    expect(update?.event?.sender.phone).toBeUndefined();
    expect(update?.event?.sentAt.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(update?.event?.noReply).toBeUndefined();
  });

  it("a voice note becomes an audio waiting for its download, to be transcribed", () => {
    const update = normalizeTelegramUpdate(voiceUpdate({ messageId: 8 }));
    expect(update?.event).toMatchObject({ contentType: "audio", media: { externalMediaId: "AwACAgQAAxkBAAIvoz", mimeType: "audio/ogg", durationSec: 4, downloadStatus: "pending" } });
    expect(update?.download).toEqual({ externalId: telegramExternalId(TG_TEST.customer.id, 8), fileId: "AwACAgQAAxkBAAIvoz", mimeType: "audio/ogg" });
  });

  it("a photo takes its largest size, with the caption as its text", () => {
    const update = normalizeTelegramUpdate(photoUpdate("Quiero este corte"));
    expect(update?.event).toMatchObject({ contentType: "image", text: "Quiero este corte", media: { externalMediaId: "AgACAgQAAxkBAAIgrande", downloadStatus: "pending" } });
    expect(update?.download?.fileId).toBe("AgACAgQAAxkBAAIgrande");
  });

  it("any other kind is a notice of the system the AI never answers", () => {
    const update = normalizeTelegramUpdate(documentUpdate());
    expect(update?.event).toMatchObject({ contentType: "unsupported", text: UNSUPPORTED_TEXT, noReply: true, metadata: { unsupported: { type: "document" } } });
    expect(update?.download).toBeNull();
    expect(normalizeTelegramUpdate(telegramUpdate({ sticker: { file_id: "s" } }))?.event?.metadata).toMatchObject({ unsupported: { type: "sticker" } });
    expect(normalizeTelegramUpdate(telegramUpdate({}))?.event?.metadata).toMatchObject({ unsupported: { type: "other" } });
  });

  it("groups, channels, other bots and messages without sender are ignored", () => {
    expect(normalizeTelegramUpdate(groupUpdate())).toMatchObject({ event: null, download: null });
    expect(normalizeTelegramUpdate(textUpdate("soy un bot", { from: { id: 99, is_bot: true, first_name: "Otro bot" } }))?.event).toBeNull();
    expect(normalizeTelegramUpdate(textUpdate("sin remitente", { from: null }))?.event).toBeNull();
  });

  it("other kinds of update are ignored, and what is not an update is told apart", () => {
    expect(normalizeTelegramUpdate({ update_id: 5, edited_message: { message_id: 1 } })).toEqual({ updateId: 5, event: null, download: null });
    expect(normalizeTelegramUpdate({ update_id: 6, message: { message_id: "roto" } })?.event).toBeNull();
    for (const body of [null, "hola", [], {}, { message: {} }, { update_id: "1" }]) expect(normalizeTelegramUpdate(body)).toBeNull();
  });
});
