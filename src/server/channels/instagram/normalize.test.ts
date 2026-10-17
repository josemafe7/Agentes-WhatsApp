import { describe, expect, it } from "vitest";
import {
  attachmentMessage,
  customerMessage,
  deletedMessage,
  echoMessage,
  FAKE_INSTAGRAM_CDN,
  IG_TEST,
  instagramWebhook,
  readEvent,
  reactionEvent,
  T_MS,
  textMessage,
} from "@/test/fixtures/instagram";
import type { InboundMessageEvent } from "../types";
import { UNSUPPORTED_TEXT } from "../whatsapp/normalize";
import { instagramPartId, instagramPartIds, normalizeInstagramWebhook } from "./normalize";

const normalize = (messaging: unknown[], accountId: string = IG_TEST.accountId) => {
  const result = normalizeInstagramWebhook(instagramWebhook(messaging), accountId);
  if (!result) throw new Error("No es un aviso de Instagram");
  return result;
};
const inbound = (messaging: unknown[]) => normalize(messaging).events as InboundMessageEvent[];

describe("normalizing Instagram webhooks [IG-03] [CAN-13]", () => {
  it("a customer's text: its mid, the customer's IGSID (never a phone) and Meta's time in milliseconds [CAN-13]", () => {
    const [event] = inbound([textMessage("Hola, ¿tenéis cita el viernes?", { mid: IG_TEST.mid })]);
    expect(event).toMatchObject({
      kind: "inbound_message",
      externalId: IG_TEST.mid,
      sender: { externalIds: [IG_TEST.customer.id] },
      contentType: "text",
      text: "Hola, ¿tenéis cita el viernes?",
    });
    expect(event.sender.phone).toBeUndefined();
    expect(event.sentAt.toISOString()).toBe(new Date(T_MS).toISOString());
  });

  it("an image, a voice note and a PDF become messages whose file is downloaded right after [IG-03]", () => {
    const image = normalize([attachmentMessage("image", `${FAKE_INSTAGRAM_CDN}/foto.jpg`, { mid: "m-img" })]);
    expect(image.events[0]).toMatchObject({ externalId: "m-img", contentType: "image", text: null, media: { externalMediaId: `${FAKE_INSTAGRAM_CDN}/foto.jpg`, downloadStatus: "pending" } });
    expect(image.downloads).toEqual([{ externalId: "m-img", url: `${FAKE_INSTAGRAM_CDN}/foto.jpg`, contentType: "image" }]);
    expect(normalize([attachmentMessage("audio", undefined, { mid: "m-aud" })]).downloads[0]).toMatchObject({ externalId: "m-aud", contentType: "audio" });
    expect(normalize([attachmentMessage("file", undefined, { mid: "m-pdf" })]).events[0]).toMatchObject({ contentType: "document" });
  });

  it("several files of one message are separate messages: mid, mid#1, mid#2 [IG-03] [CAN-11]", () => {
    const result = normalize([
      customerMessage(
        { attachments: [{ type: "image", payload: { url: `${FAKE_INSTAGRAM_CDN}/1.jpg` } }, { type: "image", payload: { url: `${FAKE_INSTAGRAM_CDN}/2.jpg` } }] },
        { mid: "m-multi" },
      ),
    ]);
    expect(result.events.map((event) => (event as InboundMessageEvent).externalId)).toEqual(["m-multi", "m-multi#1"]);
    expect(result.downloads.map((download) => download.externalId)).toEqual(["m-multi", "m-multi#1"]);
    expect(instagramPartIds("m")).toContain(instagramPartId("m", 1));
  });

  it("videos, shared posts, reels, stories and unknown types are one notice «Tipo de mensaje no admitido» never answered [IG-03]", () => {
    for (const type of ["video", "share", "ig_post", "reel", "ig_reel", "story", "ig_story", "media", "algo_nuevo"]) {
      const result = normalize([attachmentMessage(type, `${FAKE_INSTAGRAM_CDN}/x.mp4`, { mid: `m-${type}` })]);
      expect(result.events, type).toHaveLength(1);
      expect(result.events[0], type).toMatchObject({ externalId: `m-${type}`, contentType: "unsupported", text: UNSUPPORTED_TEXT, noReply: true, metadata: { unsupported: { type } } });
      expect(result.downloads, type).toHaveLength(0);
    }
    expect(inbound([customerMessage({ is_unsupported: true }, { mid: "m-uns" })])[0]).toMatchObject({ contentType: "unsupported", noReply: true });
  });

  it("of a story mention nothing but the notice is kept: never its address [IG-03]", () => {
    const url = `${FAKE_INSTAGRAM_CDN}/historia-privada.mp4`;
    const result = normalize([attachmentMessage("story_mention", url)]);
    expect(result.events[0]).toMatchObject({ contentType: "unsupported", text: UNSUPPORTED_TEXT });
    expect(JSON.stringify(result)).not.toContain(url);
  });

  it("text plus something not admitted: the text and one notice, each its own message [IG-03]", () => {
    const events = inbound([customerMessage({ text: "Mira", attachments: [{ type: "video", payload: { url: `${FAKE_INSTAGRAM_CDN}/v.mp4` } }, { type: "reel", payload: { url: `${FAKE_INSTAGRAM_CDN}/r.mp4` } }] }, { mid: "m-mix" })]);
    expect(events.map((event) => [event.externalId, event.contentType])).toEqual([
      ["m-mix", "text"],
      ["m-mix#1", "unsupported"],
    ]);
  });

  it("a quick reply is read as the customer's text [IG-03]", () => {
    expect(inbound([customerMessage({ text: "Sí, el viernes", quick_reply: { payload: "VIERNES" } })])[0]).toMatchObject({ contentType: "text", text: "Sí, el viernes" });
  });

  it("an answer to a story is its text, marked, without the story's address [IG-03]", () => {
    const url = `${FAKE_INSTAGRAM_CDN}/historia.jpg`;
    const [event] = inbound([customerMessage({ text: "¡Qué bonito!", reply_to: { story: { url, id: "1790" } } })]);
    expect(event).toMatchObject({ contentType: "text", text: "¡Qué bonito!", metadata: { storyReply: true } });
    expect(JSON.stringify(event)).not.toContain(url);
  });

  it("a reaction goes on the message it reacts to; unreact removes it [WA-37]", () => {
    expect(inbound([reactionEvent("m-target", "❤️")])[0]).toMatchObject({ reaction: { targetExternalId: "m-target", emoji: "❤️" }, sender: { externalIds: [IG_TEST.customer.id] } });
    expect(inbound([reactionEvent("m-target", null)])[0]).toMatchObject({ reaction: { targetExternalId: "m-target", emoji: null } });
  });

  it("«seen» marks our message as read", () => {
    expect(normalize([readEvent("m-ours")]).events[0]).toMatchObject({ kind: "status_update", externalId: "m-ours", status: "read" });
  });

  it("an echo is not ingested as a customer's message: it is handled at once, inside the notice, with the customer it went to [IG-06]", () => {
    const result = normalize([echoMessage({ text: "Sí, a las 17:00" }, { mid: "m-echo" })]);
    expect(result.events).toHaveLength(0);
    expect(result.echoes).toEqual([{ userId: IG_TEST.customer.id, mid: "m-echo", text: "Sí, a las 17:00", hasAttachment: false, sentAt: new Date(T_MS) }]);
    const file = normalize([echoMessage({ attachments: [{ type: "image", payload: { url: `${FAKE_INSTAGRAM_CDN}/x.jpg` } }] })]);
    expect(file.echoes[0]).toMatchObject({ text: null, hasAttachment: true });
  });

  it("a message of the account to itself is ignored [IG-06]", () => {
    const result = normalize([echoMessage({ text: "prueba", is_self: true }, { to: IG_TEST.accountId })]);
    expect(result).toMatchObject({ events: [], echoes: [], deletions: [] });
  });

  it("a message the customer deleted is a deletion, not a message [IG-07]", () => {
    const result = normalize([deletedMessage("m-borrado")]);
    expect(result.events).toHaveLength(0);
    expect(result.deletions).toEqual(["m-borrado"]);
  });

  it("only this account's entries count; one bad item never drops the others [IG-02]", () => {
    const other = normalizeInstagramWebhook(instagramWebhook([textMessage("Hola")], IG_TEST.otherAccount.accountId), IG_TEST.accountId);
    expect(other).toMatchObject({ forAccount: false, events: [] });
    const result = normalize([{ sender: "roto" }, "nada", textMessage("Sigo aquí", { mid: "m-ok" })]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ externalId: "m-ok" });
    expect(normalizeInstagramWebhook({ object: "page", entry: [] }, IG_TEST.accountId)).toBeNull();
    expect(normalizeInstagramWebhook("no", IG_TEST.accountId)).toBeNull();
  });
});
