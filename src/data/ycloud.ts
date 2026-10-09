// WhatsApp through YCloud: connecting a number, its panel and «Desconectar» ([YC-01]–[YC-04], [YC-09], [YC-10]). The
// number and its state go in the channel's WhatsApp columns (`connection_mode` «ycloud»); the account's API key and the
// secret of the channel's webhook only in `secrets_enc`, encrypted, and never leave the server (owner and admin see the
// key masked, [PER-07]). A number is connected once in the installation, whatever the way ([WA-11]). Changing things is
// «Canales: crear, conectar, configurar, desconectar» (owner, admin); seeing the panel, «Canales: ver».
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { agents, channels, whatsappTemplates, type ChannelHealth } from "@/db/schema";
import { phoneDigits } from "@/lib/meta/markets";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { createYCloudClient } from "@/lib/ycloud/client";
import { isYCloudApiError } from "@/lib/ycloud/errors";
import type { YCloudPhoneNumber } from "@/lib/ycloud/schemas";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import type { ChannelRecord } from "@/server/channels/types";
import type { TemplatesSyncResult } from "@/server/channels/whatsapp/templates";
import { encryptYCloudSecrets, readYCloudConfig, readYCloudSecrets, updateYCloudConfig, ycloudPhoneNumberId, ycloudWebhookUrl, type YCloudDeps } from "@/server/channels/ycloud/config";
import { ensureYCloudWebhook, validateYCloudKey, ycloudCanReceive } from "@/server/channels/ycloud/connect";
import { runYCloudHealthCheck } from "@/server/channels/ycloud/jobs";
import { cancelYCloudJobs, enqueueYCloudTemplatesSync, ensureYCloudHealthChecks } from "@/server/channels/ycloud/schedule";
import { syncYCloudTemplates } from "@/server/channels/ycloud/templates";
import { maskSecret } from "@/server/crypto";
import { ConflictError, parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { loadWhatsAppChannel } from "./whatsapp";
import { assertWhatsAppNumberFree, listWhatsAppNumbers } from "./whatsapp-numbers";

const MAX_NAME = 80;
/** Checks with YCloud per person and minute ([SEG-07]). */
const VALIDATE_LIMIT = 30;
const VALIDATE_WINDOW_MS = 60_000;
/** [YC-04]: the key is valid and the channel is stored, but nothing can arrive yet. */
export const YCLOUD_LOCAL_WARNING =
  "La app no tiene una dirección pública con HTTPS, así que YCloud no puede avisarla: puedes enviar, pero no llegarán mensajes. Publica la app y pulsa «Revalidar» en el panel del canal.";
const NUMBER_NOT_IN_ACCOUNT = "Ese número no está en esta cuenta de YCloud. Dalo de alta en YCloud (WhatsApp › Phone numbers) y vuelve a comprobar la clave.";

async function enforceValidateLimit(userId: string): Promise<void> {
  const result = await getRateLimiter().hit(`yc:validate:${userId}`, VALIDATE_LIMIT, VALIDATE_WINDOW_MS);
  if (!result.allowed) throw new RateLimitError("Demasiadas comprobaciones con YCloud seguidas. Espera un minuto.");
}

/** A WhatsApp channel connected through YCloud, or NotFoundError ([WA-54]). */
export async function loadYCloudChannel(channelId: unknown, options: { executor?: Executor } = {}): Promise<ChannelRecord> {
  return loadWhatsAppChannel(channelId, { ...options, vias: ["ycloud"] });
}

// ─── «Comprobar clave» ([YC-02]) ────────────────────────────────────────────────────────────────────────

const apiKeySchema = z.string().trim().min(8, "Pega la clave de API de YCloud completa.").max(500, "La clave es demasiado larga.");
const phoneNumberSchema = z.string().trim().regex(/^\+?\d{6,20}$/, "Elige un número de la lista.");

/** What the screens show of a number of the account. */
export type YCloudNumberView = {
  /** E.164 with «+»: what «Conectar» sends back. */
  phoneNumber: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  status: string | null;
  qualityRating: string | null;
  messagingLimit: string | null;
  /** Already in another channel of this installation ([WA-11]). */
  taken: boolean;
};

const numberView = (number: YCloudPhoneNumber, taken: ReadonlySet<string>): YCloudNumberView => ({
  phoneNumber: number.phoneNumber,
  displayPhoneNumber: number.displayPhoneNumber ?? number.phoneNumber,
  verifiedName: number.verifiedName ?? null,
  status: number.status ?? null,
  qualityRating: number.qualityRating ?? null,
  messagingLimit: number.messagingLimit ?? null,
  taken: taken.has(phoneDigits(number.phoneNumber)),
});

export const checkYCloudKeySchema = z.object({ apiKey: apiKeySchema, /** The channel being connected again. */ channelId: idSchema.optional() }).strict();

export type CheckYCloudKeyResult =
  | { ok: true; balance: { amount: number; currency: string | null }; numbers: YCloudNumberView[] }
  /** YCloud refused the key: nothing was stored. */
  | { ok: false; error: string; action: string | null };

/** «Comprobar clave»: the key against YCloud and the account's WhatsApp numbers. Nothing is stored. */
export async function checkYCloudKey(actor: Actor, input: unknown, deps: YCloudDeps = {}): Promise<CheckYCloudKeyResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(checkYCloudKeySchema, input);
  await enforceValidateLimit(actor.userId);
  const existing = data.channelId ? await loadYCloudChannel(data.channelId) : null;
  const validation = await validateYCloudKey(data.apiKey, deps);
  if (!validation.ok) return validation;
  const taken = new Set((await listWhatsAppNumbers(db, existing?.id ?? null)).map((row) => row.number));
  return { ok: true, balance: { amount: validation.balance.amount, currency: validation.balance.currency ?? null }, numbers: validation.numbers.map((number) => numberView(number, taken)) };
}

// ─── Connect ([YC-03], [YC-04], [WA-56]) ────────────────────────────────────────────────────────────────

export const connectYCloudSchema = z
  .object({
    /** Reconnects this channel instead of creating one. */
    channelId: idSchema.optional(),
    name: z.string().trim().min(1, "Escribe el nombre.").max(MAX_NAME, `Como mucho ${MAX_NAME} caracteres.`),
    apiKey: apiKeySchema,
    phoneNumber: phoneNumberSchema,
    activeAgentId: idSchema.nullable().optional(),
    aiEnabled: z.boolean().default(true),
  })
  .strict();

export type ConnectYCloudResult =
  /** YCloud refused the key or the number is not in the account: nothing was stored. */
  | { status: "invalid"; error: string; action: string | null }
  /** `warning`: the number is stored but YCloud cannot reach the app yet; «Revalidar» tries again. */
  | { status: "connected"; channelId: string; number: YCloudNumberView; receiving: boolean; warning: string | null };

async function assertAgentExists(executor: Executor, agentId: string | null | undefined): Promise<void> {
  if (!agentId) return;
  const [agent] = await executor.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new ValidationError(undefined, { activeAgentId: ["Ese agente no existe."] });
}

/** The WhatsApp columns a number of YCloud fills. */
const numberColumns = (number: YCloudPhoneNumber) => ({
  phoneNumberId: ycloudPhoneNumberId(number.phoneNumber),
  wabaId: number.wabaId,
  displayPhoneNumber: number.displayPhoneNumber ?? number.phoneNumber,
  verifiedName: number.verifiedName ?? null,
  qualityRating: number.qualityRating ?? null,
  nameStatus: number.nameStatus ?? null,
  codeVerificationStatus: number.codeVerificationStatus ?? null,
  messagingLimit: number.messagingLimit ?? null,
});

/**
 * Makes YCloud call this channel (its own webhook endpoint, whose secret is stored encrypted) and refreshes the lights.
 * Returns the Spanish reason when nothing can arrive yet: the channel is stored all the same ([YC-04]).
 */
async function activateReceiving(channelId: string, apiKey: string, deps: YCloudDeps): Promise<{ receiving: boolean; warning: string | null }> {
  const now = deps.now?.() ?? new Date();
  let warning: string | null = null;
  if (!ycloudCanReceive(channelId)) {
    warning = YCLOUD_LOCAL_WARNING;
  } else {
    try {
      const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
      const stored = { endpointId: readYCloudConfig(channel.config).ycloudWebhookEndpointId ?? null, secret: readYCloudSecrets(channel)?.webhookSecret ?? null };
      const client = createYCloudClient({ apiKey, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
      const webhook = await ensureYCloudWebhook(client, channelId, stored.endpointId && stored.secret ? { endpointId: stored.endpointId, secret: stored.secret } : null);
      await updateYCloudConfig(channelId, { ycloudWebhookEndpointId: webhook.endpointId }, { extra: { secretsEnc: encryptYCloudSecrets({ apiKey, webhookSecret: webhook.secret }) } });
    } catch (error) {
      if (!isYCloudApiError(error)) console.error(`[ycloud] No se pudo crear la dirección de avisos: ${safeErrorMessage(error)}`);
      warning = isYCloudApiError(error)
        ? `YCloud no ha aceptado la dirección de avisos de la app: ${error.userMessage} ${error.action}`
        : "No se ha podido crear la dirección de avisos en YCloud por un error inesperado. Pulsa «Revalidar».";
    }
  }
  await ensureYCloudHealthChecks(channelId, { now });
  await runYCloudHealthCheck(channelId, deps);
  await enqueueYCloudTemplatesSync(channelId);
  return { receiving: warning === null, warning };
}

/**
 * «Conectar»: checks the key with YCloud again (nothing from the browser is trusted), stores the channel with its
 * number and its key encrypted, and creates in YCloud the address that tells this channel about new messages. A
 * refused key stores nothing and says why.
 */
export async function connectYCloudChannel(actor: Actor, input: unknown, deps: YCloudDeps = {}): Promise<ConnectYCloudResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(connectYCloudSchema, input);
  await enforceValidateLimit(actor.userId);
  const existing = data.channelId ? await loadYCloudChannel(data.channelId) : null;
  const validation = await validateYCloudKey(data.apiKey, deps);
  if (!validation.ok) return { status: "invalid", error: validation.error, action: validation.action };
  const wanted = phoneDigits(data.phoneNumber);
  const number = validation.numbers.find((item) => phoneDigits(item.phoneNumber) === wanted);
  if (!number) return { status: "invalid", error: NUMBER_NOT_IN_ACCOUNT, action: null };
  // The channel's conversations are that number's: another number is another channel.
  if (existing?.phoneNumberId && existing.phoneNumberId !== ycloudPhoneNumberId(number.phoneNumber)) {
    throw new ConflictError(`Este canal es del número ${existing.displayPhoneNumber ?? "anterior"}. Para conectar otro número, añade un canal nuevo.`);
  }

  // The webhook's secret is YCloud's: a reconnection keeps the one it had while its endpoint is still there.
  const secretsEnc = encryptYCloudSecrets({ apiKey: data.apiKey, webhookSecret: readYCloudSecrets(existing ?? { secretsEnc: null })?.webhookSecret ?? null });
  const now = deps.now?.() ?? new Date();
  const channelId = await db.transaction(async (tx) => {
    await assertWhatsAppNumberFree(tx, number.phoneNumber, { exceptChannelId: existing?.id ?? null });
    await assertAgentExists(tx, data.activeAgentId);
    const agent = data.activeAgentId === undefined ? {} : { activeAgentId: data.activeAgentId };
    const values = { ...numberColumns(number), name: data.name, connectionMode: "ycloud" as const, secretsEnc, status: "connecting" as const, aiEnabled: data.aiEnabled, ...agent, updatedAt: now };
    if (existing) {
      await tx.update(channels).set({ ...values, config: { ...existing.config, ycloudPhoneNumber: number.phoneNumber } }).where(eq(channels.id, existing.id));
      return existing.id;
    }
    // A number with conversations of its own starts answering nobody ([WA-56]).
    const [row] = await tx
      .insert(channels)
      .values({ ...values, type: "whatsapp", config: { ycloudPhoneNumber: number.phoneNumber }, replyMode: "auto", testMode: true, testAllowlist: [], createdAt: now })
      .returning({ id: channels.id });
    return row.id;
  });
  await writeAudit({ actor, action: existing ? "channel.reconnected" : "channel.connected", targetType: "channel", targetId: channelId, metadata: { type: "whatsapp", via: "ycloud" } });
  const { receiving, warning } = await activateReceiving(channelId, data.apiKey, deps);
  return { status: "connected", channelId, number: numberView(number, new Set()), receiving, warning };
}

// ─── Panel ([YC-09]) ────────────────────────────────────────────────────────────────────────────────────

export type YCloudPanel = {
  id: string;
  name: string;
  status: ChannelRecord["status"];
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimit: string | null;
  wabaId: string | null;
  /** Where YCloud tells this channel about new messages. */
  webhookUrl: string;
  /** The app has a public HTTPS address YCloud can call ([YC-04]). */
  canReceive: boolean;
  balance: { amount: number; currency: string | null; at: string } | null;
  lastHealth: ChannelHealth | null;
  lastHealthAt: Date | null;
  lastInboundAt: Date | null;
  /** Masked for owner and admin only ([PER-07]); null for everyone else or when missing. */
  maskedKey: string | null;
  hasCredentials: boolean;
  templates: number;
};

export async function getYCloudPanel(actor: Actor, channelId: string): Promise<YCloudPanel> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadYCloudChannel(channelId);
  const secrets = readYCloudSecrets(channel);
  const config = readYCloudConfig(channel.config);
  const templates = await db.select({ id: whatsappTemplates.id }).from(whatsappTemplates).where(eq(whatsappTemplates.channelId, channel.id));
  return {
    id: channel.id,
    name: channel.name,
    status: channel.status,
    displayPhoneNumber: channel.displayPhoneNumber,
    verifiedName: channel.verifiedName,
    qualityRating: channel.qualityRating,
    messagingLimit: channel.messagingLimit,
    wabaId: channel.wabaId,
    webhookUrl: ycloudWebhookUrl(channel.id),
    canReceive: ycloudCanReceive(channel.id),
    balance: config.ycloudBalance ?? null,
    lastHealth: channel.lastHealth,
    lastHealthAt: channel.lastHealthAt,
    lastInboundAt: channel.lastInboundAt,
    maskedKey: secrets && can(actor, PERMISSIONS.secrets.viewMasked) ? maskSecret(secrets.apiKey) : null,
    hasCredentials: secrets !== null,
    templates: templates.length,
  };
}

export type YCloudCheckResult = { ok: true; receiving: boolean; warning: string | null } | { ok: false; error: string };

/** Checks `apiKey` for this channel's number; only a valid key that still sees the number replaces what worked before. */
async function recheck(actor: Actor, channel: ChannelRecord, apiKey: string, deps: YCloudDeps, action: string): Promise<YCloudCheckResult> {
  const validation = await validateYCloudKey(apiKey, deps);
  if (!validation.ok) return { ok: false, error: validation.action ? `${validation.error} ${validation.action}` : validation.error };
  const number = validation.numbers.find((item) => ycloudPhoneNumberId(item.phoneNumber) === channel.phoneNumberId);
  if (!number) return { ok: false, error: `Esa clave no ve el número de este canal (${channel.displayPhoneNumber ?? "sin número"}). Tiene que ser una clave de la cuenta de YCloud donde está el número.` };
  const now = deps.now?.() ?? new Date();
  await db
    .update(channels)
    .set({ ...numberColumns(number), secretsEnc: encryptYCloudSecrets({ apiKey, webhookSecret: readYCloudSecrets(channel)?.webhookSecret ?? null }), updatedAt: now })
    .where(eq(channels.id, channel.id));
  await writeAudit({ actor, action, targetType: "channel", targetId: channel.id, metadata: { type: "whatsapp", via: "ycloud" } });
  return { ok: true, ...(await activateReceiving(channel.id, apiKey, deps)) };
}

/** «Revalidar» ([YC-09]): the stored key against YCloud again, and the channel's webhook endpoint back in place. */
export async function revalidateYCloudChannel(actor: Actor, channelId: string, deps: YCloudDeps = {}): Promise<YCloudCheckResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  await enforceValidateLimit(actor.userId);
  const channel = await loadYCloudChannel(channelId);
  if (channel.status === "disabled") throw new ConflictError("Este canal está desactivado: actívalo antes de revalidarlo.");
  const stored = readYCloudSecrets(channel);
  if (!stored) throw new ConflictError("Falta la clave de YCloud de este número. Vuelve a conectarlo.");
  return recheck(actor, channel, stored.apiKey, deps, "channel.revalidated");
}

const keySchema = z.object({ apiKey: apiKeySchema }).strict();

/** «Cambiar clave» ([YC-09]): the new key only replaces the old one if YCloud accepts it and it sees the same number. */
export async function changeYCloudKey(actor: Actor, channelId: string, input: unknown, deps: YCloudDeps = {}): Promise<YCloudCheckResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { apiKey } = parseInput(keySchema, input);
  await enforceValidateLimit(actor.userId);
  const channel = await loadYCloudChannel(channelId);
  if (!channel.secretsEnc) throw new ConflictError("Este número está desconectado: vuelve a conectarlo con el asistente de YCloud.");
  return recheck(actor, channel, apiKey, deps, "channel.token_changed");
}

/** «Sincronizar plantillas» ([YC-07]). */
export async function syncYCloudTemplatesNow(actor: Actor, channelId: string, deps: YCloudDeps = {}): Promise<TemplatesSyncResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  await enforceValidateLimit(actor.userId);
  const channel = await loadYCloudChannel(channelId);
  const result = await syncYCloudTemplates(channel, deps);
  await writeAudit({ actor, action: "channel.templates_synced", targetType: "channel", targetId: channel.id, metadata: { total: result.total } });
  return result;
}

// ─── Disconnect ([YC-10]) ───────────────────────────────────────────────────────────────────────────────

export type DisconnectYCloudResult = { warning: string | null };

/** Removes the channel's webhook endpoint in YCloud and deletes the key; the channel keeps its history, «desactivado». */
export async function disconnectYCloudChannel(actor: Actor, channelId: string, deps: YCloudDeps = {}): Promise<DisconnectYCloudResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadYCloudChannel(channelId);
  const secrets = readYCloudSecrets(channel);
  const endpointId = readYCloudConfig(channel.config).ycloudWebhookEndpointId ?? null;
  let warning: string | null = null;
  if (secrets && endpointId) {
    try {
      await createYCloudClient({ apiKey: secrets.apiKey, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl }).deleteWebhookEndpoint(endpointId);
    } catch (error) {
      // The key is deleted anyway; an endpoint already gone in YCloud left nothing to remove.
      if (!isYCloudApiError(error)) console.error(`[ycloud] No se pudo borrar la dirección de avisos: ${safeErrorMessage(error)}`);
      if (!isYCloudApiError(error) || error.httpStatus !== 404) warning = "No se ha podido borrar la dirección de avisos en YCloud. Bórrala tú en YCloud › Developers › Webhooks.";
    }
  }
  const now = deps.now?.() ?? new Date();
  await db
    .update(channels)
    .set({ secretsEnc: null, status: "disabled", webhookStatus: null, config: { ...channel.config, ycloudWebhookEndpointId: null, ycloudBalance: null }, updatedAt: now })
    .where(eq(channels.id, channel.id));
  await cancelYCloudJobs(channel.id);
  await writeAudit({ actor, action: "channel.disconnected", targetType: "channel", targetId: channel.id, metadata: { type: "whatsapp", via: "ycloud" } });
  return { warning };
}
