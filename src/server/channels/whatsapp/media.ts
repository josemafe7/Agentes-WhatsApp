// Media customers send by WhatsApp ([WA-41], [MED-01]–[MED-08], docs/integracion-whatsapp-mensajes.md §10): the URL
// may already come in the webhook (valid 5 minutes); if not, or if it fails, GET /{MEDIA_ID} gives a fresh one (the id
// lasts 7 days). Both downloads carry the Bearer token and only go to Meta's hosts. Stored privately through
// FileStorage (src/server/media/store.ts); /api/files serves it after checking permissions.
import "server-only";
import { z } from "zod";
import type { MetaGraphClient } from "@/lib/meta/client";
import { isMetaGraphError } from "@/lib/meta/errors";
import { MEDIA_LIMITS } from "@/server/media/limits";
import { storeInboundMedia, type StoredMedia } from "@/server/media/store";
import type { FileStorage } from "@/server/adapters/file-storage";

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

/** The file's bytes: the webhook URL first (when it is Meta's), else a fresh URL from GET /{media_id}. */
export async function downloadWhatsAppMedia(
  client: MetaGraphClient,
  ref: { mediaId: string; url?: string | null; mimeType?: string | null; phoneNumberId?: string | null },
  maxBytes: number = MEDIA_LIMITS.storedBytes,
): Promise<DownloadedWhatsAppMedia> {
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

/** Downloads and stores the file of a message; returns what goes in `messages.media`. */
export async function downloadAndStoreWhatsAppMedia(
  client: MetaGraphClient,
  ref: { mediaId: string; url?: string | null; mimeType?: string | null; fileName?: string | null; phoneNumberId?: string | null },
  options: { storage?: FileStorage; now?: Date } = {},
): Promise<StoredMedia> {
  const file = await downloadWhatsAppMedia(client, ref);
  return storeInboundMedia({ bytes: file.bytes, mimeType: file.mimeType, fileName: ref.fileName ?? null }, options);
}
