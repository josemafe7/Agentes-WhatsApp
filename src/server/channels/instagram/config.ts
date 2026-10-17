// What an Instagram channel stores ([CAN-17], [IG-01], docs/modelo-de-datos.md «Canales · Instagram»): the account's
// token, the Instagram app secret (and, if given, the Meta app secret) that sign its webhooks and the verify token of its
// webhook, encrypted in `channels.secrets_enc`; the account's public identity, when its token was set and until when it
// lasts, in `channels.config`. Config writes merge inside a transaction, so a job and a screen never drop each other's
// keys. Server only.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels } from "@/db/schema";
import { createInstagramClient, type InstagramClient } from "@/lib/instagram/client";
import { appUrl } from "@/server/app-url";
import { AppError } from "@/server/errors";
import { encryptChannelSecrets, readChannelSecrets } from "../secrets";
import type { ChannelRecord } from "../types";

const storedSecretsSchema = z.object({
  access_token: z.string().min(1).max(2_000),
  app_secret: z.string().min(1).max(200),
  meta_app_secret: z.string().min(1).max(200).nullish(),
  verify_token: z.string().min(16).max(200),
});

export type InstagramSecrets = { accessToken: string; appSecret: string; metaAppSecret: string | null; verifyToken: string };

/** The channel's decrypted secrets, or null (none, unreadable after a key change, or incomplete) ([SEG-03]). */
export function readInstagramSecrets(channel: Pick<ChannelRecord, "secretsEnc">): InstagramSecrets | null {
  const stored = readChannelSecrets(channel, storedSecretsSchema);
  return stored ? { accessToken: stored.access_token, appSecret: stored.app_secret, metaAppSecret: stored.meta_app_secret ?? null, verifyToken: stored.verify_token } : null;
}

/** `secrets_enc` for these secrets. */
export function encryptInstagramSecrets(secrets: InstagramSecrets): string {
  return encryptChannelSecrets({ access_token: secrets.accessToken, app_secret: secrets.appSecret, meta_app_secret: secrets.metaAppSecret, verify_token: secrets.verifyToken });
}

/** The secrets as the adapter returns them to be stored (the same keys). */
export function instagramSecretsRecord(secrets: InstagramSecrets): Record<string, unknown> {
  return { access_token: secrets.accessToken, app_secret: secrets.appSecret, meta_app_secret: secrets.metaAppSecret, verify_token: secrets.verifyToken };
}

/** Non-secret settings of an Instagram channel in `channels.config` (other keys there are kept as they are). */
export const instagramConfigSchema = z.object({
  /** `user_id` of /me: the professional account's id, the one webhooks carry; one channel per account ([IG-11]). */
  accountId: z.string().max(64).nullish().catch(null),
  /** Without «@». */
  username: z.string().max(100).nullish().catch(null),
  accountName: z.string().max(300).nullish().catch(null),
  /** When the current token was pasted or renewed, and until when it lasts ([IG-09]). ISO dates. */
  tokenSetAt: z.string().max(40).nullish().catch(null),
  tokenExpiresAt: z.string().max(40).nullish().catch(null),
  /** Renewals failed in a row. */
  refreshFailures: z.number().int().nonnegative().catch(0).default(0),
  /** When Meta last checked the webhook with the verify token. */
  webhookVerifiedAt: z.string().max(40).nullish().catch(null),
  /** Which secret signed the last valid webhook (§4.3: Meta does not say which one it uses). */
  signedWith: z.enum(["instagram", "meta"]).nullish().catch(null),
  /** If the AI's reply cannot be sent, the conversation goes to a person (read by the reply engine). */
  handoffOnSendFailure: z.boolean().catch(false).default(false),
});
export type InstagramConfig = z.infer<typeof instagramConfigSchema>;

export function readInstagramConfig(config: Record<string, unknown> | null | undefined): InstagramConfig {
  const parsed = instagramConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : instagramConfigSchema.parse({});
}

type ChannelColumns = Partial<Omit<typeof channels.$inferInsert, "id" | "config">>;

/** Merges `patch` into the channel's stored config (read and written in one transaction), plus other columns when given. */
export async function updateInstagramConfig(
  channelId: string,
  patch: Partial<InstagramConfig> | ((current: InstagramConfig) => Partial<InstagramConfig>),
  options: { executor?: Executor; extra?: ChannelColumns } = {},
): Promise<InstagramConfig> {
  const run = async (tx: Executor) => {
    const [row] = await tx.select({ config: channels.config }).from(channels).where(eq(channels.id, channelId));
    const current = row?.config ?? {};
    const resolved = typeof patch === "function" ? patch(readInstagramConfig(current)) : patch;
    const config = { ...current, ...Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined)) };
    await tx
      .update(channels)
      .set({ ...options.extra, config, updatedAt: new Date() })
      .where(eq(channels.id, channelId));
    return readInstagramConfig(config);
  };
  return options.executor ? run(options.executor) : db.transaction(run);
}

/** The channel cannot talk to Instagram: its token is missing or unreadable. */
export class InstagramNotConnectedError extends AppError {
  constructor() {
    super(409, "instagram_not_connected", "Falta el token de esta cuenta de Instagram. Vuelve a conectarla.");
  }
}

/** What every Instagram call may take for tests: a fake fetch and another base URL. */
export type InstagramDeps = { fetchImpl?: typeof fetch; baseUrl?: string; now?: () => Date };

/** A client with the channel's token. Throws InstagramNotConnectedError. */
export function instagramClientFor(channel: Pick<ChannelRecord, "secretsEnc">, deps: InstagramDeps = {}, secrets: InstagramSecrets | null = readInstagramSecrets(channel)): InstagramClient {
  if (!secrets) throw new InstagramNotConnectedError();
  return createInstagramClient({ accessToken: secrets.accessToken, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
}

/** Each account has its own webhook path: the channel is known before the body is read ([IG-02]). */
export const instagramWebhookPath = (channelId: string) => `/api/webhooks/instagram/${channelId}`;

/** Always built from APP_URL (the production domain, never a preview). */
export function instagramWebhookUrl(channelId: string): string {
  return appUrl(instagramWebhookPath(channelId));
}

/** https://instagram.com/<username>: the account's public page. */
export function instagramProfileLink(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

/** A token pasted by hand lasts 60 days from then (§2.2): its date is not known until the first renewal. */
export const TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60_000;
