// What the Telegram panel shows, worded in Spanish ([TG-08]): the traffic lights in their order, from the bot's last
// check. Server side: the light names come from the health check itself.
import type { StatusLightStatus } from "@/components/status-light";
import type { ChannelHealth } from "@/db/schema";
import { formatDateTime, formatRelative } from "@/lib/format";
import { TELEGRAM_HEALTH_LABELS, type TelegramHealthKey } from "@/server/channels/telegram/health";

export type TelegramPanelLight = { key: TelegramHealthKey; label: string; status: StatusLightStatus; detail: string };

const NOT_CHECKED = "Todavía no se ha comprobado. Se revisa cada 6 horas o al pulsar «Revalidar».";

/** «telegram»: a bot with its token; «disconnected»: it was erased ([TG-04]); «demo»: never talks to Telegram. */
export type TelegramHealthMode = "telegram" | "disconnected" | "demo";

const UNCHECKED: Record<Exclude<TelegramHealthMode, "telegram">, { light: string; note: string }> = {
  disconnected: { light: "Bot desconectado: no se comprueba con Telegram.", note: "Bot desconectado: no se revisa con Telegram." },
  demo: { light: "Canal de demostración: no se comprueba con Telegram.", note: "Canal de demostración: no se revisa con Telegram." },
};

/**
 * Every light of the bot, in the panel's order, from its last check. «Último mensaje» is the channel's own, not the one
 * of the last check; a disconnected or demo bot shows none of an old check.
 */
export function telegramLights(
  health: ChannelHealth | null,
  context: { lastInboundAt: Date | null; timezone: string; now: Date; mode: TelegramHealthMode },
): TelegramPanelLight[] {
  const keys = Object.keys(TELEGRAM_HEALTH_LABELS) as TelegramHealthKey[];
  return keys.map((key) => {
    const label = TELEGRAM_HEALTH_LABELS[key];
    if (key === "last_message") {
      const at = context.lastInboundAt;
      return { key, label, status: "off", detail: at ? `${formatDateTime(at, context.timezone)} (${formatRelative(at, context.timezone, context.now)})` : "Todavía no ha llegado ningún mensaje." };
    }
    if (context.mode !== "telegram") return { key, label, status: "off", detail: UNCHECKED[context.mode].light };
    const check = health?.checks.find((item) => item.key === key);
    return check ? { key, label, status: check.status, detail: check.detail ?? "" } : { key, label, status: "off", detail: NOT_CHECKED };
  });
}

/** The line under the lights: when the bot was last checked and how often, or why it is not checked. */
export function telegramReviewNote(context: { mode: TelegramHealthMode; lastHealthAt: Date | null; timezone: string }): string {
  if (context.mode !== "telegram") return UNCHECKED[context.mode].note;
  const last = context.lastHealthAt ? `Última revisión: ${formatDateTime(context.lastHealthAt, context.timezone)}.` : "Todavía no se ha revisado con Telegram.";
  return `${last} Se revisa sola cada 6 horas; si algo empeora, se avisa al propietario y a los administradores.`;
}
