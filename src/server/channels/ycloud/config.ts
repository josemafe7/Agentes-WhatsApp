// What a WhatsApp number connected through YCloud stores ([CAN-17], [SEG-01], docs/modelo-de-datos.md «Canales ·
// YCloud»): the account's API key and the secret of the channel's webhook, encrypted in `channels.secrets_enc` as
// { api_key, webhook_secret }; the number and its state in the channel's WhatsApp columns (`connection_mode` «ycloud»),
// and what is YCloud's own in `channels.config`. Server only.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels } from "@/db/schema";
import { phoneDigits } from "@/lib/meta/markets";
import { createYCloudClient, type YCloudClient } from "@/lib/ycloud/client";
import { appUrl } from "@/server/app-url";
import { AppError } from "@/server/errors";
import { encryptChannelSecrets, readChannelSecrets } from "../secrets";
import type { ChannelRecord } from "../types";

const storedSecretsSchema = z.object({ api_key: z.string().min(1), webhook_secret: z.string().min(1).nullish() });

export type YCloudSecrets = { apiKey: string; webhookSecret: string | null };

/** The channel's decrypted secrets, or null (none, unreadable after a key change, or incomplete) ([SEG-03]). */
export function readYCloudSecrets(channel: Pick<ChannelRecord, "secretsEnc">): YCloudSecrets | null {
  const stored = readChannelSecrets(channel, storedSecretsSchema);
  return stored ? { apiKey: stored.api_key, webhookSecret: stored.webhook_secret ?? null } : null;
}

/** `secrets_enc` for these secrets. */
export function encryptYCloudSecrets(secrets: YCloudSecrets): string {
  return encryptChannelSecrets({ api_key: secrets.apiKey, ...(secrets.webhookSecret ? { webhook_secret: secrets.webhookSecret } : {}) });
}

/** Non-secret settings of a YCloud channel in `channels.config` (other keys there are kept as they are). */
export const ycloudConfigSchema = z.object({
  /** The number in E.164 («+34600111222»): the `from` of every send. */
  ycloudPhoneNumber: z.string().max(40).nullish().catch(null),
  /** The webhook endpoint the app created in YCloud for this channel ([YC-03]). */
  ycloudWebhookEndpointId: z.string().max(255).nullish().catch(null),
  /** The account's balance at the last check, for the panel ([YC-09]). */
  ycloudBalance: z.object({ amount: z.number(), currency: z.string().max(10).nullable(), at: z.string().max(40) }).nullish().catch(null),
  /** If the AI's reply cannot be sent, the conversation goes to a person (read by the reply engine). */
  handoffOnSendFailure: z.boolean().catch(false).default(false),
});
export type YCloudConfig = z.infer<typeof ycloudConfigSchema>;

export function readYCloudConfig(config: Record<string, unknown> | null | undefined): YCloudConfig {
  const parsed = ycloudConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : ycloudConfigSchema.parse({});
}

type ChannelColumns = Partial<Omit<typeof channels.$inferInsert, "id" | "config">>;

/** Merges `patch` into the channel's stored config (read and written in one transaction), plus other columns. */
export async function updateYCloudConfig(channelId: string, patch: Partial<YCloudConfig>, options: { executor?: Executor; extra?: ChannelColumns } = {}): Promise<void> {
  const run = async (tx: Executor) => {
    const [row] = await tx.select({ config: channels.config }).from(channels).where(eq(channels.id, channelId));
    const config = { ...(row?.config ?? {}), ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
    await tx.update(channels).set({ ...options.extra, config, updatedAt: new Date() }).where(eq(channels.id, channelId));
  };
  await (options.executor ? run(options.executor) : db.transaction(run));
}

/** The channel cannot talk to YCloud: its key is missing or unreadable. */
export class YCloudNotConnectedError extends AppError {
  constructor() {
    super(409, "ycloud_not_connected", "Falta la clave de YCloud de este número. Vuelve a conectarlo.");
  }
}

/** What every YCloud call may take for tests: a fake fetch, another base URL, a clock and a sleep. */
export type YCloudDeps = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

/** A YCloud client with the channel's key. Throws YCloudNotConnectedError. */
export function ycloudClientFor(channel: Pick<ChannelRecord, "secretsEnc">, deps: YCloudDeps = {}, secrets: YCloudSecrets | null = readYCloudSecrets(channel)): YCloudClient {
  if (!secrets) throw new YCloudNotConnectedError();
  return createYCloudClient({ apiKey: secrets.apiKey, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
}

/** The number of the channel as YCloud wants it (E.164 with «+»), or null while none was chosen. */
export function ycloudNumberOf(channel: Pick<ChannelRecord, "config">): string | null {
  return readYCloudConfig(channel.config).ycloudPhoneNumber ?? null;
}

/**
 * What goes in the channel's `phone_number_id`, which is unique in the installation ([WA-11]): never the id Meta gives
 * a number (digits), so Meta's own webhook can never take this channel for one of its own.
 */
export const ycloudPhoneNumberId = (phoneNumber: string) => `ycloud:${phoneDigits(phoneNumber)}`;

/** Each channel has its own webhook path: the channel is known before the body is read ([YC-05]). */
export const ycloudWebhookPath = (channelId: string) => `/api/webhooks/ycloud/${channelId}`;

/** Always built from APP_URL (the production domain, never a preview). */
export function ycloudWebhookUrl(channelId: string): string {
  return appUrl(ycloudWebhookPath(channelId));
}
