// What an email channel stores (docs/integracion-correo.md §6, docs/modelo-de-datos.md «Canales · Correo»): the
// non-secret settings and sync cursors in `channels.config`, and every token, client secret and password encrypted in
// `channels.secrets_enc` ([CAN-17], [SEG-01]). Config writes merge inside a transaction so a poll and a screen never
// drop each other's keys. Server only.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels } from "@/db/schema";
import type { ChannelType } from "@/lib/enums";
import { encryptChannelSecrets, readChannelSecrets } from "../secrets";
import type { ChannelRecord } from "../types";
import { DEFAULT_DAILY_CAP_PER_SENDER, DEFAULT_DAILY_CAP_PER_THREAD, MAX_DAILY_CAP, MAX_SIGNATURE } from "./constants";

export const EMAIL_CHANNEL_TYPES = ["email_gmail", "email_outlook", "email_imap"] as const satisfies readonly ChannelType[];
export type EmailChannelType = (typeof EMAIL_CHANNEL_TYPES)[number];

export function isEmailChannelType(type: string): type is EmailChannelType {
  return (EMAIL_CHANNEL_TYPES as readonly string[]).includes(type);
}


const isoDate = z.string().max(40);
const cap = (fallback: number) => z.number().int().min(1).max(MAX_DAILY_CAP).catch(fallback).default(fallback);

const gmailStateSchema = z
  .object({
    clientId: z.string().max(300).nullish(),
    /** Stable account id from the id_token ([F4]). */
    sub: z.string().max(255).nullish(),
    /** Where history.list starts next time ([F13]). */
    historyId: z.string().max(40).nullish(),
    /** Id of the «IA/Respondido» label ([COR-06]). */
    labelId: z.string().max(200).nullish(),
    /** Time-limited access granted by the person ([F1]). */
    refreshTokenExpiresAt: isoDate.nullish(),
  })
  .catch({});

const outlookStateSchema = z
  .object({
    clientId: z.string().max(300).nullish(),
    /** `common` or the business's tenant ([COR-07]). */
    tenant: z.string().max(255).nullish(),
    userId: z.string().max(255).nullish(),
    inboxDeltaLink: z.string().max(4_000).nullish(),
    sentDeltaLink: z.string().max(4_000).nullish(),
    /** Delta rounds only bring what was received since this moment (the connection) ([F39]). */
    syncedSince: isoDate.nullish(),
    /** Microsoft makes Client Secrets last 24 months at most ([F35], [COR-07]). */
    clientSecretExpiresAt: isoDate.nullish(),
    /** Last «caduca pronto» notice, so it is given once ([COR-22]). */
    secretWarnedAt: isoDate.nullish(),
  })
  .catch({});

export const MAIL_SECURITY = ["tls", "starttls"] as const;
export type MailSecurity = (typeof MAIL_SECURITY)[number];
const folderCursorSchema = z.object({ uidValidity: z.string().max(40), lastUid: z.number().int().nonnegative() });
export type FolderCursor = z.infer<typeof folderCursorSchema>;

const imapStateSchema = z
  .object({
    imapHost: z.string().max(253).nullish(),
    imapPort: z.number().int().nullish(),
    imapSecurity: z.enum(MAIL_SECURITY).nullish(),
    smtpHost: z.string().max(253).nullish(),
    smtpPort: z.number().int().nullish(),
    smtpSecurity: z.enum(MAIL_SECURITY).nullish(),
    username: z.string().max(320).nullish(),
    smtpUsername: z.string().max(320).nullish(),
    /** Folders by SPECIAL-USE, or by usual names when the server has no SPECIAL-USE ([COR-13]). */
    sentPath: z.string().max(500).nullish(),
    draftsPath: z.string().max(500).nullish(),
    /** The server keeps a copy of what SMTP sends (Gmail does, [F25]): no APPEND. */
    savesSent: z.boolean().nullish(),
    inbox: folderCursorSchema.nullish(),
    sent: folderCursorSchema.nullish(),
    /** IMAP IDLE in the VPS worker instead of waiting for the next poll ([F71]). */
    idle: z.boolean().nullish(),
  })
  .catch({});

/** A draft the app left in the mailbox for a draft reply of ours ([COR-14]): created by the poll, sent on approval. */
const mailboxDraftSchema = z.object({ draftId: z.string().max(1_024), rfcMessageId: z.string().max(400), createdAt: isoDate });
export type MailboxDraft = z.infer<typeof mailboxDraftSchema>;

export const emailConfigSchema = z.object({
  /** The mailbox address (lower case). */
  emailAddress: z.string().max(254).nullish().catch(null),
  /** Signature added to the AI's emails, followed by the AI notice ([COR-21]). */
  signature: z.string().max(MAX_SIGNATURE).nullish().catch(null),
  dailyCapPerThread: cap(DEFAULT_DAILY_CAP_PER_THREAD),
  dailyCapPerSender: cap(DEFAULT_DAILY_CAP_PER_SENDER),
  grantedScopes: z.array(z.string().max(300)).max(50).catch([]).default([]),
  /** «Requiere reconexión» ([COR-22]): why, and since when. */
  reconnect: z.object({ at: isoDate, reason: z.string().max(500) }).nullish().catch(null),
  lastSyncAt: isoDate.nullish().catch(null),
  /** Polls failed in a row (not reconnect errors): at 3 the channel goes to «error» ([CAN-15]). */
  syncFailures: z.number().int().nonnegative().catch(0).default(0),
  /** Ignored emails by reason, for Diagnóstico ([COR-16]). */
  ignored: z.record(z.string().max(40), z.number().int().nonnegative()).catch({}).default({}),
  mailboxDrafts: z.record(z.string().max(40), mailboxDraftSchema).catch({}).default({}),
  gmail: gmailStateSchema.default({}),
  outlook: outlookStateSchema.default({}),
  imap: imapStateSchema.default({}),
});
export type EmailConfig = z.infer<typeof emailConfigSchema>;
export type EmailConfigPatch = Partial<Omit<EmailConfig, "gmail" | "outlook" | "imap">> & {
  gmail?: Partial<EmailConfig["gmail"]>;
  outlook?: Partial<EmailConfig["outlook"]>;
  imap?: Partial<EmailConfig["imap"]>;
};

export function readEmailConfig(config: Record<string, unknown> | null | undefined): EmailConfig {
  const parsed = emailConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : emailConfigSchema.parse({});
}

/** `current` with `patch` merged, one level deep for the provider objects. Other keys of config are kept. */
export function mergeEmailConfig(current: Record<string, unknown>, patch: EmailConfigPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const nested = key === "gmail" || key === "outlook" || key === "imap";
    const previous = current[key];
    next[key] = nested && previous && typeof previous === "object" && !Array.isArray(previous) ? { ...previous, ...(value as object) } : value;
  }
  return next;
}

type ChannelColumns = Partial<Omit<typeof channels.$inferInsert, "id" | "config">>;

/**
 * Merges `patch` into the channel's stored config (read and written in one transaction), plus other columns of the
 * channel when `extra` is given (decided from the current config when it is a function). Returns the new config.
 */
export async function updateEmailConfig(
  channelId: string,
  patch: EmailConfigPatch | ((current: EmailConfig) => EmailConfigPatch),
  options: { executor?: Executor; extra?: ChannelColumns | ((current: EmailConfig) => ChannelColumns) } = {},
): Promise<Record<string, unknown>> {
  const run = async (tx: Executor) => {
    const [row] = await tx.select({ config: channels.config }).from(channels).where(eq(channels.id, channelId));
    const current = row?.config ?? {};
    const parsed = readEmailConfig(current);
    const resolved = typeof patch === "function" ? patch(parsed) : patch;
    const extra = typeof options.extra === "function" ? options.extra(parsed) : options.extra;
    const config = mergeEmailConfig(current, resolved);
    await tx.update(channels).set({ ...extra, config, updatedAt: new Date() }).where(eq(channels.id, channelId));
    return config;
  };
  return options.executor ? run(options.executor) : db.transaction(run);
}

// ─── Secrets ────────────────────────────────────────────────────────────────────────────────────────────

const oauthSecretsSchema = z.object({
  client_secret: z.string().min(1),
  refresh_token: z.string().min(1).nullish(),
  access_token: z.string().min(1).nullish(),
  /** ISO time the access token stops working. */
  access_expires_at: z.string().nullish(),
});
export type OAuthSecrets = { clientSecret: string; refreshToken: string | null; accessToken: string | null; accessExpiresAt: Date | null };

const imapSecretsSchema = z.object({ password: z.string().min(1), smtp_password: z.string().min(1).nullish() });
export type MailPasswords = { password: string; smtpPassword: string | null };

/** Gmail and Outlook: the OAuth client secret and tokens; null if missing or unreadable ([SEG-03]). */
export function readOAuthSecrets(channel: Pick<ChannelRecord, "secretsEnc">): OAuthSecrets | null {
  const stored = readChannelSecrets(channel, oauthSecretsSchema);
  if (!stored) return null;
  const expires = stored.access_expires_at ? new Date(stored.access_expires_at) : null;
  return {
    clientSecret: stored.client_secret,
    refreshToken: stored.refresh_token ?? null,
    accessToken: stored.access_token ?? null,
    accessExpiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
  };
}

export function encryptOAuthSecrets(secrets: OAuthSecrets): string {
  return encryptChannelSecrets({
    client_secret: secrets.clientSecret,
    ...(secrets.refreshToken ? { refresh_token: secrets.refreshToken } : {}),
    ...(secrets.accessToken ? { access_token: secrets.accessToken } : {}),
    ...(secrets.accessExpiresAt ? { access_expires_at: secrets.accessExpiresAt.toISOString() } : {}),
  });
}

export function readMailPasswords(channel: Pick<ChannelRecord, "secretsEnc">): MailPasswords | null {
  const stored = readChannelSecrets(channel, imapSecretsSchema);
  return stored ? { password: stored.password, smtpPassword: stored.smtp_password ?? null } : null;
}

export function encryptMailPasswords(passwords: MailPasswords): string {
  return encryptChannelSecrets({ password: passwords.password, ...(passwords.smtpPassword ? { smtp_password: passwords.smtpPassword } : {}) });
}

/** Lower-case address of the mailbox, or null. */
export function mailboxAddress(channel: Pick<ChannelRecord, "config">): string | null {
  return readEmailConfig(channel.config).emailAddress?.toLowerCase() ?? null;
}
