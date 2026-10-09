// What each channel type can do ([CAN-14]): the inbox shows templates only in WhatsApp, drafts in email, and so on.
// These defaults describe the type; an adapter may narrow them from the channel's settings (the web chat, [WEB-07]).
import "server-only";
import type { ChannelType } from "@/lib/enums";
import { readWebchatConfig } from "@/lib/webchat-config";
import { whatsappViaOf } from "@/lib/whatsapp-via";
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

/**
 * A number linked by QR code is not on the official API: no templates, no 24 h window and nothing to estimate a cost
 * from ([WA-55]). Everything else WhatsApp can do stays.
 */
export const WHATSAPP_QR_CAPABILITIES: ChannelCapabilities = { ...DEFAULT_CAPABILITIES.whatsapp, templates: false, window24h: false };

/** Capabilities of a channel without needing its adapter (list screens, the inbox). */
export function defaultCapabilitiesOf(channel: Pick<ChannelRecord, "type" | "config"> & { connectionMode?: string | null }): ChannelCapabilities {
  if (channel.type === "webchat") return webchatCapabilities(channel);
  return whatsappViaOf(channel) === "qr" ? WHATSAPP_QR_CAPABILITIES : DEFAULT_CAPABILITIES[channel.type];
}
