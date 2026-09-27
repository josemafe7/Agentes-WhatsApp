// The WhatsApp panel of a channel ([WA-20], [WA-21], [WA-26]–[WA-28], [WA-46], [WA-51]): what it shows (never a whole
// secret: owner and admin see them masked, [PER-07]), its own settings (hand-off when a send fails, the «App
// publicada» and «Método de pago» checks) and «Desconectar». Seeing it is «Canales: ver»; changing, «Canales: …
// configurar, desconectar» (owner, admin).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, whatsappTemplates, type ChannelHealth, type RegisterAttempt } from "@/db/schema";
import { isMetaGraphError } from "@/lib/meta/errors";
import { graphVersionStatus, type GraphVersionStatus } from "@/lib/meta/versions";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import type { ChannelRecord } from "@/server/channels/types";
import { createWhatsAppAdapter } from "@/server/channels/whatsapp/adapter";
import { readWhatsAppConfig, readWhatsAppSecrets, type WhatsAppConfig, type WhatsAppDeps } from "@/server/channels/whatsapp/config";
import { REREGISTER_DAYS } from "@/server/channels/whatsapp/health";
import { registerAttemptsLeft, withAttempt } from "@/server/channels/whatsapp/numbers";
import { cancelWhatsAppJobs } from "@/server/channels/whatsapp/schedule";
import { maskSecret } from "@/server/crypto";
import { parseInput } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { loadWhatsAppChannel } from "./whatsapp";

const DAY_MS = 24 * 60 * 60_000;
/** A payment error this recent still shows the alert ([WA-51]). */
const PAYMENT_ALERT_DAYS = 30;

// ─── Panel ([WA-20], [WA-26], [WA-51]) ──────────────────────────────────────────────────────────────────

export type WhatsAppPanel = {
  id: string;
  name: string;
  status: ChannelRecord["status"];
  isMetaTestNumber: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  metaAppId: string | null;
  metaBusinessId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  messagingLimit: string | null;
  graphApiVersion: string | null;
  version: GraphVersionStatus;
  webhookStatus: string | null;
  tokenExpiresAt: Date | null;
  lastHealth: ChannelHealth | null;
  lastHealthAt: Date | null;
  lastInboundAt: Date | null;
  /** Re-register before this date after an approved name change ([WA-20]); null when not pending. */
  reregisterBy: Date | null;
  register: { left: number; nextFreeAt: Date | null; lastAttempt: RegisterAttempt | null };
  paymentMethodConfirmedAt: Date | null;
  /** «Puede que falte el método de pago en Meta» ([WA-51]). */
  paymentAlert: boolean;
  config: Pick<WhatsAppConfig, "handoffOnSendFailure" | "appLiveConfirmed">;
  /** Masked for owner and admin only ([PER-07]); null for everyone else or when missing. */
  secrets: { accessToken: string | null; appSecret: string | null; hasPin: boolean } | null;
  hasCredentials: boolean;
  templates: number;
};

export async function getWhatsAppPanel(actor: Actor, channelId: string): Promise<WhatsAppPanel> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true });
  const now = new Date();
  const secrets = readWhatsAppSecrets(channel);
  const config = readWhatsAppConfig(channel.config);
  const recentPayment = [config.lastPaymentErrorAt, config.serviceFailedAfterFreeAt].some((iso) => iso && now.getTime() - new Date(iso).getTime() <= PAYMENT_ALERT_DAYS * DAY_MS);
  const templates = await db.select({ id: whatsappTemplates.id }).from(whatsappTemplates).where(eq(whatsappTemplates.channelId, channel.id));
  return {
    id: channel.id,
    name: channel.name,
    status: channel.status,
    isMetaTestNumber: channel.isMetaTestNumber,
    phoneNumberId: channel.phoneNumberId,
    wabaId: channel.wabaId,
    metaAppId: channel.metaAppId,
    metaBusinessId: channel.metaBusinessId,
    displayPhoneNumber: channel.displayPhoneNumber,
    verifiedName: channel.verifiedName,
    qualityRating: channel.qualityRating,
    nameStatus: channel.nameStatus,
    codeVerificationStatus: channel.codeVerificationStatus,
    messagingLimit: channel.messagingLimit,
    graphApiVersion: channel.graphApiVersion,
    version: graphVersionStatus(channel.graphApiVersion, now),
    webhookStatus: channel.webhookStatus,
    tokenExpiresAt: channel.tokenExpiresAt,
    lastHealth: channel.lastHealth,
    lastHealthAt: channel.lastHealthAt,
    lastInboundAt: channel.lastInboundAt,
    reregisterBy: channel.nameApprovedAt ? new Date(channel.nameApprovedAt.getTime() + REREGISTER_DAYS * DAY_MS) : null,
    register: { ...registerAttemptsLeft(channel.registerAttempts, now), lastAttempt: channel.registerAttempts.at(-1) ?? null },
    paymentMethodConfirmedAt: channel.paymentMethodConfirmedAt,
    paymentAlert: recentPayment,
    config: { handoffOnSendFailure: config.handoffOnSendFailure, appLiveConfirmed: config.appLiveConfirmed },
    secrets: can(actor, PERMISSIONS.secrets.viewMasked)
      ? { accessToken: secrets ? maskSecret(secrets.accessToken) : null, appSecret: secrets ? maskSecret(secrets.appSecret) : null, hasPin: Boolean(secrets?.twoStepPin) }
      : null,
    hasCredentials: secrets !== null,
    templates: templates.length,
  };
}

// ─── Settings of the panel ([WA-21], [WA-46]) ───────────────────────────────────────────────────────────

export const whatsappSettingsSchema = z
  .object({
    /** If the AI's reply cannot be sent, the conversation goes to a person ([WA-46]). */
    handoffOnSendFailure: z.boolean().optional(),
    /** «App publicada (Live)», ticked by hand ([WA-21]). */
    appLiveConfirmed: z.boolean().optional(),
    /** «Método de pago en WhatsApp Manager», confirmed by hand ([WA-21]). */
    paymentMethodConfirmed: z.boolean().optional(),
  })
  .strict();

export async function updateWhatsAppSettings(actor: Actor, channelId: string, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(whatsappSettingsSchema, input);
  // Only settings of the app: a demo channel may have them too.
  const channel = await loadWhatsAppChannel(channelId, { allowDemo: true });
  const config = {
    ...channel.config,
    ...(data.handoffOnSendFailure !== undefined ? { handoffOnSendFailure: data.handoffOnSendFailure } : {}),
    ...(data.appLiveConfirmed !== undefined ? { appLiveConfirmed: data.appLiveConfirmed } : {}),
  };
  const payment = data.paymentMethodConfirmed === undefined ? {} : { paymentMethodConfirmedAt: data.paymentMethodConfirmed ? new Date() : null };
  await db.update(channels).set({ config, ...payment, updatedAt: new Date() }).where(eq(channels.id, channel.id));
  await writeAudit({ actor, action: "channel.configured", targetType: "channel", targetId: channel.id, metadata: { fields: Object.keys(data) } });
}

// ─── Disconnect ([WA-28]) ───────────────────────────────────────────────────────────────────────────────

export const disconnectWhatsAppSchema = z
  .object({
    /** Also remove the WABA subscription (if no other number uses it) and deregister the number in Meta. */
    removeFromMeta: z.boolean().default(false),
  })
  .strict();

export type DisconnectWhatsAppResult = { removedFromMeta: boolean; warning: string | null };

/** Deletes the credentials (the channel keeps its history, «desactivado») and, if confirmed, leaves Meta too. */
export async function disconnectWhatsAppChannel(actor: Actor, channelId: string, input: unknown, deps: WhatsAppDeps = {}): Promise<DisconnectWhatsAppResult> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(disconnectWhatsAppSchema, input);
  const channel = await loadWhatsAppChannel(channelId);
  const now = new Date();
  let warning: string | null = null;
  let removedFromMeta = false;
  let attempts = channel.registerAttempts;
  if (data.removeFromMeta && readWhatsAppSecrets(channel)) {
    if (registerAttemptsLeft(attempts, now).left === 0) {
      warning = "No se ha dado de baja el número en Meta: se han agotado los intentos de las últimas 72 horas.";
    } else {
      try {
        await createWhatsAppAdapter(deps).disconnect(channel, { deregister: true });
        removedFromMeta = true;
        attempts = withAttempt(attempts, { at: now.toISOString(), ok: true }, now);
      } catch (error) {
        const code = isMetaGraphError(error) ? error.code : null;
        attempts = withAttempt(attempts, { at: now.toISOString(), ok: false, ...(code !== null ? { code } : {}) }, now);
        warning = `No se ha podido dar de baja el número en Meta: ${isMetaGraphError(error) ? error.userMessage : "error inesperado"}`;
        if (!isMetaGraphError(error)) console.error(`[whatsapp] Baja en Meta fallida: ${safeErrorMessage(error)}`);
      }
    }
  }
  await db
    .update(channels)
    .set({ secretsEnc: null, status: "disabled", webhookStatus: null, registerAttempts: attempts, updatedAt: now })
    .where(eq(channels.id, channel.id));
  await cancelWhatsAppJobs(channel.id);
  await writeAudit({ actor, action: "channel.disconnected", targetType: "channel", targetId: channel.id, metadata: { type: "whatsapp", removedFromMeta } });
  return { removedFromMeta, warning };
}
