// Sending through the Cloud API ([WA-42], [WA-44], [WA-46], docs/integracion-whatsapp-mensajes.md §11): one message
// per call (a single reply per turn), to `to` = «+» + wa_id when the channel gave us the phone, or to `recipient` =
// BSUID when there is none (never both, never a phone someone typed). Files are uploaded first and sent by id (ours
// are private). Transient Meta errors are retried here with growing waits; what is left is final.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contactIdentities, conversations } from "@/db/schema";
import type { MetaGraphClient } from "@/lib/meta/client";
import { isMetaGraphError } from "@/lib/meta/errors";
import { isBsuid, phoneDigits } from "@/lib/meta/markets";
import { mediaMessage, templateMessage, textMessage, type WhatsAppMediaType } from "@/lib/meta/messages";
import { TEMPLATE_METADATA_KEY, type WhatsAppTemplateSend } from "@/lib/meta/templates";
import { getFileStorage, readAll, type FileStorage } from "@/server/adapters/file-storage";
import { safeErrorMessage } from "@/server/redact";
import { ChannelSendError, type OutboundMessage, type SendResult } from "../types";

/** First try plus retries of a transient error ([WA-46]). */
export const SEND_MAX_ATTEMPTS = 4;
/** The retries never wait longer than this in total: the reply job has a time budget. */
export const SEND_MAX_TOTAL_WAIT_MS = 10_000;
const BASE_DELAY_MS = 1_000;
/** 131056 (pair rate limit): Meta asks to retry after 4^X seconds (§14). */
const PAIR_RATE_LIMIT = 131056;
const MEDIA_TYPES: ReadonlySet<string> = new Set<WhatsAppMediaType>(["image", "audio", "video", "document", "sticker"]);
const isMediaType = (type: string): type is WhatsAppMediaType => MEDIA_TYPES.has(type);

export type WhatsAppDestination = { to: string } | { recipient: string };

/** Wait before retry number `retry` (0-based): 1 s, 2 s, 4 s…; for 131056, 1 s, 4 s, 16 s. */
export function sendRetryDelayMs(code: number | null, retry: number): number {
  return code === PAIR_RATE_LIMIT ? BASE_DELAY_MS * 4 ** retry : BASE_DELAY_MS * 2 ** retry;
}

/**
 * Where to send, from the contact's WhatsApp identities (newest first): the phone the channel gave (identity phone
 * or a wa_id identity) as `to`, else the BSUID as `recipient` ([WA-39]). null when there is neither.
 */
export function chooseDestination(identities: readonly { externalId: string; phone: string | null }[]): WhatsAppDestination | null {
  for (const identity of identities) {
    const phone = phoneDigits(identity.phone) || (/^\d{6,20}$/.test(identity.externalId) ? identity.externalId : "");
    if (phone) return { to: `+${phone}` };
  }
  const bsuid = identities.find((identity) => isBsuid(identity.externalId));
  return bsuid ? { recipient: bsuid.externalId } : null;
}

/** The conversation contact's WhatsApp identities, newest first (the phone a person typed is never used). */
export async function loadDestination(conversationId: string): Promise<WhatsAppDestination | null> {
  const [conversation] = await db.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation?.contactId) return null;
  const identities = await db
    .select({ externalId: contactIdentities.externalId, phone: contactIdentities.phone })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelType, "whatsapp")))
    .orderBy(desc(contactIdentities.updatedAt));
  return chooseDestination(identities);
}

function templateOf(metadata: Record<string, unknown> | undefined): WhatsAppTemplateSend | null {
  const value = metadata?.[TEMPLATE_METADATA_KEY];
  if (!value || typeof value !== "object") return null;
  const template = value as Partial<WhatsAppTemplateSend>;
  return typeof template.name === "string" && typeof template.language?.code === "string" && Array.isArray(template.components) ? (template as WhatsAppTemplateSend) : null;
}

/** The body of POST /messages for this message, without the destination. `mediaId` = the uploaded file. */
export function buildMessagePayload(message: Pick<OutboundMessage, "contentType" | "text" | "media" | "metadata">, mediaId: string | null): Record<string, unknown> {
  if (message.contentType === "template") {
    const template = templateOf(message.metadata);
    if (!template) throw new ChannelSendError("Falta la plantilla del mensaje.", false);
    return templateMessage(template);
  }
  if (isMediaType(message.contentType)) {
    if (!mediaId) throw new ChannelSendError("Falta el archivo del mensaje.", false);
    return mediaMessage(message.contentType, { id: mediaId }, { caption: message.text, filename: message.media?.fileName });
  }
  if (message.contentType === "text") {
    const body = message.text?.trim();
    if (!body) throw new ChannelSendError("El mensaje está vacío.", false);
    return textMessage(body);
  }
  throw new ChannelSendError("Este tipo de mensaje no se puede enviar por WhatsApp.", false);
}

export type SendDeps = { sleep?: (ms: number) => Promise<void>; storage?: FileStorage };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function uploadIfNeeded(client: MetaGraphClient, phoneNumberId: string, message: OutboundMessage, storage: FileStorage): Promise<string | null> {
  if (!isMediaType(message.contentType)) return null;
  const fileKey = message.media?.fileKey;
  const file = fileKey ? await storage.get(fileKey) : null;
  if (!file) throw new ChannelSendError("No se ha encontrado el archivo del mensaje.", false);
  const bytes = await readAll(file.stream);
  return client.uploadMedia(phoneNumberId, { bytes, mimeType: message.media?.mimeType ?? file.contentType, fileName: message.media?.fileName ?? null });
}

/**
 * Sends one message and returns its wamid; transient Meta errors are retried with growing waits (bounded). Throws
 * ChannelSendError with the Spanish message and Meta's code; it is final (retryable false): the retries already ran.
 */
export async function sendWithRetries(
  client: MetaGraphClient,
  phoneNumberId: string,
  destination: WhatsAppDestination,
  message: OutboundMessage,
  deps: SendDeps = {},
): Promise<SendResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const storage = deps.storage ?? getFileStorage();
  let mediaId: string | null = null;
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      mediaId ??= await uploadIfNeeded(client, phoneNumberId, message, storage);
      const payload = buildMessagePayload(message, mediaId);
      const response = await client.sendMessage(phoneNumberId, { recipient_type: "individual", ...destination, ...payload });
      // A 200 only says Meta accepted it; «entregado» and «leído» come by webhook ([WA-38]).
      return { externalId: response.messages[0].id, status: "sent", sentAt: new Date() };
    } catch (error) {
      if (error instanceof ChannelSendError) throw error;
      if (!isMetaGraphError(error)) {
        console.error(`[whatsapp] Envío fallido: ${safeErrorMessage(error)}`);
        throw new ChannelSendError("No se ha podido enviar el mensaje por un error inesperado.", false);
      }
      const delay = sendRetryDelayMs(error.code, attempt - 1);
      if (error.retryable && attempt < SEND_MAX_ATTEMPTS && waited + delay <= SEND_MAX_TOTAL_WAIT_MS) {
        waited += delay;
        await sleep(delay);
        continue;
      }
      throw new ChannelSendError(error.userMessage, false, error.code ?? undefined);
    }
  }
}
