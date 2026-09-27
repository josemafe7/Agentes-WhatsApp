// Email channels for the screens ([COR-01], [COR-16], [COR-17], [COR-21], [COR-22], [CAN-01], [CAN-15]–[CAN-17]): create,
// settings (signature and daily caps), the channel view, revalidate, poll now and disconnect. Connecting (OAuth
// clients, «Conectar», IMAP/SMTP) is in email-connect.ts and the OAuth return in email-oauth.ts. Changing anything is
// «Canales: crear, conectar, configurar, desconectar» (owner, admin); the view is «Canales: ver» (also Solo lectura), and
// only owner and admin see masked secrets ([PER-07]). Secrets are encrypted and never leave the server ([SEG-01]).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, type ChannelHealth } from "@/db/schema";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema, optionalText } from "@/lib/validation";
import { appUrl } from "@/server/app-url";
import { emailProviderFor } from "@/server/channels/email/adapter";
import { EMAIL_CHANNEL_TYPES, isEmailChannelType, readEmailConfig, readMailPasswords, readOAuthSecrets, updateEmailConfig, type EmailChannelType } from "@/server/channels/email/config";
import { MAX_DAILY_CAP, MAX_SIGNATURE } from "@/server/channels/email/constants";
import { IGNORE_REASON_LABELS, IGNORE_REASONS, type IgnoreReason } from "@/server/channels/email/filters";
import { cancelEmailJobs, requestEmailPollSoon } from "@/server/channels/email/jobs";
import { secretExpiryCheck } from "@/server/channels/email/outlook/provider";
import { RECONNECT_LABEL } from "@/server/channels/email/status";
import type { ChannelRecord } from "@/server/channels/types";
import { maskSecret } from "@/server/crypto";
import { NotFoundError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

export const GOOGLE_CALLBACK_PATH = "/api/oauth/google/callback";
export const MICROSOFT_CALLBACK_PATH = "/api/oauth/microsoft/callback";
export const MAX_CHANNEL_NAME = 80;

/** The redirect URIs to copy into Google Cloud and Entra: always the installation's public address ([COR-02]). */
export function googleRedirectUri(): string {
  return appUrl(GOOGLE_CALLBACK_PATH);
}
export function microsoftRedirectUri(): string {
  return appUrl(MICROSOFT_CALLBACK_PATH);
}

/** An email channel, or NotFoundError. Demo channels never talk to a real service ([ARR-11]). */
export async function loadEmailChannel(channelId: unknown, types: readonly EmailChannelType[] = EMAIL_CHANNEL_TYPES, options: { allowDemo?: boolean } = {}): Promise<ChannelRecord> {
  const id = idSchema.safeParse(channelId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el canal de correo.");
  const [row] = await db.select().from(channels).where(eq(channels.id, id.data));
  if (!row || !isEmailChannelType(row.type) || !types.includes(row.type) || (row.isDemo && !options.allowDemo)) throw new NotFoundError("No se ha encontrado el canal de correo.");
  return row;
}

// ─── Create ([COR-01]) ──────────────────────────────────────────────────────────────────────────────────

export const createEmailChannelSchema = z
  .object({
    type: z.enum(EMAIL_CHANNEL_TYPES, { error: "Elige Gmail, Outlook u Otro (IMAP/SMTP)." }),
    name: z.string().trim().min(1, "Escribe un nombre.").max(MAX_CHANNEL_NAME, `Como mucho ${MAX_CHANNEL_NAME} caracteres.`),
  })
  .strict();

/** A new mailbox waiting for its connection. Email answers with drafts by default ([CAN-07], [COR-14]). */
export async function createEmailChannel(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(createEmailChannelSchema, input);
  const [row] = await db.insert(channels).values({ type: data.type, name: data.name, status: "draft", replyMode: "draft", config: {} }).returning({ id: channels.id });
  await writeAudit({ actor, action: "channel.created", targetType: "channel", targetId: row.id, metadata: { type: data.type } });
  return { id: row.id };
}

export const startOAuthSchema = z.object({ channelId: idSchema }).strict();

// ─── Settings ([COR-17], [COR-21]) ──────────────────────────────────────────────────────────────────────

export const emailSettingsSchema = z
  .object({
    channelId: idSchema,
    signature: optionalText(MAX_SIGNATURE),
    dailyCapPerThread: z.coerce.number().int("Escribe un número entero.").min(1, "Al menos 1.").max(MAX_DAILY_CAP, `Como mucho ${MAX_DAILY_CAP}.`).optional(),
    dailyCapPerSender: z.coerce.number().int("Escribe un número entero.").min(1, "Al menos 1.").max(MAX_DAILY_CAP, `Como mucho ${MAX_DAILY_CAP}.`).optional(),
    /** IMAP only: IDLE in the VPS worker. */
    imapIdle: z.boolean().optional(),
  })
  .strict();

export async function updateEmailSettings(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(emailSettingsSchema, input);
  const channel = await loadEmailChannel(data.channelId, EMAIL_CHANNEL_TYPES, { allowDemo: true });
  await updateEmailConfig(channel.id, {
    ...(data.signature !== undefined ? { signature: data.signature } : {}),
    ...(data.dailyCapPerThread !== undefined ? { dailyCapPerThread: data.dailyCapPerThread } : {}),
    ...(data.dailyCapPerSender !== undefined ? { dailyCapPerSender: data.dailyCapPerSender } : {}),
    ...(data.imapIdle !== undefined && channel.type === "email_imap" ? { imap: { idle: data.imapIdle } } : {}),
  });
  const fields = Object.keys(data).filter((key) => key !== "channelId");
  await writeAudit({ actor, action: "channel.configured", targetType: "channel", targetId: channel.id, metadata: { fields } });
}

// ─── View ([CAN-01], [CAN-15], [COR-16], [COR-22]) ──────────────────────────────────────────────────────

export type EmailChannelView = {
  id: string;
  type: EmailChannelType;
  name: string;
  status: ChannelRecord["status"];
  isDemo: boolean;
  emailAddress: string | null;
  /** «Requiere reconexión» and why ([COR-22]). */
  reconnect: { reason: string; at: string; label: string } | null;
  lastSyncAt: string | null;
  health: ChannelHealth | null;
  grantedScopes: string[];
  settings: { signature: string | null; dailyCapPerThread: number; dailyCapPerSender: number; imapIdle: boolean };
  /** Ignored emails by reason, for Diagnóstico ([COR-16]). */
  ignored: { reason: IgnoreReason; label: string; count: number }[];
  gmail: { clientId: string | null; redirectUri: string; clientSecret: string | null } | null;
  outlook: {
    clientId: string | null;
    tenant: string | null;
    clientSecretExpiresAt: string | null;
    secretExpiry: ChannelHealth["checks"][number] | null;
    redirectUri: string;
    clientSecret: string | null;
    adminConsentAvailable: boolean;
  } | null;
  imap: {
    imapHost: string | null;
    imapPort: number | null;
    imapSecurity: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecurity: string | null;
    username: string | null;
    smtpUsername: string | null;
    sentPath: string | null;
    draftsPath: string | null;
    password: string | null;
  } | null;
};

/** The channel panel's email part. Masked secrets only for owner and admin ([PER-07]); never whole. */
export async function getEmailChannelView(actor: Actor, channelId: unknown, now: Date = new Date()): Promise<EmailChannelView> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadEmailChannel(channelId, EMAIL_CHANNEL_TYPES, { allowDemo: true });
  const type = channel.type as EmailChannelType;
  const config = readEmailConfig(channel.config);
  const seeMasked = can(actor, PERMISSIONS.secrets.viewMasked);
  const oauth = seeMasked ? readOAuthSecrets(channel) : null;
  const passwords = seeMasked ? readMailPasswords(channel) : null;
  return {
    id: channel.id,
    type,
    name: channel.name,
    status: channel.status,
    isDemo: channel.isDemo,
    emailAddress: config.emailAddress ?? null,
    reconnect: config.reconnect ? { ...config.reconnect, label: RECONNECT_LABEL } : null,
    lastSyncAt: config.lastSyncAt ?? null,
    health: channel.lastHealth ?? null,
    grantedScopes: config.grantedScopes,
    settings: { signature: config.signature ?? null, dailyCapPerThread: config.dailyCapPerThread, dailyCapPerSender: config.dailyCapPerSender, imapIdle: config.imap.idle === true },
    ignored: IGNORE_REASONS.filter((reason) => (config.ignored[reason] ?? 0) > 0).map((reason) => ({ reason, label: IGNORE_REASON_LABELS[reason], count: config.ignored[reason] ?? 0 })),
    gmail: type === "email_gmail" ? { clientId: config.gmail.clientId ?? null, redirectUri: googleRedirectUri(), clientSecret: oauth ? maskSecret(oauth.clientSecret) : null } : null,
    outlook:
      type === "email_outlook"
        ? {
            clientId: config.outlook.clientId ?? null,
            tenant: config.outlook.tenant ?? null,
            clientSecretExpiresAt: config.outlook.clientSecretExpiresAt ?? null,
            secretExpiry: secretExpiryCheck(config.outlook.clientSecretExpiresAt, now),
            redirectUri: microsoftRedirectUri(),
            clientSecret: oauth ? maskSecret(oauth.clientSecret) : null,
            adminConsentAvailable: Boolean(config.outlook.tenant && config.outlook.tenant !== "common" && config.outlook.tenant !== "consumers"),
          }
        : null,
    imap:
      type === "email_imap"
        ? {
            imapHost: config.imap.imapHost ?? null,
            imapPort: config.imap.imapPort ?? null,
            imapSecurity: config.imap.imapSecurity ?? null,
            smtpHost: config.imap.smtpHost ?? null,
            smtpPort: config.imap.smtpPort ?? null,
            smtpSecurity: config.imap.smtpSecurity ?? null,
            username: config.imap.username ?? null,
            smtpUsername: config.imap.smtpUsername ?? null,
            sentPath: config.imap.sentPath ?? null,
            draftsPath: config.imap.draftsPath ?? null,
            password: passwords ? maskSecret(passwords.password) : null,
          }
        : null,
  };
}

// ─── Revalidate, poll now and disconnect ([CAN-15], [CAN-16]) ───────────────────────────────────────────

/** «Revalidar»: the provider checked now; the result is stored as the channel's lights. */
export async function checkEmailChannel(actor: Actor, input: unknown): Promise<ChannelHealth> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId } = parseInput(startOAuthSchema, input);
  const channel = await loadEmailChannel(channelId);
  const health = await emailProviderFor(channel.type as EmailChannelType).healthCheck(channel, {});
  await db.update(channels).set({ lastHealth: health, lastHealthAt: new Date(), updatedAt: new Date() }).where(eq(channels.id, channel.id));
  return health;
}

/** «Leer ahora»: a poll as soon as the background work runs. */
export async function pollEmailChannelNow(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId } = parseInput(startOAuthSchema, input);
  const channel = await loadEmailChannel(channelId);
  await requestEmailPollSoon(channel.id);
}

/**
 * «Desconectar»: the access is revoked where the provider allows it (Google), the stored credentials are deleted and
 * polling stops. Conversations stay; the channel goes back to «borrador» to be connected again ([CAN-16]).
 */
export async function disconnectEmailChannel(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const { channelId } = parseInput(startOAuthSchema, input);
  const channel = await loadEmailChannel(channelId);
  try {
    await emailProviderFor(channel.type as EmailChannelType).disconnect(channel, {});
  } catch {
    // Revoking is a courtesy: the credentials are deleted here anyway.
  }
  await cancelEmailJobs(channel.id);
  await updateEmailConfig(
    channel.id,
    (current) => ({
      reconnect: null,
      syncFailures: 0,
      mailboxDrafts: {},
      // The OAuth client (Client ID) stays so reconnecting only needs the secret again.
      gmail: { ...current.gmail, historyId: null, labelId: null },
      outlook: { ...current.outlook, inboxDeltaLink: null, sentDeltaLink: null },
      imap: { ...current.imap, inbox: null, sent: null },
    }),
    { extra: { status: "draft", secretsEnc: null, lastHealth: null, lastHealthAt: null } },
  );
  await writeAudit({ actor, action: "channel.disconnected", targetType: "channel", targetId: channel.id, metadata: { type: channel.type } });
}
