// Voice notes and photos customers send by Telegram ([TG-11], [MED-01]–[MED-08], docs/integracion-telegram.md
// «Archivos»): getFile gives the file's path, and it is downloaded from a URL that carries the bot's token (never
// stored, logged or shown). Bots download up to 20 MB. Stored privately through FileStorage; its type is the one its
// first bytes show, never the one the sender declared. Each download waits for its turn in the process's gate.
import "server-only";
import { z } from "zod";
import { detectLogoFormat } from "@/data/business";
import { TELEGRAM_MAX_DOWNLOAD_BYTES, type TelegramClient } from "@/lib/telegram/client";
import { TELEGRAM_FILE_TOO_BIG, TelegramApiError } from "@/lib/telegram/errors";
import type { FileStorage } from "@/server/adapters/file-storage";
import { inboundMediaGate, MEDIA_DOWNLOAD_WAIT_MS, type MemoryGate } from "@/server/media/download-gate";
import { detectAudioMimeType, INBOUND_MEDIA_CAPS, inboundMediaKind } from "@/server/media/limits";
import { storeInboundMedia, type StoredMedia } from "@/server/media/store";

export const TELEGRAM_MEDIA_DOWNLOAD_JOB = "tg.media_download";
/** Retries of a failed download (the queue waits 15 s, 30 s, 60 s); then the Bandeja says «No se pudo descargar el archivo». */
export const TELEGRAM_MEDIA_DOWNLOAD_MAX_ATTEMPTS = 4;

export const telegramMediaDownloadPayload = z.object({
  channelId: z.uuid(),
  /** The message's `chat.id:message_id`: the job finds the stored message by (channel, id). */
  externalId: z.string().min(1).max(300),
  fileId: z.string().min(1).max(500),
  mimeType: z.string().max(200).nullish(),
});
export type TelegramMediaDownloadPayload = z.infer<typeof telegramMediaDownloadPayload>;

export const telegramMediaDedupeKey = (channelId: string, externalId: string) => `tg.media:${channelId}:${externalId}`;

export type TelegramMediaRef = {
  fileId: string;
  /** What the message said it was; the stored type comes from the bytes when they show one. */
  mimeType?: string | null;
  /** The message's content type (audio, image): its size limit. */
  contentType?: string | null;
  durationSec?: number | null;
};

/** The size limit of this file: its kind's, never above what Telegram lets a bot download. */
export function telegramMediaCap(ref: Pick<TelegramMediaRef, "contentType" | "mimeType">): number {
  return Math.min(INBOUND_MEDIA_CAPS[inboundMediaKind(ref.contentType, ref.mimeType)], TELEGRAM_MAX_DOWNLOAD_BYTES);
}

export type DownloadedTelegramMedia = { bytes: Uint8Array; mimeType: string };

/** The file's bytes and the type they show (an image or an audio container), else the declared one. */
export async function downloadTelegramMedia(client: TelegramClient, ref: TelegramMediaRef, maxBytes: number = telegramMediaCap(ref)): Promise<DownloadedTelegramMedia> {
  const info = await client.getFile(ref.fileId);
  if ((info.file_size ?? 0) > maxBytes) throw new TelegramApiError(413, 413, TELEGRAM_FILE_TOO_BIG);
  // Without a path there is nothing to download (Telegram omits it for files a bot cannot get).
  if (!info.file_path) throw new TelegramApiError(413, 413, TELEGRAM_FILE_TOO_BIG);
  const file = await client.downloadFile(info.file_path, { maxBytes });
  const detected = detectLogoFormat(file.bytes)?.contentType ?? detectAudioMimeType(file.bytes);
  return { bytes: file.bytes, mimeType: detected ?? ref.mimeType ?? file.contentType ?? "application/octet-stream" };
}

/**
 * Downloads and stores the file of a message; returns what goes in `messages.media`. It first waits for its turn in the
 * process's gate, reserving its size limit until the file is stored (MediaBusyError if it waits too long).
 */
export async function downloadAndStoreTelegramMedia(
  client: TelegramClient,
  ref: TelegramMediaRef,
  options: { storage?: FileStorage; now?: Date; gate?: MemoryGate; waitMs?: number } = {},
): Promise<StoredMedia> {
  const maxBytes = telegramMediaCap(ref);
  const release = await (options.gate ?? inboundMediaGate()).acquire(maxBytes, options.waitMs ?? MEDIA_DOWNLOAD_WAIT_MS);
  try {
    const file = await downloadTelegramMedia(client, ref, maxBytes);
    return await storeInboundMedia({ bytes: file.bytes, mimeType: file.mimeType, durationSec: ref.durationSec ?? null }, { storage: options.storage, now: options.now });
  } finally {
    release();
  }
}
