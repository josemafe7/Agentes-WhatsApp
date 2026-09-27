import { describe, expect, it } from "vitest";
import { mediaMessage, reactionMessage, templateMessage, textMessage } from "./messages";

describe("message bodies by type [WA-42] (docs/integracion-whatsapp-mensajes.md §11.4)", () => {
  it("text, files by id or link (caption only where allowed), template and reaction", () => {
    expect(textMessage("Hola")).toEqual({ type: "text", text: { body: "Hola", preview_url: false } });
    expect(mediaMessage("image", { id: "1" }, { caption: " Foto " })).toEqual({ type: "image", image: { id: "1", caption: "Foto" } });
    expect(mediaMessage("document", { link: "https://example.com/a.pdf" }, { caption: "Factura", filename: "a.pdf" })).toEqual({
      type: "document",
      document: { link: "https://example.com/a.pdf", caption: "Factura", filename: "a.pdf" },
    });
    expect(mediaMessage("audio", { id: "2" }, { caption: "no", voice: true })).toEqual({ type: "audio", audio: { id: "2", voice: true } });
    expect(mediaMessage("sticker", { id: "3" }, { caption: "no" })).toEqual({ type: "sticker", sticker: { id: "3" } });
    const template = { name: "t", language: { code: "es" }, components: [] };
    expect(templateMessage(template)).toEqual({ type: "template", template });
    expect(reactionMessage("wamid.IN", "👍")).toEqual({ type: "reaction", reaction: { message_id: "wamid.IN", emoji: "👍" } });
  });
});
