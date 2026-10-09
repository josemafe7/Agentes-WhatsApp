// The QR code wizard (docs/pantallas.md «Asistente de WhatsApp · Código QR»): three steps in one address. A number whose
// session was closed is linked again through the same wizard, with its channel in the address (?canal=…). Pure.

export const QR_WIZARD_PATH = "/canales/nuevo/whatsapp-qr";

export const QR_WIZARD_STEPS = [
  { id: "aviso", label: "Aviso" },
  { id: "vincular", label: "Vincular" },
  { id: "listo", label: "Listo" },
] as const;
export type QrWizardStep = (typeof QR_WIZARD_STEPS)[number]["id"];

/** The guide of this way inside the app ([AJU-17]). */
export const WHATSAPP_QR_GUIDE_HREF = "/ayuda/whatsapp-qr";

/** How often the wizard asks for the code while it waits: WhatsApp renews it every 20 seconds or so. */
export const QR_POLL_INTERVAL_MS = 2_000;

/** Address of the wizard to link again the number of a channel. */
export function qrWizardHref(channelId: string): string {
  return `${QR_WIZARD_PATH}?${new URLSearchParams({ canal: channelId }).toString()}`;
}
