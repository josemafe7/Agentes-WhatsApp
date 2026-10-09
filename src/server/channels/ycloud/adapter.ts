// YCloudAdapter: a WhatsApp number through YCloud behind the common ChannelAdapter contract ([CAN-09]–[CAN-17],
// [YC-*]). The registry gives it to the WhatsApp channels whose `connection_mode` is «ycloud»
// (src/server/channels/registry.ts). Demo channels never get here ([ARR-11]), nor do replies to simulated messages
// ([AJU-13]). The webhook route checks the signature (webhook.ts); handleWebhook only turns an already verified event
// into this channel's events.
import "server-only";
import { z } from "zod";
import type { FileStorage } from "@/server/adapters/file-storage";
import { DEFAULT_CAPABILITIES } from "../capabilities";
import { ChannelSendError, type ChannelAdapter, type ChannelRecord, type NormalizedEvent, type OutboundMessage } from "../types";
import { recordMetaFailure, WINDOW_CLOSED_CODE } from "../whatsapp/failures";
import { chooseDestination, loadDestination } from "../whatsapp/send";
import { readYCloudConfig, readYCloudSecrets, ycloudClientFor, ycloudNumberOf, YCloudNotConnectedError, type YCloudDeps } from "./config";
import { validateYCloudKey } from "./connect";
import { checkYCloudHealth } from "./health";
import { ycloudMediaCap } from "./media";
import { normalizeYCloudEvent } from "./normalize";
import { sendYCloudMessage } from "./send";

export type YCloudAdapterDeps = YCloudDeps & { storage?: FileStorage };

/** What validateAndConnect accepts; without a key it checks the one the channel already has (Revalidar). */
const connectInputSchema = z.object({ apiKey: z.string().trim().min(1).max(500).optional(), phoneNumber: z.string().trim().min(5).max(40).optional() }).strict();

function clientOrSendError(channel: ChannelRecord, deps: YCloudDeps) {
  try {
    return ycloudClientFor(channel, deps);
  } catch (error) {
    if (error instanceof YCloudNotConnectedError) throw new ChannelSendError(error.userMessage, false);
    throw error;
  }
}

export function createYCloudAdapter(deps: YCloudAdapterDeps = {}): ChannelAdapter {
  return {
    type: "whatsapp",
    // The official API all the same: templates, the 24 h window and everything else ([WA-55]).
    capabilities: () => DEFAULT_CAPABILITIES.whatsapp,

    async validateAndConnect(channel, input) {
      const parsed = connectInputSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: "Revisa los datos de conexión de YCloud." };
      const stored = readYCloudSecrets(channel);
      const apiKey = parsed.data.apiKey ?? stored?.apiKey;
      const phoneNumber = parsed.data.phoneNumber ?? ycloudNumberOf(channel);
      if (!apiKey || !phoneNumber) return { ok: false, error: "Faltan la clave de YCloud o el número." };
      const result = await validateYCloudKey(apiKey, deps);
      if (!result.ok) return { ok: false, error: result.error };
      if (!result.numbers.some((number) => number.phoneNumber === phoneNumber)) return { ok: false, error: "Ese número no está en esta cuenta de YCloud." };
      // The webhook endpoint and its secret are created by src/data/ycloud.ts, which also stores them.
      return { ok: true, config: { ycloudPhoneNumber: phoneNumber }, secrets: { api_key: apiKey, ...(stored?.webhookSecret ? { webhook_secret: stored.webhookSecret } : {}) } };
    },

    async healthCheck(channel) {
      return (await checkYCloudHealth(channel, deps)).health;
    },

    async handleWebhook(_channel, input) {
      const change = normalizeYCloudEvent(input.body)?.change;
      const events: NormalizedEvent[] = [];
      if (change?.kind === "inbound" && change.outcome.event) events.push(change.outcome.event);
      if (change?.kind === "status") events.push(change.status);
      return events;
    },

    async send(channel: ChannelRecord, message: OutboundMessage) {
      const client = clientOrSendError(channel, deps);
      const phoneNumber = readYCloudConfig(channel.config).ycloudPhoneNumber;
      if (!phoneNumber) throw new ChannelSendError("El número de WhatsApp no está conectado.", false);
      const destination =
        (await loadDestination(message.conversationId)) ?? chooseDestination(message.recipient.externalIds.map((externalId) => ({ externalId, phone: null })));
      if (!destination) throw new ChannelSendError("El contacto no tiene un identificador de WhatsApp al que escribir.", false);
      try {
        return await sendYCloudMessage(client, phoneNumber, destination, message, deps);
      } catch (error) {
        // Meta closing the window (131047) wins over our own count, as with the direct connection ([WA-43]).
        if (error instanceof ChannelSendError && error.channelCode === WINDOW_CLOSED_CODE) {
          await recordMetaFailure(channel, { conversationId: message.conversationId, code: WINDOW_CLOSED_CODE, serviceMessage: message.contentType !== "template", now: deps.now?.() ?? new Date() });
        }
        throw error;
      }
    },

    async downloadMedia(channel, ref) {
      // For YCloud the «id» of a file to download is its signed link.
      const file = await ycloudClientFor(channel, deps).downloadMedia(ref.externalMediaId, { maxBytes: ycloudMediaCap({ mimeType: ref.mimeType }) });
      return { bytes: file.bytes, mimeType: ref.mimeType ?? file.contentType ?? "application/octet-stream" };
    },

    async markRead(channel, externalMessageId) {
      await ycloudClientFor(channel, deps).markAsRead(externalMessageId);
    },

    async sendTyping(channel, externalMessageId) {
      // It also marks the message as read; shown only while the AI prepares a reply ([WA-45]).
      await ycloudClientFor(channel, deps).sendTyping(externalMessageId);
    },

    async disconnect(channel) {
      // YCloud stops calling this installation; the caller deletes the key ([YC-10]).
      const endpointId = readYCloudConfig(channel.config).ycloudWebhookEndpointId;
      if (endpointId && readYCloudSecrets(channel)) await ycloudClientFor(channel, deps).deleteWebhookEndpoint(endpointId);
    },
  };
}

export const ycloudAdapter = createYCloudAdapter();
