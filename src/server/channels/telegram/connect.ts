// Connecting a bot ([TG-01], [TG-05], [TG-06], docs/integracion-telegram.md «Conectar un bot»): getMe checks the token
// and says who the bot is; then the app either gives Telegram its webhook (with the channel's secret) or, without a
// public HTTPS address, asks for the updates itself. A bot has ONE way of receiving at a time: taking it here takes it
// from wherever it was before, so the screens ask first when it already had another webhook. Nothing is stored here.
import "server-only";
import { createTelegramClient, isTelegramToken, type TelegramClient } from "@/lib/telegram/client";
import { isTelegramApiError } from "@/lib/telegram/errors";
import { isPublicHttpsUrl } from "@/server/app-url";
import { safeErrorMessage } from "@/server/redact";
import { telegramWebhookUrl, type TelegramDeps, type TelegramReceiveMode } from "./config";

export type TelegramBotIdentity = { botId: string; botUsername: string; botName: string | null };

export type TelegramValidation =
  | {
      ok: true;
      bot: TelegramBotIdentity;
      /** The bot already sends its updates somewhere else (only the host: the address may carry a secret). */
      otherWebhookHost: string | null;
    }
  | { ok: false; error: string; action: string | null };

const BAD_FORMAT = "Eso no parece un token de bot. Cópialo entero desde @BotFather: son números, dos puntos y letras.";
const UNEXPECTED = "No se ha podido comprobar el token por un error inesperado.";

function failure(error: unknown): Extract<TelegramValidation, { ok: false }> {
  if (isTelegramApiError(error)) return { ok: false, error: error.userMessage, action: error.action };
  console.error(`[telegram] Validación fallida: ${safeErrorMessage(error)}`);
  return { ok: false, error: UNEXPECTED, action: null };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "otra dirección";
  }
}

/**
 * Checks a token with Telegram and tells whether the bot already has a webhook that is not this channel's (`channelId`
 * null = a new channel: any webhook is someone else's).
 */
export async function validateTelegramToken(token: string, channelId: string | null, deps: TelegramDeps = {}): Promise<TelegramValidation> {
  const trimmed = token.trim();
  if (!isTelegramToken(trimmed)) return { ok: false, error: BAD_FORMAT, action: null };
  try {
    const client = createTelegramClient({ token: trimmed, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
    const me = await client.getMe();
    const webhook = await client.getWebhookInfo();
    const ours = channelId ? telegramWebhookUrl(channelId) : null;
    return {
      ok: true,
      bot: { botId: me.id, botUsername: me.username, botName: me.first_name?.trim() || null },
      otherWebhookHost: webhook.url && webhook.url !== ours ? hostOf(webhook.url) : null,
    };
  } catch (error) {
    return failure(error);
  }
}

/** With a public HTTPS address Telegram calls the app; without one (on this computer) the app asks Telegram ([TG-06]). */
export function telegramReceiveModeFor(channelId: string): TelegramReceiveMode {
  return isPublicHttpsUrl(telegramWebhookUrl(channelId)) ? "webhook" : "polling";
}

/**
 * Makes the bot's updates reach this channel: setWebhook with the channel's secret, or deleteWebhook so getUpdates
 * works (the two are exclusive). Throws TelegramApiError.
 */
export async function activateTelegramReceiving(client: TelegramClient, channelId: string, webhookSecret: string): Promise<TelegramReceiveMode> {
  const mode = telegramReceiveModeFor(channelId);
  if (mode === "webhook") await client.setWebhook({ url: telegramWebhookUrl(channelId), secretToken: webhookSecret });
  else await client.deleteWebhook();
  return mode;
}
