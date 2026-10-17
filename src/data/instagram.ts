// Instagram channels: connecting an account, its panel and «Desconectar» ([IG-01], [IG-09]–[IG-11]). The account's public
// identity goes in the channel's config; its token, the app secrets and the webhook's verify token only in
// `secrets_enc`, encrypted, and never leave the server (owner and admin see the token masked, [PER-07]; the verify token
// is shown to them because it has to be pasted in Meta). An account is connected once in the installation ([IG-11]).
// Changing things is «Canales: crear, conectar, configurar, desconectar» (owner, admin); seeing the panel, «Canales: ver».
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { isPublicHttpsUrl, getAppUrl } from "@/server/app-url";
import {
  encryptInstagramSecrets,
  instagramProfileLink,
  instagramWebhookUrl,
  readInstagramConfig,
  readInstagramSecrets,
  TOKEN_LIFETIME_MS,
  type InstagramDeps,
} from "@/server/channels/instagram/config";
import { validateInstagramToken, type InstagramAccountIdentity } from "@/server/channels/instagram/connect";
import { runInstagramHealthCheck } from "@/server/channels/instagram/health";
import { cancelInstagramJobs, ensureInstagramHealthChecks } from "@/server/channels/instagram/schedule";
import type { ChannelRecord } from "@/server/channels/types";
import { maskSecret, randomToken } from "@/server/crypto";
import { ConflictError, NotFoundError, parseInput, RateLimitError } from "@/server/errors";
import { assertAnswersCustomers } from "./agent-audience";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

const MAX_NAME = 80;
/** Checks with Instagram per person and minute ([SEG-07]). */
const VALIDATE_LIMIT = 30;
const VALIDATE_WINDOW_MS = 60_000;

async function enforceValidateLimit(userId: string): Promise<void> {
  const result = await getRateLimiter().hit(`ig:validate:${userId}`, VALIDATE_LIMIT, VALIDATE_WINDOW_MS);
  if (!result.allowed) throw new RateLimitError("Demasiadas comprobaciones con Instagram seguidas. Espera un minuto.");
}

/** An Instagram channel, or NotFoundError. Demo channels never talk to Instagram ([ARR-11]): only read-only views pass `allowDemo`. */
export async function loadInstagramChannel(channelId: unknown, options: { allowDemo?: boolean; executor?: Executor } = {}): Promise<ChannelRecord> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el canal.");
  const [row] = await (options.executor ?? db).select().from(channels).where(eq(channels.id, id.data));
  if (!row || row.type !== "instagram" || (row.isDemo && !options.allowDemo)) throw new NotFoundError("No se ha encontrado el canal de Instagram.");
  return row;
}

/** What the screens show of an account: never its token. */
export type InstagramAccountView = { username: string; name: string | null; link: string };

const accountView = (account: Pick<InstagramAccountIdentity, "username" | "accountName">): InstagramAccountView => ({ username: account.username, name: account.accountName, link: instagramProfileLink(account.username) });

// ─── Connect ([IG-01], [IG-11]) ─────────────────────────────────────────────────────────────────────────

// «\S*», not «\S+»: an empty field only says it is missing, not also that it has spaces.
const tokenSchema = z.string().trim().min(1, "Pega el token de la cuenta.").max(2_000, "El token es demasiado largo.").regex(/^\S*$/, "El token no lleva espacios: cópialo entero.");
const secretSchema = z.string().trim().min(8, "Pega la clave secreta entera.").max(200, "La clave es demasiado larga.").regex(/^\S*$/, "La clave no lleva espacios: cópiala entera.");

export const connectInstagramSchema = z
  .object({
    /** Reconnects this channel instead of creating one. */
    channelId: idSchema.optional(),
    name: z.string().trim().min(1, "Escribe el nombre.").max(MAX_NAME, `Como mucho ${MAX_NAME} caracteres.`),
    accessToken: tokenSchema,
    /** The «Instagram app secret» of the app (§1.1). */
    appSecret: secretSchema,
    /** The Meta app's own secret (App settings › Basic), optional: Meta does not say which one signs (§4.3). */
    metaAppSecret: secretSchema.optional().or(z.literal("").transform(() => undefined)),
    activeAgentId: idSchema.nullable().optional(),
    aiEnabled: z.boolean().default(true),
  })
  .strict();

export type ConnectInstagramResult =
  /** Instagram refused the token: nothing was stored. */
  | { status: "invalid"; error: string; action: string | null }
  /** Stored and subscribed: now the webhook goes in Meta's panel with these two values ([IG-01]). */
  | { status: "connected"; channelId: string; account: InstagramAccountView; webhookUrl: string; verifyToken: string; publicUrl: boolean };

/** The account of another channel of the installation ([IG-11]); a disconnected one is reconnected from its own panel. */
async function assertAccountNotTaken(executor: Executor, accountId: string, exceptChannelId: string | null): Promise<void> {
  const rows = await executor
    .select({ id: channels.id, name: channels.name, config: channels.config, secretsEnc: channels.secretsEnc })
    .from(channels)
    .where(and(eq(channels.type, "instagram"), eq(channels.isDemo, false), ...(exceptChannelId ? [ne(channels.id, exceptChannelId)] : [])));
  const taken = rows.find((row) => readInstagramConfig(row.config).accountId === accountId);
  if (!taken) return;
  if (!taken.secretsEnc) throw new ConflictError(`Esta cuenta de Instagram es la del canal desconectado «${taken.name}»: vuelve a conectarla desde su panel, así conserva sus conversaciones.`);
  throw new ConflictError("Esta cuenta de Instagram ya está conectada en otro canal de la instalación.");
}

/**
 * «Conectar»: checks the token with Instagram (nothing from the browser is trusted), subscribes the account to its
 * messages and stores the channel with its account and its secrets encrypted. A refused token stores nothing and says why.
 */
export async function connectInstagramChannel(actor: Actor, input: unknown, deps: InstagramDeps = {}): Promise<ConnectInstagramResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(connectInstagramSchema, input);
  await enforceValidateLimit(actor.userId);
  const existing = data.channelId ? await loadInstagramChannel(data.channelId) : null;
  const validation = await validateInstagramToken(data.accessToken, deps);
  if (!validation.ok) return { status: "invalid", error: validation.error, action: validation.action };
  const { account } = validation;
  // Left with the type's name, the channel is called as its account: the inbox shows «Instagram · @cuenta» ([BAN-17]).
  const name = data.name === "Instagram" ? `@${account.username}` : data.name;
  await assertAccountNotTaken(db, account.accountId, existing?.id ?? null);
  const known = existing ? readInstagramConfig(existing.config).accountId : null;
  if (known && known !== account.accountId) throw new ConflictError(`Ese token es de otra cuenta (@${account.username}). Para usar otra cuenta, añade un canal nuevo.`);

  // The verify token is the channel's own: a reconnection keeps it, so Meta's panel needs no change.
  const verifyToken = readInstagramSecrets(existing ?? { secretsEnc: null })?.verifyToken ?? randomToken();
  const secretsEnc = encryptInstagramSecrets({ accessToken: data.accessToken, appSecret: data.appSecret, metaAppSecret: data.metaAppSecret ?? null, verifyToken });
  const now = deps.now?.() ?? new Date();
  const identity = { accountId: account.accountId, username: account.username, accountName: account.accountName, tokenSetAt: now.toISOString(), tokenExpiresAt: null, refreshFailures: 0 };
  const channelId = await db.transaction(async (tx) => {
    await assertAccountNotTaken(tx, account.accountId, existing?.id ?? null);
    await assertAnswersCustomers(tx, data.activeAgentId);
    const agent = data.activeAgentId === undefined ? {} : { activeAgentId: data.activeAgentId };
    if (existing) {
      await tx
        .update(channels)
        .set({ name, config: { ...existing.config, ...identity }, secretsEnc, status: "connected", aiEnabled: data.aiEnabled, ...agent, updatedAt: now })
        .where(eq(channels.id, existing.id));
      return existing.id;
    }
    const [row] = await tx
      .insert(channels)
      .values({ type: "instagram", name, status: "connected", config: identity, secretsEnc, replyMode: "auto", aiEnabled: data.aiEnabled, ...agent, createdAt: now, updatedAt: now })
      .returning({ id: channels.id });
    return row.id;
  });
  await writeAudit({ actor, action: existing ? "channel.reconnected" : "channel.connected", targetType: "channel", targetId: channelId, metadata: { type: "instagram" } });
  await ensureInstagramHealthChecks(channelId, { now });
  await runInstagramHealthCheck(channelId, deps);
  return { status: "connected", channelId, account: accountView(account), webhookUrl: instagramWebhookUrl(channelId), verifyToken, publicUrl: isPublicHttpsUrl(getAppUrl()) };
}

// ─── Panel ([IG-10]) ────────────────────────────────────────────────────────────────────────────────────

export type InstagramPanel = {
  id: string;
  name: string;
  status: ChannelRecord["status"];
  isDemo: boolean;
  /** null until an account was connected (a demo channel has its own). */
  account: InstagramAccountView | null;
  /** Where Meta sends this account's webhooks, and the verify token to paste with it (owner and admin only). */
  webhookUrl: string;
  verifyToken: string | null;
  webhookVerifiedAt: Date | null;
  /** Until when the token lasts ([IG-09]). */
  tokenExpiresAt: Date | null;
  lastHealth: ChannelHealth | null;
  lastHealthAt: Date | null;
  /** Masked for owner and admin only ([PER-07]); null for everyone else or when missing. */
  maskedToken: string | null;
  hasCredentials: boolean;
  publicUrl: boolean;
};

export async function getInstagramPanel(actor: Actor, channelId: string): Promise<InstagramPanel> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadInstagramChannel(channelId, { allowDemo: true });
  const config = readInstagramConfig(channel.config);
  const secrets = readInstagramSecrets(channel);
  const managers = can(actor, PERMISSIONS.secrets.viewMasked);
  const expiresAt = config.tokenExpiresAt ? new Date(config.tokenExpiresAt) : config.tokenSetAt ? new Date(new Date(config.tokenSetAt).getTime() + TOKEN_LIFETIME_MS) : null;
  return {
    id: channel.id,
    name: channel.name,
    status: channel.status,
    isDemo: channel.isDemo,
    account: config.username ? accountView({ username: config.username, accountName: config.accountName ?? null }) : null,
    webhookUrl: instagramWebhookUrl(channel.id),
    verifyToken: secrets && managers && can(actor, PERMISSIONS.channels.manage) ? secrets.verifyToken : null,
    webhookVerifiedAt: config.webhookVerifiedAt ? new Date(config.webhookVerifiedAt) : null,
    tokenExpiresAt: secrets ? expiresAt : null,
    lastHealth: channel.lastHealth,
    lastHealthAt: channel.lastHealthAt,
    maskedToken: secrets && managers ? maskSecret(secrets.accessToken) : null,
    hasCredentials: secrets !== null,
    publicUrl: isPublicHttpsUrl(getAppUrl()),
  };
}

export type InstagramCheckResult = { ok: true; warning: string | null } | { ok: false; error: string };

/** The token against Instagram again (and the account subscribed again); only a valid one of the same account is kept. */
async function recheck(actor: Actor, channel: ChannelRecord, accessToken: string, deps: InstagramDeps, action: string): Promise<InstagramCheckResult> {
  const stored = readInstagramSecrets(channel);
  if (!stored) return { ok: false, error: "Faltan las claves de esta cuenta. Vuelve a conectarla con el asistente de Instagram." };
  const validation = await validateInstagramToken(accessToken, deps);
  if (!validation.ok) return { ok: false, error: validation.action ? `${validation.error} ${validation.action}` : validation.error };
  const known = readInstagramConfig(channel.config).accountId;
  if (known && known !== validation.account.accountId) return { ok: false, error: `Ese token es de otra cuenta (@${validation.account.username}). Para usar otra cuenta, añade un canal nuevo.` };
  const now = deps.now?.() ?? new Date();
  const changed = accessToken !== stored.accessToken;
  const identity = { accountId: validation.account.accountId, username: validation.account.username, accountName: validation.account.accountName, ...(changed ? { tokenSetAt: now.toISOString(), tokenExpiresAt: null, refreshFailures: 0 } : {}) };
  await db
    .update(channels)
    .set({ config: { ...channel.config, ...identity }, secretsEnc: encryptInstagramSecrets({ ...stored, accessToken }), updatedAt: now })
    .where(eq(channels.id, channel.id));
  await writeAudit({ actor, action, targetType: "channel", targetId: channel.id, metadata: { type: "instagram" } });
  await ensureInstagramHealthChecks(channel.id, { now });
  const report = await runInstagramHealthCheck(channel.id, deps);
  return { ok: true, warning: report?.health.error ?? null };
}

/** «Revalidar» ([IG-10]): the stored token against Instagram again, and the account subscribed to its messages again. */
export async function revalidateInstagramChannel(actor: Actor, channelId: string, deps: InstagramDeps = {}): Promise<InstagramCheckResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  await enforceValidateLimit(actor.userId);
  const channel = await loadInstagramChannel(channelId);
  if (channel.status === "disabled") throw new ConflictError("Este canal está desactivado: actívalo antes de revalidarlo.");
  const stored = readInstagramSecrets(channel);
  if (!stored) throw new ConflictError("Falta el token de esta cuenta. Vuelve a conectarla.");
  return recheck(actor, channel, stored.accessToken, deps, "channel.revalidated");
}

const changeTokenSchema = z.object({ accessToken: tokenSchema }).strict();

/** «Cambiar token» ([IG-10]): the new token only replaces the old one if Instagram accepts it and it is the same account. */
export async function changeInstagramToken(actor: Actor, channelId: string, input: unknown, deps: InstagramDeps = {}): Promise<InstagramCheckResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { accessToken } = parseInput(changeTokenSchema, input);
  await enforceValidateLimit(actor.userId);
  const channel = await loadInstagramChannel(channelId);
  if (channel.status === "disabled" && !channel.secretsEnc) throw new ConflictError("Esta cuenta está desconectada: vuelve a conectarla con el asistente de Instagram.");
  return recheck(actor, channel, accessToken, deps, "channel.token_changed");
}

// ─── Disconnect ([IG-10]) ───────────────────────────────────────────────────────────────────────────────

/** Deletes the token and the secrets; the channel keeps its history, «desactivado». Meta stops counting on this app's webhook when the app is removed there. */
export async function disconnectInstagramChannel(actor: Actor, channelId: string, deps: InstagramDeps = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadInstagramChannel(channelId);
  const now = deps.now?.() ?? new Date();
  await db
    .update(channels)
    .set({ secretsEnc: null, status: "disabled", config: { ...channel.config, tokenExpiresAt: null, refreshFailures: 0, webhookVerifiedAt: null }, updatedAt: now })
    .where(eq(channels.id, channel.id));
  await cancelInstagramJobs(channel.id);
  await writeAudit({ actor, action: "channel.disconnected", targetType: "channel", targetId: channel.id, metadata: { type: "instagram" } });
}
