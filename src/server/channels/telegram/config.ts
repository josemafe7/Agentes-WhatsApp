// What a Telegram channel stores ([CAN-17], [SEG-01], docs/modelo-de-datos.md «Canales · Telegram»): the bot's token
// and the secret of its webhook, encrypted in `channels.secrets_enc` as { bot_token, webhook_secret }; the bot's public
// identity and how it receives, in `channels.config`. Config writes merge inside a transaction, so the poll and a screen
// never drop each other's keys. Server only.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels } from "@/db/schema";
import { createTelegramClient, isTelegramToken, type TelegramClient } from "@/lib/telegram/client";
import { appUrl } from "@/server/app-url";
import { AppError } from "@/server/errors";
import { encryptChannelSecrets, readChannelSecrets } from "../secrets";
import type { ChannelRecord } from "../types";

/** 1–256 characters of A-Z, a-z, 0-9, _ and - (docs/integracion-telegram.md «Conectar un bot»). */
export const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

const storedSecretsSchema = z.object({
  bot_token: z.string().refine(isTelegramToken),
  webhook_secret: z.string().regex(WEBHOOK_SECRET_PATTERN),
});

export type TelegramSecrets = { botToken: string; webhookSecret: string };

/** The channel's decrypted secrets, or null (none, unreadable after a key change, or incomplete) ([SEG-03]). */
export function readTelegramSecrets(channel: Pick<ChannelRecord, "secretsEnc">): TelegramSecrets | null {
  const stored = readChannelSecrets(channel, storedSecretsSchema);
  return stored ? { botToken: stored.bot_token, webhookSecret: stored.webhook_secret } : null;
}

/** `secrets_enc` for these secrets. */
export function encryptTelegramSecrets(secrets: TelegramSecrets): string {
  return encryptChannelSecrets({ bot_token: secrets.botToken, webhook_secret: secrets.webhookSecret });
}

/** How updates reach the app: Telegram calls our webhook, or (without a public address) the app asks Telegram ([TG-06]). */
export const TELEGRAM_RECEIVE_MODES = ["webhook", "polling"] as const;
export type TelegramReceiveMode = (typeof TELEGRAM_RECEIVE_MODES)[number];

/** Non-secret settings of a Telegram channel in `channels.config` (other keys there are kept as they are). */
export const telegramConfigSchema = z.object({
  /** The bot's numeric id: one channel per bot in the installation ([TG-05]). */
  botId: z.string().max(40).nullish().catch(null),
  /** Without «@»: the bot's link is https://t.me/<botUsername> ([TG-07]). */
  botUsername: z.string().max(100).nullish().catch(null),
  botName: z.string().max(300).nullish().catch(null),
  receiveMode: z.enum(TELEGRAM_RECEIVE_MODES).nullish().catch(null),
  /** Polling: the `offset` of the next getUpdates (last update_id + 1). */
  updateOffset: z.number().int().nullish().catch(null),
  /** Polls failed in a row: at MAX_POLL_FAILURES the channel goes to «error» ([CAN-15]). */
  pollFailures: z.number().int().nonnegative().catch(0).default(0),
  /** If the AI's reply cannot be sent, the conversation goes to a person (read by the reply engine). */
  handoffOnSendFailure: z.boolean().catch(false).default(false),
});
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

export function readTelegramConfig(config: Record<string, unknown> | null | undefined): TelegramConfig {
  const parsed = telegramConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : telegramConfigSchema.parse({});
}

type ChannelColumns = Partial<Omit<typeof channels.$inferInsert, "id" | "config">>;

/**
 * Merges `patch` into the channel's stored config (read and written in one transaction), plus other columns of the
 * channel when `extra` is given. Returns the new settings.
 */
export async function updateTelegramConfig(
  channelId: string,
  patch: Partial<TelegramConfig> | ((current: TelegramConfig) => Partial<TelegramConfig>),
  options: { executor?: Executor; extra?: ChannelColumns | ((current: TelegramConfig) => ChannelColumns) } = {},
): Promise<TelegramConfig> {
  const run = async (tx: Executor) => {
    const [row] = await tx.select({ config: channels.config }).from(channels).where(eq(channels.id, channelId));
    const current = row?.config ?? {};
    const parsed = readTelegramConfig(current);
    const resolved = typeof patch === "function" ? patch(parsed) : patch;
    const extra = typeof options.extra === "function" ? options.extra(parsed) : options.extra;
    const config = { ...current, ...Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined)) };
    await tx.update(channels).set({ ...extra, config, updatedAt: new Date() }).where(eq(channels.id, channelId));
    return readTelegramConfig(config);
  };
  return options.executor ? run(options.executor) : db.transaction(run);
}

/** The channel cannot talk to Telegram: its token is missing or unreadable. */
export class TelegramNotConnectedError extends AppError {
  constructor() {
    super(409, "telegram_not_connected", "Falta el token de este bot de Telegram. Vuelve a conectarlo.");
  }
}

/** What every Telegram call may take for tests: a fake fetch, another base URL, a clock and a sleep. */
export type TelegramDeps = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

/** A Bot API client with the channel's token. Throws TelegramNotConnectedError. */
export function telegramClientFor(
  channel: Pick<ChannelRecord, "secretsEnc">,
  deps: TelegramDeps = {},
  secrets: TelegramSecrets | null = readTelegramSecrets(channel),
): TelegramClient {
  if (!secrets) throw new TelegramNotConnectedError();
  return createTelegramClient({ token: secrets.botToken, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
}

/** Each bot has its own webhook path: the channel is known before the body is read ([TG-02]). */
export const telegramWebhookPath = (channelId: string) => `/api/webhooks/telegram/${channelId}`;

/** Always built from APP_URL (the production domain, never a preview). */
export function telegramWebhookUrl(channelId: string): string {
  return appUrl(telegramWebhookPath(channelId));
}

/** https://t.me/<username>: what customers open (and the QR shows) to write to the bot ([TG-07]). */
export function telegramBotLink(username: string): string {
  return `https://t.me/${encodeURIComponent(username)}`;
}
