// Files of a number connected through YCloud ([YC-06], [MED-01]–[MED-08], docs/integracion-ycloud.md «Archivos»): each
// message brings a signed link to YCloud's own host, downloaded with the account's key (it never goes to another host)
// right after the message arrives. Stored privately through FileStorage, within the same size limits as the direct
// connection and the process's download gate.
import "server-only";
import { z } from "zod";
import type { YCloudClient } from "@/lib/ycloud/client";
import type { FileStorage } from "@/server/adapters/file-storage";
import { inboundMediaGate, MEDIA_DOWNLOAD_WAIT_MS, type MemoryGate } from "@/server/media/download-gate";
import { INBOUND_MEDIA_CAPS, inboundMediaKind } from "@/server/media/limits";
import { storeInboundMedia, type StoredMedia } from "@/server/media/store";

export const YCLOUD_MEDIA_DOWNLOAD_JOB = "yc.media_download";
/** Retries of a failed download (the queue waits 15 s, 30 s, 60 s); then the Bandeja says «No se pudo descargar el archivo». */
export const YCLOUD_MEDIA_DOWNLOAD_MAX_ATTEMPTS = 4;

export const ycloudMediaDownloadPayload = z.object({
  channelId: z.uuid(),
  /** The stored message's id in the channel: the job finds it by (channel, id). */
  externalId: z.string().min(1).max(400),
  url: z.string().min(1).max(4_000),
  mimeType: z.string().max(200).nullish(),
  fileName: z.string().max(255).nullish(),
});
export type YCloudMediaDownloadPayload = z.infer<typeof ycloudMediaDownloadPayload>;

export const ycloudMediaDedupeKey = (channelId: string, externalId: string) => `yc.media:${channelId}:${externalId}`;

export type YCloudMediaRef = { url: string; mimeType?: string | null; fileName?: string | null; contentType?: string | null };

/** The size limit of this file: its kind's, from the message or else its type. */
export function ycloudMediaCap(ref: Pick<YCloudMediaRef, "contentType" | "mimeType">): number {
  return INBOUND_MEDIA_CAPS[inboundMediaKind(ref.contentType, ref.mimeType)];
}

/** Downloads and stores the file of a message; returns what goes in `messages.media`. It waits for its turn in the process's gate. */
export async function downloadAndStoreYCloudMedia(
  client: YCloudClient,
  ref: YCloudMediaRef,
  options: { storage?: FileStorage; now?: Date; gate?: MemoryGate; waitMs?: number } = {},
): Promise<StoredMedia> {
  const maxBytes = ycloudMediaCap(ref);
  const release = await (options.gate ?? inboundMediaGate()).acquire(maxBytes, options.waitMs ?? MEDIA_DOWNLOAD_WAIT_MS);
  try {
    const file = await client.downloadMedia(ref.url, { maxBytes });
    const mimeType = ref.mimeType || file.contentType || "application/octet-stream";
    return await storeInboundMedia({ bytes: file.bytes, mimeType, fileName: ref.fileName ?? null }, { storage: options.storage, now: options.now });
  } finally {
    release();
  }
}
