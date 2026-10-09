// The Telegram wizard (docs/pantallas.md «Asistente de Telegram»): two steps in one address. A bot that was
// disconnected comes back through the same wizard, with its channel in the address (?canal=…). Pure.

export const TG_WIZARD_PATH = "/canales/nuevo/telegram";

export const TG_WIZARD_STEPS = [
  { id: "conectar", label: "Conectar" },
  { id: "probar", label: "Probar" },
] as const;
export type TelegramWizardStep = (typeof TG_WIZARD_STEPS)[number]["id"];

/** The guide of Telegram inside the app ([AJU-17]). */
export const TELEGRAM_GUIDE_HREF = "/ayuda/telegram";

/** Where the people who create bots talk to Telegram's own bot. */
export const BOTFATHER_LINK = "https://t.me/BotFather";

/** Address of the wizard to connect again the bot of a channel. */
export function telegramWizardHref(channelId: string): string {
  return `${TG_WIZARD_PATH}?${new URLSearchParams({ canal: channelId }).toString()}`;
}
