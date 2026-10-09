// Sending through YCloud ([YC-07], [WA-44], docs/integracion-ycloud.md «Envío»): one message per call, synchronously
// (`sendDirectly`), so a refusal of Meta comes back at once with Meta's own code. The destination and the message body
// are the direct connection's (`to` = «+» + wa_id, or `recipient` = BSUID, never both; Meta's content objects); only
// `from`, the business number, is YCloud's. Files are uploaded first and sent by id (ours are private). Transient
// errors are retried with bounded waits; what is left is final.
import "server-only";
import type { YCloudClient } from "@/lib/ycloud/client";
import { isYCloudApiError } from "@/lib/ycloud/errors";
import { getFileStorage, readAll, type FileStorage } from "@/server/adapters/file-storage";
import { safeErrorMessage } from "@/server/redact";
import { ChannelSendError, type OutboundMessage, type SendResult } from "../types";
import { buildMessagePayload, type WhatsAppDestination } from "../whatsapp/send";

/** First try plus retries of a transient error. */
export const SEND_MAX_ATTEMPTS = 4;
/** The retries never wait longer than this in total: the reply job has a time budget. */
export const SEND_MAX_TOTAL_WAIT_MS = 10_000;
const BASE_DELAY_MS = 1_000;
const MEDIA_TYPES: ReadonlySet<string> = new Set(["image", "audio", "video", "document", "sticker"]);

export type SendDeps = { sleep?: (ms: number) => Promise<void>; storage?: FileStorage };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait before retry number `retry` (0-based): what YCloud asks for (429), else 1 s, 2 s, 4 s… */
export function sendRetryDelayMs(retryAfterSec: number | null, retry: number): number {
  return retryAfterSec !== null ? retryAfterSec * 1_000 : BASE_DELAY_MS * 2 ** retry;
}

async function uploadIfNeeded(client: YCloudClient, phoneNumber: string, message: OutboundMessage, storage: FileStorage): Promise<string | null> {
  if (!MEDIA_TYPES.has(message.contentType)) return null;
  const fileKey = message.media?.fileKey;
  const file = fileKey ? await storage.get(fileKey) : null;
  if (!file) throw new ChannelSendError("No se ha encontrado el archivo del mensaje.", false);
  const bytes = await readAll(file.stream);
  return client.uploadMedia(phoneNumber, { bytes, mimeType: message.media?.mimeType ?? file.contentType, fileName: message.media?.fileName ?? null });
}

/**
 * Sends one message and returns YCloud's id of it (its statuses come by it). Throws ChannelSendError with the Spanish
 * message and Meta's code when Meta refused it (else YCloud's); it is final (retryable false): the retries already ran.
 */
export async function sendYCloudMessage(client: YCloudClient, phoneNumber: string, destination: WhatsAppDestination, message: OutboundMessage, deps: SendDeps = {}): Promise<SendResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const storage = deps.storage ?? getFileStorage();
  let mediaId: string | null = null;
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      mediaId ??= await uploadIfNeeded(client, phoneNumber, message, storage);
      const sent = await client.sendMessage({ from: phoneNumber, ...destination, ...buildMessagePayload(message, mediaId) });
      // «accepted» only says Meta took it; «entregado» and «leído» come by webhook ([WA-38]).
      return { externalId: sent.id, status: "sent", sentAt: new Date() };
    } catch (error) {
      if (error instanceof ChannelSendError) throw error;
      if (!isYCloudApiError(error)) {
        console.error(`[ycloud] Envío fallido: ${safeErrorMessage(error)}`);
        throw new ChannelSendError("No se ha podido enviar el mensaje por un error inesperado.", false);
      }
      const delay = sendRetryDelayMs(error.retryAfterSec, attempt - 1);
      if (error.retryable && attempt < SEND_MAX_ATTEMPTS && waited + delay <= SEND_MAX_TOTAL_WAIT_MS) {
        waited += delay;
        await sleep(delay);
        continue;
      }
      throw new ChannelSendError(error.userMessage, false, error.metaCode ?? error.code ?? undefined);
    }
  }
}
