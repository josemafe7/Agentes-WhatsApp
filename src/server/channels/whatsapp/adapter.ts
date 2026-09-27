// WhatsAppAdapter: the Cloud API behind the common ChannelAdapter contract ([CAN-09]–[CAN-17], [WA-*]). Registered
// in src/server/channels/registry.ts. Demo WhatsApp channels never get here (they use the DemoAdapter, [ARR-11]),
// nor do replies to simulated messages ([AJU-13]). The webhook route verifies signatures and routes changes to their
// channels (webhook.ts); handleWebhook only turns an already verified body into this channel's events.
import "server-only";
import { z } from "zod";
import type { FileStorage } from "@/server/adapters/file-storage";
import { DEFAULT_CAPABILITIES } from "../capabilities";
import { ChannelSendError, type ChannelAdapter, type ChannelRecord, type NormalizedEvent, type OutboundMessage } from "../types";
import { graphClientFor, PIN_PATTERN, readWhatsAppSecrets, WhatsAppNotConnectedError, type WhatsAppDeps } from "./config";
import { validateWhatsAppConnection } from "./connect";
import { recordMetaFailure } from "./failures";
import { checkWhatsAppHealth } from "./health";
import { downloadWhatsAppMedia } from "./media";
import { normalizeWhatsAppWebhook } from "./normalize";
import { unsubscribeWabaIfUnused } from "./numbers";
import { chooseDestination, loadDestination, sendWithRetries } from "./send";

export type WhatsAppAdapterDeps = WhatsAppDeps & { storage?: FileStorage };

/** What validateAndConnect accepts; missing values come from what the channel already has (Revalidar). */
const connectInputSchema = z
  .object({
    accessToken: z.string().trim().min(1).max(2_000).optional(),
    appSecret: z.string().trim().min(1).max(200).optional(),
    phoneNumberId: z.string().trim().regex(/^\d{1,32}$/).optional(),
    appId: z.string().trim().regex(/^\d{1,32}$/).optional(),
    wabaId: z.string().trim().regex(/^\d{1,32}$/).optional(),
    twoStepPin: z.string().regex(PIN_PATTERN).optional(),
    graphApiVersion: z.string().trim().max(10).optional(),
  })
  .strict();

function phoneNumberIdOf(channel: ChannelRecord): string {
  if (!channel.phoneNumberId) throw new ChannelSendError("El número de WhatsApp no está conectado.", false);
  return channel.phoneNumberId;
}

function clientOrSendError(channel: ChannelRecord, deps: WhatsAppDeps) {
  try {
    return graphClientFor(channel, deps);
  } catch (error) {
    if (error instanceof WhatsAppNotConnectedError) throw new ChannelSendError(error.userMessage, false);
    throw error;
  }
}

/** This channel's events of a verified body: messages and statuses of its number, notices of its WABA. */
export function eventsForChannel(channel: Pick<ChannelRecord, "phoneNumberId" | "wabaId">, body: unknown): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const change of normalizeWhatsAppWebhook(body) ?? []) {
    if (change.kind === "messages" && change.phoneNumberId === channel.phoneNumberId) events.push(...change.inbound, ...change.statuses, ...change.errors);
    else if (change.kind === "account" && change.wabaId === channel.wabaId) events.push(change.event);
  }
  return events;
}

export function createWhatsAppAdapter(deps: WhatsAppAdapterDeps = {}): ChannelAdapter {
  return {
    type: "whatsapp",
    capabilities: () => DEFAULT_CAPABILITIES.whatsapp,

    async validateAndConnect(channel, input) {
      const parsed = connectInputSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: "Revisa los datos de conexión de WhatsApp." };
      const stored = readWhatsAppSecrets(channel);
      const accessToken = parsed.data.accessToken ?? stored?.accessToken;
      const phoneNumberId = parsed.data.phoneNumberId ?? channel.phoneNumberId;
      if (!accessToken || !phoneNumberId) return { ok: false, error: "Faltan el token o el Phone Number ID." };
      const result = await validateWhatsAppConnection(
        {
          accessToken,
          appSecret: parsed.data.appSecret ?? stored?.appSecret ?? null,
          phoneNumberId,
          appId: parsed.data.appId ?? channel.metaAppId,
          wabaId: parsed.data.wabaId ?? channel.wabaId,
          graphApiVersion: parsed.data.graphApiVersion ?? channel.graphApiVersion,
        },
        deps,
      );
      if (!result.ok) return { ok: false, error: result.error };
      const twoStepPin = parsed.data.twoStepPin ?? stored?.twoStepPin ?? null;
      // The identity columns are written by src/data/whatsapp.ts from validateWhatsAppConnection's result.
      return { ok: true, config: {}, secrets: { access_token: accessToken, app_secret: result.appSecret, ...(twoStepPin ? { two_step_pin: twoStepPin } : {}) } };
    },

    async healthCheck(channel) {
      return (await checkWhatsAppHealth(channel, deps)).health;
    },

    async handleWebhook(channel, input) {
      return eventsForChannel(channel, input.body);
    },

    async send(channel: ChannelRecord, message: OutboundMessage) {
      const phoneNumberId = phoneNumberIdOf(channel);
      const client = clientOrSendError(channel, deps);
      const destination =
        (await loadDestination(message.conversationId)) ?? chooseDestination(message.recipient.externalIds.map((externalId) => ({ externalId, phone: null })));
      if (!destination) throw new ChannelSendError("El contacto no tiene un identificador de WhatsApp al que escribir.", false);
      try {
        return await sendWithRetries(client, phoneNumberId, destination, message, deps);
      } catch (error) {
        if (error instanceof ChannelSendError && typeof error.channelCode === "number") {
          await recordMetaFailure(channel, { conversationId: message.conversationId, code: error.channelCode, serviceMessage: message.contentType !== "template", now: deps.now?.() ?? new Date() });
        }
        throw error;
      }
    },

    async downloadMedia(channel, ref) {
      const file = await downloadWhatsAppMedia(graphClientFor(channel, deps), { mediaId: ref.externalMediaId, mimeType: ref.mimeType, phoneNumberId: channel.phoneNumberId });
      return { bytes: file.bytes, mimeType: file.mimeType };
    },

    async markRead(channel, externalMessageId) {
      await graphClientFor(channel, deps).markRead(phoneNumberIdOf(channel), externalMessageId);
    },

    async sendTyping(channel, externalMessageId) {
      // It also marks the message as read; shown only while the AI prepares a reply ([WA-45]).
      await graphClientFor(channel, deps).markRead(phoneNumberIdOf(channel), externalMessageId, { typing: true });
    },

    async disconnect(channel, options) {
      if (!options?.deregister || !channel.phoneNumberId) return;
      const client = graphClientFor(channel, deps);
      // The app's own subscription (/{APP_ID}/subscriptions) stays: every number of the app shares it (§6.5).
      await unsubscribeWabaIfUnused(client, channel);
      await client.deregister(channel.phoneNumberId);
    },
  };
}

export const whatsappAdapter = createWhatsAppAdapter();
