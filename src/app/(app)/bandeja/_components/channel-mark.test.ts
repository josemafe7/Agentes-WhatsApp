// The channel of a conversation in the list, the header and the contact panel ([BAN-17]), rendered: visible text, read once.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChannelMark } from "./contact-avatar";

const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

describe("ChannelMark [BAN-17]", () => {
  it("shows the type and the name as visible text, with no hidden copy for screen readers", () => {
    const html = renderToStaticMarkup(createElement(ChannelMark, { type: "instagram", name: "@peluqueria", variant: "pill" }));
    expect(textOf(html)).toBe("Instagram · @peluqueria");
    expect(html).not.toContain("sr-only");
    // The pill of the list: bordered; only the name is cut, never the type.
    expect(html).toContain("rounded-full border");
    expect(html).toMatch(/<span class="shrink-0">Instagram<\/span><span class="min-w-0 truncate"> · @peluqueria<\/span>/);
  });

  it("says the type once when the channel is called like it", () => {
    expect(textOf(renderToStaticMarkup(createElement(ChannelMark, { type: "instagram", name: "Instagram" })))).toBe("Instagram");
    expect(textOf(renderToStaticMarkup(createElement(ChannelMark, { type: "whatsapp", name: "Recepción" })))).toBe("WhatsApp · Recepción");
  });
});
