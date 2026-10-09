// WhatsAppQrAdapter: a WhatsApp number linked by QR code behind the common ChannelAdapter contract ([CAN-09]–[CAN-17],
// [QR-*]). The registry gives it to the WhatsApp channels whose `connection_mode` is «qr». It has no webhook: messages
// arrive by the connection the web server's process keeps open (runtime.ts), and sending goes through that same
// connection: straight away when this is that process, or asking it when this is the worker of an own server
// (host.ts). Without an open session nothing is sent, and it says so. Demo channels never get here ([ARR-11]), nor do
// replies to simulated messages ([AJU-13]). This file brings no library with it: the registry is in every bundle.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import type { FileStorage } from "@/server/adapters/file-storage";
import { WHATSAPP_QR_CAPABILITIES } from "../capabilities";
import { ChannelSendError, type ChannelAdapter, type ChannelRecord, type OutboundMessage } from "../types";
import { whatsappQrHealth } from "./health";
import { requestOfQrHost, type askQrHost, type QrHostRequest } from "./host";
import { isPersonJid, jidOfIdentity, normalizeJid, QR_JID_METADATA_KEY } from "./normalize";
import { existingQrSupervisor, qrSupervisor } from "./runtime";

export type WhatsAppQrAdapterDeps = { storage?: FileStorage; now?: () => Date; /** Tests: how the web server is asked from another process. */ askHost?: typeof askQrHost };

/** Inbound messages of a conversation looked at for the chat to answer in. */
const RECENT_INBOUND = 5;
const SENDABLE: ReadonlySet<string> = new Set(["text", "image", "document", "audio"]);

const chatJid = (metadata: Record<string, unknown> | null | undefined): string | null => {
  const jid = normalizeJid(typeof metadata?.[QR_JID_METADATA_KEY] === "string" ? (metadata[QR_JID_METADATA_KEY] as string) : null);
  return isPersonJid(jid) ? jid : null;
};

/** The chat of a conversation: where its customer last wrote from, else their identities (LID first). */
export async function loadQrDestination(message: Pick<OutboundMessage, "conversationId" | "recipient">): Promise<string | null> {
  const recent = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.conversationId, message.conversationId), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.createdAt))
    .limit(RECENT_INBOUND);
  for (const row of recent) {
    const jid = chatJid(row.metadata);
    if (jid) return jid;
  }
  return message.recipient.externalIds.map(jidOfIdentity).find((jid) => jid !== null) ?? null;
}

/** The chat a stored message of this channel belongs to. */
async function jidOfMessage(channelId: string, externalMessageId: string): Promise<string | null> {
  const [row] = await db.select({ metadata: messages.metadata }).from(messages).where(and(eq(messages.channelId, channelId), eq(messages.externalId, externalMessageId)));
  return chatJid(row?.metadata);
}

/** What the process that keeps the session needs to send this message: its file goes by its key, never as bytes. */
function sendRequest(channelId: string, jid: string, message: OutboundMessage): QrHostRequest {
  if (!SENDABLE.has(message.contentType)) throw new ChannelSendError("Este tipo de mensaje no se puede enviar por un número vinculado por código QR.", false);
  const contentType = message.contentType as "text" | "image" | "document" | "audio";
  const fileKey = message.media?.fileKey;
  if (contentType !== "text" && !fileKey) throw new ChannelSendError("No se ha encontrado el archivo del mensaje.", false);
  return {
    action: "send",
    channelId,
    jid,
    contentType,
    text: message.text ?? null,
    media: contentType !== "text" && fileKey ? { fileKey, mimeType: message.media?.mimeType ?? null, fileName: message.media?.fileName ?? null } : null,
  };
}

export function createWhatsAppQrAdapter(deps: WhatsAppQrAdapterDeps = {}): ChannelAdapter {
  const hostDeps = { storage: deps.storage, askHost: deps.askHost };
  return {
    type: "whatsapp",
    // Not the official API: no templates and no 24 h window ([WA-55]).
    capabilities: () => WHATSAPP_QR_CAPABILITIES,

    async validateAndConnect() {
      // There is nothing to type: the number is linked by scanning the code of its wizard ([QR-03]).
      return { ok: false, error: "Un número por código QR se vincula escaneando el código desde su asistente." };
    },

    async healthCheck(channel) {
      return whatsappQrHealth(existingQrSupervisor()?.status(channel.id) ?? null, { now: deps.now?.() ?? new Date(), lastInboundAt: channel.lastInboundAt });
    },

    async handleWebhook() {
      return [];
    },

    async send(channel: ChannelRecord, message: OutboundMessage) {
      const jid = await loadQrDestination(message);
      if (!jid) throw new ChannelSendError("El contacto no tiene un identificador de WhatsApp al que escribir.", false);
      const result = await requestOfQrHost(sendRequest(channel.id, jid, message), hostDeps);
      // The answer is plain data: the error is this bundle's own, so whoever sent recognises it.
      if (!result.ok) throw new ChannelSendError(result.error, result.retryable);
      if (!result.externalId) throw new ChannelSendError("WhatsApp no ha confirmado el envío.", false);
      return { externalId: result.externalId, status: "sent", sentAt: deps.now?.() ?? new Date() };
    },

    async downloadMedia() {
      // Files are downloaded as their message arrives: what opens them is never stored ([QR-06]).
      throw new Error("Los archivos de un número por código QR se descargan al llegar el mensaje.");
    },

    async markRead(channel, externalMessageId) {
      const jid = await jidOfMessage(channel.id, externalMessageId);
      if (jid) await requestOfQrHost({ action: "read", channelId: channel.id, jid, messageId: externalMessageId }, hostDeps);
    },

    async sendTyping(channel, externalMessageId) {
      const jid = await jidOfMessage(channel.id, externalMessageId);
      if (jid) await requestOfQrHost({ action: "typing", channelId: channel.id, jid }, hostDeps);
    },

    async disconnect(channel) {
      // WhatsApp is told when the connection is open (the device leaves the phone's list), and the session is erased.
      await (await qrSupervisor()).logout(channel.id);
    },
  };
}

export const whatsappQrAdapter = createWhatsAppQrAdapter();
