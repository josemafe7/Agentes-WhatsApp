import { describe, expect, it } from "vitest";
import { QR_TEST, qrDocument, qrImage, qrLongText, qrMessage, qrText, qrVoice } from "@/test/fixtures/whatsapp-qr";
import { PHONE_SENDER_NAME } from "../phone-echo";
import { UNSUPPORTED_TEXT } from "../whatsapp/normalize";
import { isLidJid, isPersonJid, isPnJid, jidOfIdentity, normalizeJid, normalizeQrMessage, QR_JID_METADATA_KEY, qrDeliveryStatus, type QrNormalizeContext, type QrRawMessage } from "./normalize";

const T0 = new Date(QR_TEST.now * 1_000 + 2_000);
const context: QrNormalizeContext = { self: { pn: QR_TEST.self.pn, lid: QR_TEST.self.lid }, linkedAt: new Date((QR_TEST.now - 3_600) * 1_000), receivedAt: T0 };
const normalize = (raw: QrRawMessage, overrides: Partial<QrNormalizeContext> = {}) => normalizeQrMessage(raw, { ...context, ...overrides });

describe("WhatsApp addresses (JIDs)", () => {
  it("drops the device and tells people apart from everything else [QR-06]", () => {
    expect(normalizeJid("34611222333:12@s.whatsapp.net")).toBe("34611222333@s.whatsapp.net");
    expect(normalizeJid(QR_TEST.self.lid)).toBe("200300400500600@lid");
    for (const odd of [null, undefined, "", "sin-arroba", "a@b@c", "34611 222@s.whatsapp.net", "x/../y@lid"]) expect(normalizeJid(odd)).toBeNull();
    expect(isPnJid("34611222333@s.whatsapp.net")).toBe(true);
    expect(isLidJid("111222333444555@lid")).toBe(true);
    for (const jid of ["34611222333@s.whatsapp.net", "111222333444555@lid", "34611222333:3@s.whatsapp.net"]) expect(isPersonJid(jid)).toBe(true);
    for (const jid of ["120363041234567890@g.us", "status@broadcast", "1234567890@broadcast", "120363099999999999@newsletter", "13135550002@bot", "abc@s.whatsapp.net", null, ""]) expect(isPersonJid(jid)).toBe(false);
  });

  it("writes to a customer by their LID, or by their phone-number id when that is all there is [QR-07]", () => {
    expect(jidOfIdentity("111222333444555@lid")).toBe("111222333444555@lid");
    expect(jidOfIdentity("34611222333")).toBe("34611222333@s.whatsapp.net");
    for (const odd of ["ES.13491208655302741918", "ana@example.com", "", "120363041234567890@g.us"]) expect(jidOfIdentity(odd)).toBeNull();
  });
});

describe("a customer's message [QR-06] [QR-07]", () => {
  it("text: the LID is the stable identity, the phone is only data, and the chat to answer in is kept [CAN-13]", () => {
    const result = normalize(qrText("Hola, ¿tenéis hueco mañana?", { id: "3EB0AAAA" }));
    expect(result).toMatchObject({
      kind: "inbound",
      jid: QR_TEST.customer.lid,
      media: null,
      event: {
        kind: "inbound_message",
        externalId: "3EB0AAAA",
        contentType: "text",
        text: "Hola, ¿tenéis hueco mañana?",
        sender: { externalIds: [QR_TEST.customer.lid, QR_TEST.customer.digits], phone: QR_TEST.customer.digits, displayName: QR_TEST.customer.name },
        metadata: { [QR_JID_METADATA_KEY]: QR_TEST.customer.lid },
      },
    });
    if (result.kind === "inbound") expect(result.event.sentAt.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(normalize(qrLongText("Un texto con enlace https://example.com"))).toMatchObject({ kind: "inbound", event: { contentType: "text", text: "Un texto con enlace https://example.com" } });
  });

  it("a chat known only by the phone-number address, or only by the LID, still has one identity", () => {
    expect(normalize(qrText("Hola", { remoteJid: QR_TEST.customer.pn, remoteJidAlt: null }))).toMatchObject({ kind: "inbound", jid: QR_TEST.customer.pn, event: { sender: { externalIds: [QR_TEST.customer.digits], phone: QR_TEST.customer.digits } } });
    expect(normalize(qrText("Hola", { remoteJidAlt: null }))).toMatchObject({ kind: "inbound", event: { sender: { externalIds: [QR_TEST.customer.lid], phone: null } } });
    // The library's 64-bit seconds and a missing name are fine too.
    expect(normalize(qrText("Hola", { timestamp: { toNumber: () => QR_TEST.now }, pushName: null }))).toMatchObject({ kind: "inbound", event: { sender: { displayName: null } } });
  });

  it("a voice note, a photo and a document come with what their download needs, and are stored as pending", () => {
    expect(normalize(qrVoice())).toMatchObject({ kind: "inbound", event: { contentType: "audio", text: null, media: { mimeType: "audio/ogg; codecs=opus", size: 9_210, downloadStatus: "pending" } }, media: { kind: "audio", fileLength: 9_210, directPath: expect.stringMatching(/^\/v\//) } });
    const photo = normalize(qrImage("Así lo quiero"));
    expect(photo).toMatchObject({ kind: "inbound", event: { contentType: "image", text: "Así lo quiero" }, media: { kind: "image", mimeType: "image/jpeg", fileLength: 98_000 } });
    if (photo.kind === "inbound") expect(photo.media?.mediaKey).toBeInstanceOf(Uint8Array);
    // A document with its caption comes wrapped.
    expect(normalize(qrDocument())).toMatchObject({ kind: "inbound", event: { contentType: "document", text: "El presupuesto", media: { fileName: "presupuesto.pdf" } }, media: { kind: "document", mimeType: "application/pdf", fileName: "presupuesto.pdf" } });
    // The stored message never carries the key that decrypts the file.
    expect(JSON.stringify(normalize(qrVoice()).kind === "inbound" ? (normalize(qrVoice()) as { event: unknown }).event : null)).not.toMatch(/mediaKey|directPath/);
  });

  it("a type the app does not read shows as «no admitido» and is never answered", () => {
    for (const message of [{ videoMessage: { mimetype: "video/mp4" } }, { stickerMessage: {} }, { locationMessage: { degreesLatitude: 40.4 } }, { contactMessage: { displayName: "Luis" } }, { pollCreationMessageV3: { name: "¿Cuándo?" } }]) {
      expect(normalize(qrMessage(message))).toMatchObject({ kind: "inbound", media: null, event: { contentType: "unsupported", text: UNSUPPORTED_TEXT, noReply: true } });
    }
  });

  it("a reaction goes on the message it reacts to, never as a new message", () => {
    expect(normalize(qrMessage({ reactionMessage: { key: { id: "3EB0NUESTRO", fromMe: true }, text: "👍" } }))).toMatchObject({ kind: "inbound", event: { reaction: { targetExternalId: "3EB0NUESTRO", emoji: "👍" }, noReply: true } });
    expect(normalize(qrMessage({ reactionMessage: { key: { id: "3EB0NUESTRO" }, text: "" } }))).toMatchObject({ kind: "inbound", event: { reaction: { targetExternalId: "3EB0NUESTRO", emoji: null } } });
  });
});

describe("what is never read [QR-06]", () => {
  it("groups, statuses, lists and channels", () => {
    for (const remoteJid of ["120363041234567890@g.us", "status@broadcast", "1234567890@broadcast", "120363099999999999@newsletter"]) {
      expect(normalize(qrText("Hola a todos", { remoteJid, remoteJidAlt: null }))).toEqual({ kind: "ignored", reason: "not_a_person" });
    }
    // A message that names who wrote it is a group's, whatever its address looks like.
    expect(normalize(qrText("Hola", { participant: QR_TEST.customer.lid }))).toEqual({ kind: "ignored", reason: "not_a_person" });
  });

  it("the account's own «mensaje a ti mismo» chat, in either of its addresses", () => {
    expect(normalize(qrText("Nota para mí", { remoteJid: "34600111222@s.whatsapp.net", remoteJidAlt: null, fromMe: true }))).toEqual({ kind: "ignored", reason: "own_chat" });
    expect(normalize(qrText("Nota para mí", { remoteJid: "200300400500600@lid", remoteJidAlt: "34600111222@s.whatsapp.net" }))).toEqual({ kind: "ignored", reason: "own_chat" });
  });

  it("what was sent before the number was linked: history is never a new message", () => {
    expect(normalize(qrText("Mensaje de la semana pasada", { timestamp: QR_TEST.now - 7 * 86_400 }))).toEqual({ kind: "ignored", reason: "old" });
    // Within the margin of the clocks it still counts; without a link time nothing is «old».
    expect(normalize(qrText("Justo al vincular", { timestamp: QR_TEST.now - 3_600 - 30 })).kind).toBe("inbound");
    expect(normalize(qrText("Viejo", { timestamp: QR_TEST.now - 7 * 86_400 }), { linkedAt: null }).kind).toBe("inbound");
  });

  it("the protocol's own traffic and empty messages", () => {
    for (const message of [null, {}, { protocolMessage: { type: 0, key: { id: "x" } } }, { senderKeyDistributionMessage: { groupId: "g" } }, { messageContextInfo: {} }, { pollUpdateMessage: {} }, { conversation: "   " }, { editedMessage: { message: { protocolMessage: {} } } }]) {
      expect(normalize(qrMessage(message)).kind).toBe("ignored");
    }
    expect(normalize({ key: { remoteJid: QR_TEST.customer.lid }, message: { conversation: "sin id" } })).toEqual({ kind: "ignored", reason: "empty" });
    expect(normalize({ message: { conversation: "sin clave" } })).toEqual({ kind: "ignored", reason: "empty" });
  });
});

describe("what the business writes from its own phone [QR-09]", () => {
  it("is an echo for the customer's conversation, by the same identities", () => {
    const result = normalize(qrText("Te espero a las 10.", { fromMe: true, id: "3EB0MOVIL" }));
    expect(result).toMatchObject({
      kind: "echo",
      jid: QR_TEST.customer.lid,
      echo: { externalIds: ["3EB0MOVIL"], recipient: { externalIds: [QR_TEST.customer.lid, QR_TEST.customer.digits], phone: QR_TEST.customer.digits }, contentType: "text", text: "Te espero a las 10." },
    });
    // The customer's name never comes from a message the business wrote.
    if (result.kind === "echo") expect(result.echo.recipient.displayName).toBeUndefined();
    expect(PHONE_SENDER_NAME).toBe("Desde el móvil");
    expect(normalize(qrImage("La foto del corte", { fromMe: true }))).toMatchObject({ kind: "echo", echo: { contentType: "image", text: "La foto del corte", media: { downloadStatus: "pending" } }, media: { kind: "image" } });
  });

  it("its reactions and what cannot be shown are not worth pausing the AI for", () => {
    expect(normalize(qrMessage({ reactionMessage: { key: { id: "3EB0X" }, text: "❤️" } }, { fromMe: true })).kind).toBe("ignored");
    expect(normalize(qrMessage({ stickerMessage: {} }, { fromMe: true })).kind).toBe("ignored");
  });
});

describe("statuses of what the app sent [QR-08]", () => {
  it("only delivered, read and failed say something new", () => {
    expect([0, 1, 2, 3, 4, 5, null, undefined, 9].map((status) => qrDeliveryStatus(status))).toEqual(["failed", null, null, "delivered", "read", "read", null, null, null]);
  });
});
