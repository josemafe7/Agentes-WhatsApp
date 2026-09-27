// Media customers send by WhatsApp ([WA-41], [MED-01]–[MED-08], docs/integracion-whatsapp-mensajes.md §10): the URL
// may already come in the webhook (valid 5 minutes); if not, or if it fails, GET /{MEDIA_ID} gives a fresh one (the id
// lasts 7 days). Both downloads carry the Bearer token and only go to Meta's hosts. Stored privately through
// FileStorage (src/server/media/store.ts); /api/files serves it after checking permissions. Each kind of file has
// Meta's size limit (INBOUND_MEDIA_CAPS: a bigger one is refused before it is read whole), and the process never holds
// more downloads in memory at once than its gate allows (src/server/media/download-gate.ts).
import "server-only";
import { z } from "zod";
import type { MetaGraphClient } from "@/lib/meta/client";
import { isMetaGraphError } from "@/lib/meta/errors";
import type { FileStorage } from "@/server/adapters/file-storage";
import { inboundMediaGate, MEDIA_DOWNLOAD_WAIT_MS, type MemoryGate } from "@/server/media/download-gate";
import { INBOUND_MEDIA_CAPS, inboundMediaKind } from "@/server/media/limits";
import { storeInboundMedia, type StoredMedia } from "@/server/media/store";

export const MEDIA_DOWNLOAD_JOB = "wa.media_download";
/** Retries of a failed download (the queue waits 15 s, 30 s, 60 s); then the Bandeja says «No se pudo descargar el archivo». */
export const MEDIA_DOWNLOAD_MAX_ATTEMPTS = 4;

export const mediaDownloadPayload = z.object({
  channelId: z.uuid(),
  /** The message's wamid: the job finds the stored message by (channel, wamid). */
  wamid: z.string().min(1).max(300),
  mediaId: z.string().regex(/^\d{1,32}$/),
  /** The webhook's URL, if it came (it expires in 5 minutes). */
  url: z.string().max(4_000).nullish(),
  mimeType: z.string().max(200).nullish(),
  fileName: z.string().max(255).nullish(),
});
export type MediaDownloadPayload = z.infer<typeof mediaDownloadPayload>;

export const mediaDownloadDedupeKey = (channelId: string, wamid: string) => `wa.media:${channelId}:${wamid}`;

export type DownloadedWhatsAppMedia = { bytes: Uint8Array; mimeType: string };

export type WhatsAppMediaRef = {
  mediaId: string;
  url?: string | null;
  mimeType?: string | null;
  phoneNumberId?: string | null;
  /** The message's content type (audio, image, video, sticker, document): its size limit. Else the type's family. */
  contentType?: string | null;
};

/** The size limit of this file: its kind's, from the message or else its type. */
export function whatsappMediaCap(ref: Pick<WhatsAppMediaRef, "contentType" | "mimeType">): number {
  return INBOUND_MEDIA_CAPS[inboundMediaKind(ref.contentType, ref.mimeType)];
}

/** The file's bytes: the webhook URL first (when it is Meta's), else a fresh URL from GET /{media_id}. */
export async function downloadWhatsAppMedia(client: MetaGraphClient, ref: WhatsAppMediaRef, maxBytes: number = whatsappMediaCap(ref)): Promise<DownloadedWhatsAppMedia> {
  const typeOf = (contentType: string | null, fallback?: string | null) => fallback || contentType || "application/octet-stream";
  // The client refuses any URL that is not Meta's (or the configured base URL): then a fresh one is asked for.
  if (ref.url) {
    try {
      const file = await client.downloadMedia(ref.url, { maxBytes });
      return { bytes: file.bytes, mimeType: typeOf(file.contentType, ref.mimeType) };
    } catch (error) {
      // An expired URL (404) or any other failure: ask Meta for a new one below. A too-big file stays too big.
      if (isMetaGraphError(error) && error.httpStatus === 413) throw error;
    }
  }
  const info = await client.getMedia(ref.mediaId, { phoneNumberId: ref.phoneNumberId ?? undefined });
  const file = await client.downloadMedia(info.url, { maxBytes });
  return { bytes: file.bytes, mimeType: typeOf(file.contentType, info.mime_type ?? ref.mimeType) };
}

/**
 * Downloads and stores the file of a message; returns what goes in `messages.media`. It first waits for its turn in the
 * process's gate, reserving its kind's size limit until the file is stored (MediaBusyError if it waits too long).
 */
export async function downloadAndStoreWhatsAppMedia(
  client: MetaGraphClient,
  ref: WhatsAppMediaRef & { fileName?: string | null },
  options: { storage?: FileStorage; now?: Date; gate?: MemoryGate; waitMs?: number } = {},
): Promise<StoredMedia> {
  const maxBytes = whatsappMediaCap(ref);
  const release = await (options.gate ?? inboundMediaGate()).acquire(maxBytes, options.waitMs ?? MEDIA_DOWNLOAD_WAIT_MS);
  try {
    const file = await downloadWhatsAppMedia(client, ref, maxBytes);
    return await storeInboundMedia({ bytes: file.bytes, mimeType: file.mimeType, fileName: ref.fileName ?? null }, { storage: options.storage, now: options.now });
  } finally {
    release();
  }
}
