// A WhatsApp channel's secrets and non-secret settings ([CAN-17], [SEG-01]). Secrets live encrypted in
// `channels.secrets_enc` as { access_token, app_secret, two_step_pin } (docs/modelo-de-datos.md «Canales»); the rest
// of what the channel needs is in its columns (identity, status) and in `channels.config` (below). Server only.
import "server-only";
import { z } from "zod";
import { createMetaGraphClient, type MetaGraphClient } from "@/lib/meta/client";
import { DEFAULT_GRAPH_API_VERSION } from "@/lib/meta/versions";
import { appUrl } from "@/server/app-url";
import { AppError } from "@/server/errors";
import { encryptChannelSecrets, readChannelSecrets } from "../secrets";
import type { ChannelRecord } from "../types";

/** Six digits: the two-step verification PIN ([WA-04], [WA-17]). */
export const PIN_PATTERN = /^\d{6}$/;

const storedSecretsSchema = z.object({
  access_token: z.string().min(1),
  app_secret: z.string().min(1),
  two_step_pin: z.string().regex(PIN_PATTERN).nullish(),
});

export type WhatsAppSecrets = { accessToken: string; appSecret: string; twoStepPin: string | null };

/** The channel's decrypted secrets, or null (none, unreadable after a key change, or incomplete) ([SEG-03]). */
export function readWhatsAppSecrets(channel: Pick<ChannelRecord, "secretsEnc">): WhatsAppSecrets | null {
  const stored = readChannelSecrets(channel, storedSecretsSchema);
  return stored ? { accessToken: stored.access_token, appSecret: stored.app_secret, twoStepPin: stored.two_step_pin ?? null } : null;
}

/** `secrets_enc` for these secrets. */
export function encryptWhatsAppSecrets(secrets: WhatsAppSecrets): string {
  return encryptChannelSecrets({ access_token: secrets.accessToken, app_secret: secrets.appSecret, ...(secrets.twoStepPin ? { two_step_pin: secrets.twoStepPin } : {}) });
}

/** Non-secret settings of a WhatsApp channel in `channels.config` (other keys there are kept as they are). */
export const whatsappConfigSchema = z.object({
  /** If the AI's reply cannot be sent, the conversation goes to a person ([WA-46]); a toggle of the WhatsApp panel. */
  handoffOnSendFailure: z.boolean().catch(false).default(false),
  /** «App publicada (Live)», ticked by hand: there is no API field for it (docs §4.5, [WA-21]). */
  appLiveConfirmed: z.boolean().catch(false).default(false),
  /** Last 131042 (payment method) seen on a send or status ([WA-51]). */
  lastPaymentErrorAt: z.string().nullish().catch(null),
  /** Service messages Meta delivered for free this month (UTC), ONLY for the payment alert, never for costs ([WA-51]). */
  freeServiceDelivered: z.object({ month: z.string(), count: z.number().int().nonnegative() }).nullish().catch(null),
  /** A service message failed after the month's free ones were used up ([WA-51]). */
  serviceFailedAfterFreeAt: z.string().nullish().catch(null),
});
export type WhatsAppConfig = z.infer<typeof whatsappConfigSchema>;

export function readWhatsAppConfig(config: Record<string, unknown> | null | undefined): WhatsAppConfig {
  const parsed = whatsappConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : whatsappConfigSchema.parse({});
}

/** The channel cannot talk to Meta: its credentials are missing or unreadable. */
export class WhatsAppNotConnectedError extends AppError {
  constructor() {
    super(409, "whatsapp_not_connected", "Faltan las credenciales de este número de WhatsApp. Vuelve a conectarlo.");
  }
}

/** What every WhatsApp call may take for tests: a fake fetch, another base URL, a clock and a sleep. */
export type WhatsAppDeps = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

/** A Graph client with the channel's token, app and version ([WA-49]). Throws WhatsAppNotConnectedError. */
export function graphClientFor(
  channel: Pick<ChannelRecord, "secretsEnc" | "metaAppId" | "graphApiVersion">,
  deps: WhatsAppDeps = {},
  secrets: WhatsAppSecrets | null = readWhatsAppSecrets(channel),
): MetaGraphClient {
  if (!secrets) throw new WhatsAppNotConnectedError();
  return createMetaGraphClient({
    accessToken: secrets.accessToken,
    appId: channel.metaAppId,
    appSecret: secrets.appSecret,
    version: channel.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION,
    baseUrl: deps.baseUrl,
    fetchImpl: deps.fetchImpl,
  });
}

/** The installation's single webhook path ([WA-12]); the full URL is always built from APP_URL (never a preview). */
export const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp";

export function whatsappWebhookUrl(): string {
  return appUrl(WHATSAPP_WEBHOOK_PATH);
}
