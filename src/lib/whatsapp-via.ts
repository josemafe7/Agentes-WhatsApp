// The three ways a WhatsApp number is connected ([WA-53], [WA-54], decision 0026), from the channel's
// `connection_mode`: Meta's Cloud API with the business's own app (`manual`; `embedded_signup` stays prepared), YCloud
// (the official API through a Meta partner, with coexistence) or a QR code with Baileys (unofficial). Pure: shared by
// the server and the screens.
import type { ChannelType } from "./enums";

export const WHATSAPP_VIAS = ["meta", "ycloud", "qr"] as const;
export type WhatsAppVia = (typeof WHATSAPP_VIAS)[number];

/** How this channel's number is connected; null for a channel that is not WhatsApp. */
export function whatsappViaOf(channel: { type: ChannelType; connectionMode?: string | null }): WhatsAppVia | null {
  if (channel.type !== "whatsapp") return null;
  if (channel.connectionMode === "ycloud") return "ycloud";
  return channel.connectionMode === "qr" ? "qr" : "meta";
}

/**
 * The official API, Meta's own or through YCloud: only there do the 24 h window, the templates and the estimated cost
 * exist ([WA-55]). A number linked by QR code has none of them.
 */
export function isOfficialWhatsApp(channel: { type: ChannelType; connectionMode?: string | null }): boolean {
  const via = whatsappViaOf(channel);
  return via === "meta" || via === "ycloud";
}

/** Spanish name of each way, as Añadir canal and the panels show it next to «WhatsApp» ([WA-53], [WA-54]). */
export const WHATSAPP_VIA_LABELS: Record<WhatsAppVia, string> = {
  meta: "API oficial de Meta",
  ycloud: "YCloud · coexistencia",
  qr: "Código QR · no oficial",
};

/** The short one, for the line of a channel's card. */
export const WHATSAPP_VIA_SHORT_LABELS: Record<WhatsAppVia, string> = {
  meta: "API de Meta",
  ycloud: "YCloud",
  qr: "Código QR",
};
