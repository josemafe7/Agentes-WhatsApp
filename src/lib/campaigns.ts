// What an envío is made of ([ENV-02]–[ENV-04]): its channels, always tried in this order, and the message of each one.
// Shared by the screens, the server and the database schema.

/** The channels of an envío, always tried in this order ([ENV-03]). */
export const CAMPAIGN_ROUTES = ["whatsapp", "telegram", "email"] as const;
export type CampaignRoute = (typeof CAMPAIGN_ROUTES)[number];

export const CAMPAIGN_ROUTE_NAMES: Record<CampaignRoute, string> = { whatsapp: "WhatsApp", telegram: "Telegram", email: "Correo" };

/** The data a text or a variable of the template may take ([ENV-04]). */
export const CAMPAIGN_FIELDS = [
  { key: "contact.name", placeholder: "nombre", label: "Nombre del contacto" },
  { key: "business.name", placeholder: "negocio", label: "Nombre del negocio" },
] as const;
export type CampaignFieldKey = (typeof CAMPAIGN_FIELDS)[number]["key"];

/** A variable of the template: a datum of the contact or the business, or a fixed text for this envío. */
export type CampaignVariable = { field: CampaignFieldKey } | { text: string };

/** By WhatsApp: an approved marketing template with a baja button, by the number it belongs to. */
export type CampaignWhatsApp = { channelId: string; templateName: string; templateLanguage: string; variables: Record<string, CampaignVariable> };
/** By Telegram: a text and the bot it goes by (with «No quiero publicidad»). */
export type CampaignTelegram = { channelId: string; text: string };
/** By email, through the system mail. */
export type CampaignEmail = { subject: string; body: string };

/** One try by one channel for one contact. */
export type CampaignAttempt = { channel: CampaignRoute; outcome: "sent" | "failed" | "skipped"; reason: string | null; at: string };
