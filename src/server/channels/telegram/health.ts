// The Telegram panel's traffic lights ([TG-08], [CAN-15], docs/integracion-telegram.md «Conectar un bot»): two Bot API
// calls (getMe and getWebhookInfo) plus what the app already knows (how the channel receives and its last message).
// Each light is green, amber, red or informative, with a Spanish explanation; Telegram's own note about a failed
// delivery (English) follows ours as data.
import "server-only";
import type { ChannelHealth } from "@/db/schema";
import type { TelegramBot, TelegramWebhookInfo } from "@/lib/telegram/schemas";
import { isTelegramApiError } from "@/lib/telegram/errors";
import type { ChannelRecord } from "../types";
import { readTelegramConfig, readTelegramSecrets, telegramClientFor, telegramWebhookUrl, type TelegramDeps, type TelegramReceiveMode } from "./config";
import { telegramReceiveModeFor, type TelegramBotIdentity } from "./connect";

type Check = ChannelHealth["checks"][number];
type CheckStatus = Check["status"];

/** Spanish names of the lights, in the panel's order. */
export const TELEGRAM_HEALTH_LABELS = {
  token: "Token",
  receiving: "Recepción",
  last_message: "Último mensaje",
} as const;
export type TelegramHealthKey = keyof typeof TELEGRAM_HEALTH_LABELS;

/** These make the channel unusable: its status becomes «error» and owner and admins are told ([CAN-15]). */
const BLOCKING: ReadonlySet<TelegramHealthKey> = new Set(["token", "receiving"]);
/** A delivery Telegram could not make this recently still shows in amber. */
const RECENT_WEBHOOK_ERROR_MS = 24 * 60 * 60_000;
const MAX_NOTE = 200;

export type TelegramHealthReport = {
  health: ChannelHealth;
  /** The bot as Telegram describes it now (its name or user name may have changed), or null when it could not be read. */
  bot: TelegramBotIdentity | null;
  /** The channel cannot work: its status becomes «error». */
  blocking: boolean;
};

const check = (key: TelegramHealthKey, status: CheckStatus, detail: string): Check => ({ key, status, detail });
const reason = (error: unknown) => (isTelegramApiError(error) ? error.userMessage : "error inesperado");

function tokenCheck(me: PromiseSettledResult<TelegramBot>): Check {
  if (me.status === "fulfilled") return check("token", "ok", `Bot @${me.value.username} conectado.`);
  const error: unknown = me.reason;
  if (isTelegramApiError(error) && !error.retryable) return check("token", "error", `${error.userMessage} ${error.action}`);
  return check("token", "warn", `No se ha podido comprobar el token: ${reason(error)}`);
}

function webhookCheck(info: TelegramWebhookInfo, expected: string, now: Date): Check {
  if (!info.url) return check("receiving", "error", "Telegram no tiene la dirección de avisos de este canal: no llegan mensajes. Pulsa «Revalidar».");
  if (info.url !== expected) return check("receiving", "error", "El bot envía sus avisos a otra dirección (otra instalación o herramienta): aquí no llegan mensajes. Pulsa «Revalidar» para recuperarlo.");
  const failedAt = info.last_error_date ? new Date(info.last_error_date * 1_000) : null;
  if (failedAt && now.getTime() - failedAt.getTime() <= RECENT_WEBHOOK_ERROR_MS) {
    const note = info.last_error_message?.trim().slice(0, MAX_NOTE);
    return check("receiving", "warn", `Telegram no pudo entregar un aviso el ${failedAt.toISOString()}; lo reintenta solo.${note ? ` Nota de Telegram: ${note}` : ""}`);
  }
  return check("receiving", "ok", "Telegram avisa a la app en cuanto llega un mensaje.");
}

function pollingCheck(info: TelegramWebhookInfo, publicNow: boolean): Check {
  // With a webhook set anywhere, asking for updates answers 409: nothing would arrive.
  if (info.url) return check("receiving", "error", "El bot envía sus avisos a otra dirección (otra instalación o herramienta): aquí no llegan mensajes. Pulsa «Revalidar» para recuperarlo.");
  if (publicNow) return check("receiving", "warn", "La app ya tiene una dirección pública: pulsa «Revalidar» para que Telegram le avise al momento.");
  return check("receiving", "ok", "Modo local: la app no tiene dirección pública, así que pregunta a Telegram por los mensajes nuevos cada pocos segundos.");
}

function receivingCheck(mode: TelegramReceiveMode, info: PromiseSettledResult<TelegramWebhookInfo>, channelId: string, now: Date): Check {
  if (info.status === "rejected") return check("receiving", "warn", `No se ha podido comprobar cómo recibe el bot: ${reason(info.reason)}`);
  return mode === "webhook" ? webhookCheck(info.value, telegramWebhookUrl(channelId), now) : pollingCheck(info.value, telegramReceiveModeFor(channelId) === "webhook");
}

function lastMessageCheck(lastInboundAt: Date | null): Check {
  return lastInboundAt
    ? check("last_message", "ok", `Último mensaje recibido el ${lastInboundAt.toISOString()}.`)
    : check("last_message", "off", "Aún no ha llegado ningún mensaje.");
}

export async function checkTelegramHealth(channel: ChannelRecord, deps: TelegramDeps = {}): Promise<TelegramHealthReport> {
  const now = deps.now?.() ?? new Date();
  const checkedAt = now.toISOString();
  const secrets = readTelegramSecrets(channel);
  if (!secrets) {
    const detail = "Falta el token de este bot. Vuelve a conectarlo.";
    return { health: { checkedAt, checks: [check("token", "error", detail)], error: detail }, bot: null, blocking: true };
  }
  const client = telegramClientFor(channel, deps, secrets);
  const [me, info] = await Promise.allSettled([client.getMe(), client.getWebhookInfo()]);
  const mode = readTelegramConfig(channel.config).receiveMode ?? telegramReceiveModeFor(channel.id);
  const checks = [tokenCheck(me), receivingCheck(mode, info, channel.id, now), lastMessageCheck(channel.lastInboundAt)];
  const failing = checks.find((item) => item.status === "error" && BLOCKING.has(item.key as TelegramHealthKey));
  return {
    health: { checkedAt, checks, ...(failing ? { error: failing.detail } : {}) },
    bot: me.status === "fulfilled" ? { botId: me.value.id, botUsername: me.value.username, botName: me.value.first_name?.trim() || null } : null,
    blocking: failing !== undefined,
  };
}
