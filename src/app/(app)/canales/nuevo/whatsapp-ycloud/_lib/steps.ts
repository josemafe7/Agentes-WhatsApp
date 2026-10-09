// The YCloud wizard (docs/pantallas.md «Asistente de WhatsApp · YCloud»): two steps in one address. A number that was
// disconnected comes back through the same wizard, with its channel in the address (?canal=…). Pure.

export const YC_WIZARD_PATH = "/canales/nuevo/whatsapp-ycloud";

export const YC_WIZARD_STEPS = [
  { id: "conectar", label: "Conectar" },
  { id: "probar", label: "Probar" },
] as const;
export type YCloudWizardStep = (typeof YC_WIZARD_STEPS)[number]["id"];

/** The guide of this way inside the app ([AJU-17]). */
export const YCLOUD_GUIDE_HREF = "/ayuda/whatsapp-ycloud";

// YCloud's own pages (docs/integracion-ycloud.md «Fuentes»): the console and how the number is added there.
export const YCLOUD_CONSOLE_LINK = "https://www.ycloud.com/console/";
export const YCLOUD_COEXISTENCE_DOCS_LINK = "https://docs.ycloud.com/en/documentation/channels/whatsapp-accounts-management/coexistence/onboard-whatsapp-business-app";
export const YCLOUD_API_KEY_DOCS_LINK = "https://docs.ycloud.com/en/documentation/developer/manage-api-keys";

/** Address of the wizard to connect again the number of a channel. */
export function ycloudWizardHref(channelId: string): string {
  return `${YC_WIZARD_PATH}?${new URLSearchParams({ canal: channelId }).toString()}`;
}
