// Connecting email channels ([COR-02]–[COR-13], [COR-23], [COR-24]): the business's own OAuth clients (Google Cloud and
// Entra, never shared between businesses), «Conectar con Google / Microsoft» (state and PKCE stored for the return),
// the administrator's consent link, and «Probar conexión» / connect for IMAP/SMTP. Owner and admin only («Canales:
// crear, conectar, configurar»). Secrets are encrypted and a stored one only goes back to where it was saved.
import "server-only";
import { z } from "zod";
import { db } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import { buildGoogleAuthorizeUrl } from "@/lib/google/oauth";
import { buildMicrosoftAdminConsentUrl, buildMicrosoftAuthorizeUrl, TENANT_PATTERN } from "@/lib/microsoft/oauth";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { encryptMailPasswords, encryptOAuthSecrets, readEmailConfig, readOAuthSecrets, updateEmailConfig } from "@/server/channels/email/config";
import { connectImap, imapConnectInputSchema, passwordsFor, testMailConnection, type MailTestResult } from "@/server/channels/email/imap/connect";
import { suggestMailSettings, type MailSuggestion } from "@/server/channels/email/imap/presets";
import { ensureEmailPolling } from "@/server/channels/email/jobs";
import { createOAuthState } from "@/server/channels/email/oauth-state";
import type { ChannelRecord } from "@/server/channels/types";
import { ConflictError, parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { googleRedirectUri, loadEmailChannel, MAX_CHANNEL_NAME, microsoftRedirectUri, startOAuthSchema } from "./email";
import { assertCan } from "./guard";

/** «Probar conexión» talks to servers someone typed: bounded per person ([SEG-07]). */
export const MAIL_TEST_LIMIT = { limit: 10, windowMs: 10 * 60_000 };
/** Microsoft makes a Client Secret last 24 months at most ([COR-07], [F35]). */
const MAX_SECRET_MONTHS = 24;

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** «Conectar» started from the wizard (Canales › Añadir › Correo) comes back to it; otherwise to the channel's panel. */
export const startConnectSchema = startOAuthSchema.extend({ from: z.enum(["wizard"]).optional() }).strict();
const EMAIL_WIZARD_PATH = "/canales/nuevo/correo";

function oauthReturnTo(channelId: string, from: "wizard" | undefined): string {
  return from === "wizard" ? `${EMAIL_WIZARD_PATH}?canal=${channelId}` : `/canales/${channelId}`;
}

// ─── Gmail ([COR-02]–[COR-04])──────────────────────────────────────────────────────────────────────────

export const gmailCredentialsSchema = z
  .object({
    channelId: idSchema,
    clientId: z
      .string()
      .trim()
      .max(300, "El Client ID es demasiado largo.")
      .regex(/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/, "El Client ID de Google termina en .apps.googleusercontent.com."),
    /** Empty = keep the stored one (only for the same Client ID). */
    clientSecret: z.preprocess(blankToUndefined, z.string().trim().min(8, "El Client Secret no es correcto.").max(300).optional()),
  })
  .strict();

/** The business's own Google Cloud client. A different Client ID needs its secret again and a new connection. */
export async function saveGmailCredentials(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(gmailCredentialsSchema, input);
  const channel = await loadEmailChannel(data.channelId, ["email_gmail"]);
  await saveOAuthClient(actor, channel, { clientId: data.clientId, clientSecret: data.clientSecret, previousClientId: readEmailConfig(channel.config).gmail.clientId ?? null, provider: "gmail" });
}

async function saveOAuthClient(
  actor: Actor,
  channel: ChannelRecord,
  input: { clientId: string; clientSecret: string | undefined; previousClientId: string | null; provider: "gmail" | "outlook"; extra?: Record<string, unknown> },
): Promise<void> {
  const stored = readOAuthSecrets(channel);
  const sameClient = input.previousClientId === input.clientId;
  // A stored secret only goes back to the client it was saved for (docs/security.md).
  const clientSecret = input.clientSecret ?? (sameClient ? stored?.clientSecret : undefined);
  if (!clientSecret) throw new ValidationError(undefined, { clientSecret: ["Pega el Client Secret."] });
  // Tokens of another client do not work with this one: they are dropped and the mailbox connects again.
  const keepTokens = sameClient && stored !== null;
  const secrets = { clientSecret, refreshToken: keepTokens ? stored.refreshToken : null, accessToken: keepTokens ? stored.accessToken : null, accessExpiresAt: keepTokens ? stored.accessExpiresAt : null };
  await updateEmailConfig(channel.id, { [input.provider]: { clientId: input.clientId, ...input.extra } }, { extra: { secretsEnc: encryptOAuthSecrets(secrets) } });
  await writeAudit({ actor, action: "channel.configured", targetType: "channel", targetId: channel.id, metadata: { fields: ["clientId", ...(input.clientSecret ? ["clientSecret"] : []), ...Object.keys(input.extra ?? {})] } });
}

/** «Conectar con Google»: the consent URL, with state and PKCE stored for 10 minutes ([COR-23]). */
export async function startGmailOAuth(actor: Actor, input: unknown): Promise<{ url: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId, from } = parseInput(startConnectSchema, input);
  const channel = await loadEmailChannel(channelId, ["email_gmail"]);
  const config = readEmailConfig(channel.config);
  if (!config.gmail.clientId || !readOAuthSecrets(channel)) throw new ConflictError("Guarda antes el Client ID y el Client Secret.");
  const { state, codeChallenge } = await createOAuthState({ provider: "google", channelId: channel.id, userId: actor.userId, returnTo: oauthReturnTo(channel.id, from) });
  return { url: buildGoogleAuthorizeUrl({ clientId: config.gmail.clientId, redirectUri: googleRedirectUri(), state, codeChallenge, loginHint: config.emailAddress }) };
}

// ─── Outlook ([COR-07]) ─────────────────────────────────────────────────────────────────────────────────

const dateOnly = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Escribe la fecha como AAAA-MM-DD.");

export const outlookCredentialsSchema = z
  .object({
    channelId: idSchema,
    clientId: z.guid({ error: "El Client ID (Application ID) de Entra es un identificador como 00000000-0000-0000-0000-000000000000." }),
    clientSecret: z.preprocess(blankToUndefined, z.string().trim().min(8, "El Client Secret no es correcto.").max(300).optional()),
    /** When the Client Secret expires: warned 30 days before ([COR-22]). */
    clientSecretExpiresAt: dateOnly,
    /** `common` or the business's tenant ID or domain. */
    tenant: z.preprocess(blankToUndefined, z.string().trim().toLowerCase().max(255).regex(TENANT_PATTERN, "Escribe «common» o el Tenant ID del negocio.").default("common")),
  })
  .strict();

function secretExpiry(value: string, now: Date): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new ValidationError(undefined, { clientSecretExpiresAt: ["La fecha no es válida."] });
  const limit = new Date(now);
  limit.setUTCMonth(limit.getUTCMonth() + MAX_SECRET_MONTHS);
  limit.setUTCDate(limit.getUTCDate() + 1);
  if (date > limit) throw new ValidationError(undefined, { clientSecretExpiresAt: ["Microsoft hace durar el Client Secret 24 meses como máximo."] });
  return date.toISOString();
}

export async function saveOutlookCredentials(actor: Actor, input: unknown, now: Date = new Date()): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(outlookCredentialsSchema, input);
  const channel = await loadEmailChannel(data.channelId, ["email_outlook"]);
  const previous = readEmailConfig(channel.config).outlook;
  const expiresAt = secretExpiry(data.clientSecretExpiresAt, now);
  await saveOAuthClient(actor, channel, {
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    // Another tenant is another client for the stored tokens.
    previousClientId: previous.tenant === data.tenant ? (previous.clientId ?? null) : null,
    provider: "outlook",
    extra: { tenant: data.tenant, clientSecretExpiresAt: expiresAt, ...(previous.clientSecretExpiresAt !== expiresAt ? { secretWarnedAt: null } : {}) },
  });
}

/** «Conectar con Microsoft»: the consent URL with state and PKCE ([COR-07], [COR-23]). */
export async function startOutlookOAuth(actor: Actor, input: unknown): Promise<{ url: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId, from } = parseInput(startConnectSchema, input);
  const channel = await loadEmailChannel(channelId, ["email_outlook"]);
  const config = readEmailConfig(channel.config);
  if (!config.outlook.clientId || !config.outlook.tenant || !readOAuthSecrets(channel)) throw new ConflictError("Guarda antes el Client ID, el Client Secret y el Tenant ID.");
  const { state, codeChallenge } = await createOAuthState({ provider: "microsoft", channelId: channel.id, userId: actor.userId, returnTo: oauthReturnTo(channel.id, from) });
  return {
    url: buildMicrosoftAuthorizeUrl({ tenant: config.outlook.tenant, clientId: config.outlook.clientId, redirectUri: microsoftRedirectUri(), state, codeChallenge, loginHint: config.emailAddress }),
  };
}

/** The administrator's consent link, when Microsoft asks for it; null with `common` ([COR-07], [F31]). */
export async function outlookAdminConsentUrl(actor: Actor, input: unknown): Promise<{ url: string | null }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId, from } = parseInput(startConnectSchema, input);
  const channel = await loadEmailChannel(channelId, ["email_outlook"]);
  const { clientId, tenant } = readEmailConfig(channel.config).outlook;
  if (!clientId || !tenant || tenant === "common" || tenant === "consumers") return { url: null };
  const { state } = await createOAuthState({ provider: "microsoft", channelId: channel.id, userId: actor.userId, returnTo: oauthReturnTo(channel.id, from) });
  return { url: buildMicrosoftAdminConsentUrl({ tenant, clientId, redirectUri: microsoftRedirectUri(), state }) };
}

// ─── Otro (IMAP/SMTP) ([COR-09]–[COR-13]) ───────────────────────────────────────────────────────────────

/** Servers filled in by the address's domain ([COR-10]); Microsoft addresses go to Outlook ([COR-09]). */
export function suggestEmailServers(actor: Actor, email: unknown): MailSuggestion | null {
  assertCan(actor, PERMISSIONS.channels.manage);
  return typeof email === "string" && email.length <= 254 ? suggestMailSettings(email) : null;
}

export const imapTestSchema = imapConnectInputSchema.extend({ channelId: idSchema.optional() });

async function assertMailTestAllowed(actor: Actor): Promise<void> {
  const result = await getRateLimiter().hit(`email:test:${actor.userId}`, MAIL_TEST_LIMIT.limit, MAIL_TEST_LIMIT.windowMs);
  if (!result.allowed) throw new RateLimitError("Demasiadas pruebas de conexión seguidas. Espera unos minutos.");
}

/** «Probar conexión»: IMAP and SMTP, with each failure in Spanish ([COR-11]). Nothing is stored. */
export async function testEmailServers(actor: Actor, input: unknown): Promise<MailTestResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId, ...data } = parseInput(imapTestSchema, input);
  const channel = channelId ? await loadEmailChannel(channelId, ["email_imap"]) : null;
  await assertMailTestAllowed(actor);
  const passwords = passwordsFor(channel, data);
  if (!passwords) throw new ValidationError(undefined, { password: ["Escribe la contraseña del buzón."] });
  return testMailConnection(data, passwords);
}

export const connectImapSchema = imapConnectInputSchema.extend({
  /** Reconnects this channel instead of creating one. */
  channelId: idSchema.optional(),
  name: z.string().trim().min(1).max(MAX_CHANNEL_NAME).optional(),
});

export type ConnectImapResult = { ok: true; channelId: string } | { ok: false; result: MailTestResult | null; error: string };

/** Tests IMAP and SMTP and, only when both work, stores the mailbox as connected ([COR-11]). */
export async function connectImapChannel(actor: Actor, input: unknown): Promise<ConnectImapResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId, name, ...data } = parseInput(connectImapSchema, input);
  const existing = channelId ? await loadEmailChannel(channelId, ["email_imap"]) : null;
  await assertMailTestAllowed(actor);
  const connection = await connectImap(existing, data);
  if (!connection.ok) return { ok: false, result: connection.result, error: connection.error };
  const now = new Date();
  const health: ChannelHealth = { checkedAt: now.toISOString(), checks: [{ key: "connection", status: "ok", detail: `Conectado a ${data.imap.host}` }] };
  let id = existing?.id;
  if (!id) {
    const [row] = await db
      .insert(channels)
      .values({ type: "email_imap", name: name ?? data.email, status: "connected", replyMode: "draft", config: {}, lastHealth: health, lastHealthAt: now })
      .returning({ id: channels.id });
    id = row.id;
  }
  await updateEmailConfig(id, connection.config, {
    extra: { status: "connected", secretsEnc: encryptMailPasswords(connection.passwords), lastHealth: health, lastHealthAt: now, ...(name ? { name } : {}) },
  });
  await ensureEmailPolling(id);
  await writeAudit({ actor, action: "channel.connected", targetType: "channel", targetId: id, metadata: { type: "email_imap" } });
  return { ok: true, channelId: id };
}
