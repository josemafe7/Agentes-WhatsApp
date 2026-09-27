// What each channel type can do ([CAN-14]): the inbox shows templates only in WhatsApp, drafts in email, and so on.
// These defaults describe the type; an adapter may narrow them from the channel's settings (the web chat, [WEB-07]).
import "server-only";
import type { ChannelType } from "@/lib/enums";
import { readWebchatConfig } from "@/lib/webchat-config";
import type { ChannelCapabilities, ChannelRecord } from "./types";

const NONE: ChannelCapabilities = {
  audio: false,
  images: false,
  documents: false,
  templates: false,
  window24h: false,
  typing: false,
  readReceipts: false,
  html: false,
  drafts: false,
};

const EMAIL: ChannelCapabilities = { ...NONE, audio: true, images: true, documents: true, html: true, drafts: true };

export const DEFAULT_CAPABILITIES: Record<ChannelType, ChannelCapabilities> = {
  whatsapp: { ...NONE, audio: true, images: true, documents: true, templates: true, window24h: true, typing: true, readReceipts: true },
  email_gmail: EMAIL,
  email_outlook: EMAIL,
  email_imap: EMAIL,
  webchat: NONE,
  telegram: { ...NONE, audio: true, images: true, typing: true },
};

/** The web chat offers voice notes and images only when they are switched on ([WEB-07]). */
export function webchatCapabilities(channel: Pick<ChannelRecord, "config">): ChannelCapabilities {
  const config = readWebchatConfig(channel.config);
  return { ...NONE, audio: config.voiceEnabled, images: config.imagesEnabled };
}

/** Capabilities of a channel without needing its adapter (list screens, the inbox). */
export function defaultCapabilitiesOf(channel: Pick<ChannelRecord, "type" | "config">): ChannelCapabilities {
  return channel.type === "webchat" ? webchatCapabilities(channel) : DEFAULT_CAPABILITIES[channel.type];
}
