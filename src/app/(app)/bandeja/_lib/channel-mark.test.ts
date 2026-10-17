// Which channel each conversation belongs to, in words ([BAN-17]): pure.
import { describe, expect, it } from "vitest";
import { channelMarkParts, channelMarkText } from "./channel-mark";

describe("the channel of a conversation at a glance [BAN-17]", () => {
  it("says the channel's type and its name: «Instagram · @peluqueria», «WhatsApp · Recepción»", () => {
    expect(channelMarkText("instagram", "@peluqueria")).toBe("Instagram · @peluqueria");
    expect(channelMarkText("whatsapp", "Recepción")).toBe("WhatsApp · Recepción");
    expect(channelMarkText("webchat", "Chat de la web")).toBe("Chat web · Chat de la web");
    expect(channelMarkParts("telegram", "  Bot de citas ")).toEqual({ type: "Telegram", name: "Bot de citas" });
  });

  it("says the type once when the channel is called like it, whatever the case or accents", () => {
    expect(channelMarkText("instagram", "Instagram")).toBe("Instagram");
    expect(channelMarkText("whatsapp", "whatsapp")).toBe("WhatsApp");
    // «Correo» is the start of «Correo · Gmail».
    expect(channelMarkText("email_gmail", "Correo")).toBe("Correo · Gmail");
    expect(channelMarkParts("email_imap", "correo")).toEqual({ type: "Correo", name: null });
    expect(channelMarkParts("telegram", " ")).toEqual({ type: "Telegram", name: null });
  });

  it("keeps the type apart from the name, so the name can be cut and the type never is", () => {
    const parts = channelMarkParts("instagram", "Instagram de la tienda del centro");
    expect(parts).toEqual({ type: "Instagram", name: "Instagram de la tienda del centro" });
  });
});
