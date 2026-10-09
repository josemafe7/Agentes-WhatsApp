// Telegram channels: connecting a bot, its panel and «Desconectar» ([TG-01], [TG-04]–[TG-08]). The bot's public
// identity goes in the channel's config; its token and the secret of its webhook only in `secrets_enc`, encrypted, and
// never leave the server (owner and admin see the token masked, [PER-07]). A bot is connected once in the installation
// ([TG-05]). Changing things is «Canales: crear, conectar, configurar, desconectar» (owner, admin); seeing the panel,
// «Canales: ver» (also Solo lectura).
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { agents, channels, type ChannelHealth } from "@/db/schema";
import { createTelegramClient } from "@/lib/telegram/client";
import { isTelegramApiError } from "@/lib/telegram/errors";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import {
  encryptTelegramSecrets,
  readTelegramConfig,
  readTelegramSecrets,
  telegramBotLink,
  telegramWebhookUrl,
  updateTelegramConfig,
  type TelegramDeps,
  type TelegramReceiveMode,
} from "@/server/channels/telegram/config";
import { activateTelegramReceiving, telegramReceiveModeFor, validateTelegramToken, type TelegramBotIdentity } from "@/server/channels/telegram/connect";
import { runTelegramHealthCheck } from "@/server/channels/telegram/jobs";
import { cancelTelegramJobs, cancelTelegramPolling, ensureTelegramHealthChecks, ensureTelegramPolling } from "@/server/channels/telegram/schedule";
import type { ChannelRecord } from "@/server/channels/types";
import { maskSecret, randomToken } from "@/server/crypto";
import { ConflictError, NotFoundError, parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

const MAX_NAME = 80;
/** Checks with Telegram per person and minute ([SEG-07]). */
const VALIDATE_LIMIT = 30;
const VALIDATE_WINDOW_MS = 60_000;
/** Telegram only takes a webhook on these ports (docs/integracion-telegram.md «Conectar un bot»). */
const BAD_WEBHOOK_ADDRESS =
  "Telegram no ha aceptado la dirección de la app para sus avisos: tiene que ser https en el puerto 443, 80, 88 u 8443. Revisa APP_URL y pulsa «Revalidar».";

async function enforceValidateLimit(userId: string): Promise<void> {
  const result = await getRateLimiter().hit(`tg:validate:${userId}`, VALIDATE_LIMIT, VALIDATE_WINDOW_MS);
  if (!result.allowed) throw new RateLimitError("Demasiadas comprobaciones con Telegram seguidas. Espera un minuto.");
}

/** A Telegram channel, or NotFoundError. Demo channels never talk to Telegram ([ARR-11]): only read-only views pass `allowDemo`. */
export async function loadTelegramChannel(channelId: unknown, options: { allowDemo?: boolean; executor?: Executor } = {}): Promise<ChannelRecord> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el canal.");
  const [row] = await (options.executor ?? db).select().from(channels).where(eq(channels.id, id.data));
  if (!row || row.type !== "telegram" || (row.isDemo && !options.allowDemo)) throw new NotFoundError("No se ha encontrado el canal de Telegram.");
  return row;
}

/** What the screens show of a bot: never its token. */
export type TelegramBotView = { username: string; name: string | null; link: string };

const botView = (bot: Pick<TelegramBotIdentity, "botUsername" | "botName">): TelegramBotView => ({ username: bot.botUsername, name: bot.botName, link: telegramBotLink(bot.botUsername) });

// ─── Connect ([TG-01], [TG-05], [TG-06]) ────────────────────────────────────────────────────────────────

const botTokenSchema = z.string().trim().min(1, "Pega el token del bot.").max(300, "El token es demasiado largo.");

export const connectTelegramSchema = z
  .object({
    /** Reconnects this channel instead of creating one. */
    channelId: idSchema.optional(),
    name: z.string().trim().min(1, "Escribe el nombre.").max(MAX_NAME, `Como mucho ${MAX_NAME} caracteres.`),
    botToken: botTokenSchema,
    activeAgentId: idSchema.nullable().optional(),
    aiEnabled: z.boolean().default(true),
    /** The person confirmed taking the bot from the address it was sending its updates to ([TG-05]). */
    confirmReplace: z.boolean().default(false),
  })
  .strict();

export type ConnectTelegramResult =
  /** Telegram refused the token: nothing was stored. */
  | { status: "invalid"; error: string; action: string | null }
  /** The bot already sends its updates elsewhere: nothing changed until the person confirms. */
  | { status: "needs_confirmation"; bot: TelegramBotView; otherHost: string }
  /** `warning`: the bot is stored but Telegram could not be told how to deliver; «Revalidar» tries again. */
  | { status: "connected"; channelId: string; bot: TelegramBotView; mode: TelegramReceiveMode; warning: string | null };

/** The bot of another channel of the installation ([TG-05]). */
async function assertBotNotTaken(executor: Executor, botId: string, exceptChannelId: string | null): Promise<void> {
  const rows = await executor
    .select({ id: channels.id, config: channels.config })
    .from(channels)
    .where(and(eq(channels.type, "telegram"), eq(channels.isDemo, false), ...(exceptChannelId ? [ne(channels.id, exceptChannelId)] : [])));
  if (rows.some((row) => readTelegramConfig(row.config).botId === botId)) throw new ConflictError("Este bot ya está conectado en otro canal de la instalación.");
}

async function assertAgentExists(executor: Executor, agentId: string | null | undefined): Promise<void> {
  if (!agentId) return;
  const [agent] = await executor.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new ValidationError(undefined, { activeAgentId: ["Ese agente no existe."] });
}

/**
 * Tells Telegram how this channel receives (its webhook, or none so the poll works) and refreshes its lights. Returns
 * the Spanish reason when Telegram refuses; the channel is then left in «error» with it.
 */
async function activateReceiving(channel: Pick<ChannelRecord, "id">, botToken: string, webhookSecret: string, deps: TelegramDeps): Promise<{ mode: TelegramReceiveMode; warning: string | null }> {
  const expected = telegramReceiveModeFor(channel.id);
  const now = deps.now?.() ?? new Date();
  try {
    const client = createTelegramClient({ token: botToken, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
    const mode = await activateTelegramReceiving(client, channel.id, webhookSecret);
    await updateTelegramConfig(channel.id, { receiveMode: mode, pollFailures: 0 });
    if (mode === "polling") await ensureTelegramPolling(channel.id, { now });
    else await cancelTelegramPolling(channel.id);
    await ensureTelegramHealthChecks(channel.id, { now });
    await runTelegramHealthCheck(channel.id, deps);
    return { mode, warning: null };
  } catch (error) {
    if (!isTelegramApiError(error)) console.error(`[telegram] No se pudo activar la recepción: ${safeErrorMessage(error)}`);
    const warning = !isTelegramApiError(error) ? "No se ha podido avisar a Telegram por un error inesperado. Pulsa «Revalidar»." : error.code === 400 && expected === "webhook" ? BAD_WEBHOOK_ADDRESS : `${error.userMessage} ${error.action}`;
    const health: ChannelHealth = { checkedAt: now.toISOString(), checks: [{ key: "receiving", status: "error", detail: warning }], error: warning };
    await db.update(channels).set({ status: "error", lastHealth: health, lastHealthAt: now, updatedAt: now }).where(eq(channels.id, channel.id));
    return { mode: expected, warning };
  }
}

/**
 * «Conectar»: checks the token with Telegram (nothing from the browser is trusted), stores the channel with its bot
 * and its secrets encrypted, and makes the bot's updates reach it. A refused token stores nothing and says why.
 */
export async function connectTelegramChannel(actor: Actor, input: unknown, deps: TelegramDeps = {}): Promise<ConnectTelegramResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(connectTelegramSchema, input);
  await enforceValidateLimit(actor.userId);
  const existing = data.channelId ? await loadTelegramChannel(data.channelId) : null;
  const validation = await validateTelegramToken(data.botToken, existing?.id ?? null, deps);
  if (!validation.ok) return { status: "invalid", error: validation.error, action: validation.action };
  const { bot } = validation;
  await assertBotNotTaken(db, bot.botId, existing?.id ?? null);
  if (validation.otherWebhookHost && !data.confirmReplace) return { status: "needs_confirmation", bot: botView(bot), otherHost: validation.otherWebhookHost };

  // The webhook's secret is the channel's own: a reconnection keeps it.
  const webhookSecret = readTelegramSecrets(existing ?? { secretsEnc: null })?.webhookSecret ?? randomToken();
  const secretsEnc = encryptTelegramSecrets({ botToken: data.botToken, webhookSecret });
  const now = deps.now?.() ?? new Date();
  const channelId = await db.transaction(async (tx) => {
    await assertBotNotTaken(tx, bot.botId, existing?.id ?? null);
    await assertAgentExists(tx, data.activeAgentId);
    const agent = data.activeAgentId === undefined ? {} : { activeAgentId: data.activeAgentId };
    if (existing) {
      // Another bot in this channel starts asking for updates from the beginning.
      const sameBot = readTelegramConfig(existing.config).botId === bot.botId;
      const config = { ...existing.config, ...bot, ...(sameBot ? {} : { updateOffset: null }) };
      await tx.update(channels).set({ name: data.name, config, secretsEnc, status: "connecting", aiEnabled: data.aiEnabled, ...agent, updatedAt: now }).where(eq(channels.id, existing.id));
      return existing.id;
    }
    const [row] = await tx
      .insert(channels)
      .values({ type: "telegram", name: data.name, status: "connecting", config: { ...bot }, secretsEnc, replyMode: "auto", aiEnabled: data.aiEnabled, ...agent, createdAt: now, updatedAt: now })
      .returning({ id: channels.id });
    return row.id;
  });
  await writeAudit({ actor, action: existing ? "channel.reconnected" : "channel.connected", targetType: "channel", targetId: channelId, metadata: { type: "telegram" } });
  const { mode, warning } = await activateReceiving({ id: channelId }, data.botToken, webhookSecret, deps);
  return { status: "connected", channelId, bot: botView(bot), mode, warning };
}

// ─── Panel ([TG-07], [TG-08]) ───────────────────────────────────────────────────────────────────────────

export type TelegramPanel = {
  id: string;
  name: string;
  status: ChannelRecord["status"];
  /** null until a bot was connected (a demo channel has none). */
  bot: TelegramBotView | null;
  receiveMode: TelegramReceiveMode | null;
  /** Where Telegram sends this bot's updates when the app has a public address. */
  webhookUrl: string;
  lastHealth: ChannelHealth | null;
  lastHealthAt: Date | null;
  /** Masked for owner and admin only ([PER-07]); null for everyone else or when missing. */
  maskedToken: string | null;
  hasCredentials: boolean;
};

export async function getTelegramPanel(actor: Actor, channelId: string): Promise<TelegramPanel> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadTelegramChannel(channelId, { allowDemo: true });
  const config = readTelegramConfig(channel.config);
  const secrets = readTelegramSecrets(channel);
  return {
    id: channel.id,
    name: channel.name,
    status: channel.status,
    bot: config.botUsername ? botView({ botUsername: config.botUsername, botName: config.botName ?? null }) : null,
    receiveMode: config.receiveMode ?? null,
    webhookUrl: telegramWebhookUrl(channel.id),
    lastHealth: channel.lastHealth,
    lastHealthAt: channel.lastHealthAt,
    maskedToken: secrets && can(actor, PERMISSIONS.secrets.viewMasked) ? maskSecret(secrets.botToken) : null,
    hasCredentials: secrets !== null,
  };
}

export type TelegramCheckResult = { ok: true; mode: TelegramReceiveMode; warning: string | null } | { ok: false; error: string };

async function recheck(actor: Actor, channel: ChannelRecord, botToken: string, deps: TelegramDeps, action: string): Promise<TelegramCheckResult> {
  const stored = readTelegramSecrets(channel);
  const validation = await validateTelegramToken(botToken, channel.id, deps);
  // Only a valid change replaces what worked before.
  if (!validation.ok) return { ok: false, error: validation.action ? `${validation.error} ${validation.action}` : validation.error };
  const known = readTelegramConfig(channel.config).botId;
  if (known && known !== validation.bot.botId) return { ok: false, error: `Ese token es de otro bot (@${validation.bot.botUsername}). Para usar otro bot, añade un canal nuevo.` };
  const webhookSecret = stored?.webhookSecret ?? randomToken();
  const now = deps.now?.() ?? new Date();
  await db
    .update(channels)
    .set({ config: { ...channel.config, ...validation.bot }, secretsEnc: encryptTelegramSecrets({ botToken, webhookSecret }), updatedAt: now })
    .where(eq(channels.id, channel.id));
  await writeAudit({ actor, action, targetType: "channel", targetId: channel.id, metadata: { type: "telegram" } });
  // A person asked: the bot comes back here, wherever its updates were going.
  const { mode, warning } = await activateReceiving(channel, botToken, webhookSecret, deps);
  return { ok: true, mode, warning };
}

/** «Revalidar» ([TG-08]): the stored token against Telegram again, and the bot's updates back to this installation. */
export async function revalidateTelegramChannel(actor: Actor, channelId: string, deps: TelegramDeps = {}): Promise<TelegramCheckResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  await enforceValidateLimit(actor.userId);
  const channel = await loadTelegramChannel(channelId);
  if (channel.status === "disabled") throw new ConflictError("Este canal está desactivado: actívalo antes de revalidarlo.");
  const stored = readTelegramSecrets(channel);
  if (!stored) throw new ConflictError("Falta el token de este bot. Vuelve a conectarlo.");
  return recheck(actor, channel, stored.botToken, deps, "channel.revalidated");
}

const tokenSchema = z.object({ botToken: botTokenSchema }).strict();

/** «Cambiar token» ([TG-08]): the new token only replaces the old one if Telegram accepts it and it is the same bot. */
export async function changeTelegramToken(actor: Actor, channelId: string, input: unknown, deps: TelegramDeps = {}): Promise<TelegramCheckResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { botToken } = parseInput(tokenSchema, input);
  await enforceValidateLimit(actor.userId);
  const channel = await loadTelegramChannel(channelId);
  if (channel.status === "disabled" && !channel.secretsEnc) throw new ConflictError("Este bot está desconectado: vuelve a conectarlo con el asistente de Telegram.");
  return recheck(actor, channel, botToken, deps, "channel.token_changed");
}

// ─── Disconnect ([TG-04]) ───────────────────────────────────────────────────────────────────────────────

export type DisconnectTelegramResult = { warning: string | null };

/** Removes the webhook in Telegram and deletes the token; the channel keeps its history, «desactivado». */
export async function disconnectTelegramChannel(actor: Actor, channelId: string, deps: TelegramDeps = {}): Promise<DisconnectTelegramResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadTelegramChannel(channelId);
  const secrets = readTelegramSecrets(channel);
  let warning: string | null = null;
  if (secrets) {
    try {
      await createTelegramClient({ token: secrets.botToken, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl }).deleteWebhook();
    } catch (error) {
      // The token is deleted anyway; with a revoked token there was nothing left to remove.
      if (!isTelegramApiError(error)) console.error(`[telegram] No se pudo quitar el webhook: ${safeErrorMessage(error)}`);
      if (!isTelegramApiError(error) || error.code !== 401) warning = "No se ha podido quitar la dirección de avisos en Telegram. Si vas a usar el bot en otro sitio, allí se sustituirá sola.";
    }
  }
  const now = deps.now?.() ?? new Date();
  await db
    .update(channels)
    .set({ secretsEnc: null, status: "disabled", config: { ...channel.config, receiveMode: null, updateOffset: null, pollFailures: 0 }, updatedAt: now })
    .where(eq(channels.id, channel.id));
  await cancelTelegramJobs(channel.id);
  await writeAudit({ actor, action: "channel.disconnected", targetType: "channel", targetId: channel.id, metadata: { type: "telegram" } });
  return { warning };
}
