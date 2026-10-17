// Images, voice notes and PDF customers send by Instagram ([IG-03], [MED-01]–[MED-08], docs/integracion-instagram.md §6.1
// and §7): the webhook carries an address on Instagram's CDN, downloaded without the token (only from Instagram's hosts,
// each redirect checked again) and stored privately through FileStorage. Up to Instagram's own sizes (images 8 MB,
// audio and PDF 25 MB). Its type is the one its first bytes show, never the one the server declared. Each download
// waits for its turn in the process's gate.
import "server-only";
import { detectLogoFormat } from "@/data/business";
import type { InstagramClient } from "@/lib/instagram/client";
import type { FileStorage } from "@/server/adapters/file-storage";
import { inboundMediaGate, MEDIA_DOWNLOAD_WAIT_MS, type MemoryGate } from "@/server/media/download-gate";
import { detectAudioMimeType } from "@/server/media/limits";
import { storeInboundMedia, type StoredMedia } from "@/server/media/store";
import type { InstagramMediaDownloadPayload } from "./schedule";

const MB = 1024 * 1024;
/** Instagram's sizes per kind of file (§6.1): nothing bigger is downloaded. */
export const INSTAGRAM_MEDIA_CAPS: Readonly<Record<InstagramMediaDownloadPayload["contentType"], number>> = { image: 8 * MB, audio: 25 * MB, document: 25 * MB };
/** What each kind is when neither the bytes nor the server say it (audio: Instagram's formats are mp4 containers). */
const FALLBACK_MIME_TYPES: Readonly<Record<InstagramMediaDownloadPayload["contentType"], string>> = { image: "image/jpeg", audio: "audio/mp4", document: "application/pdf" };
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

const isPdf = (bytes: Uint8Array) => bytes.length >= PDF_SIGNATURE.length && PDF_SIGNATURE.every((value, index) => bytes[index] === value);

/** The type the bytes show for their kind, else the server's, else the kind's usual one. */
export function instagramMediaType(contentType: InstagramMediaDownloadPayload["contentType"], bytes: Uint8Array, declared: string | null): string {
  const detected = contentType === "image" ? detectLogoFormat(bytes)?.contentType : contentType === "audio" ? detectAudioMimeType(bytes) : isPdf(bytes) ? "application/pdf" : null;
  return detected ?? declared ?? FALLBACK_MIME_TYPES[contentType];
}

export type DownloadedInstagramMedia = { bytes: Uint8Array; mimeType: string };

/** The file's bytes and type, stopping at its kind's size. Throws InstagramApiError. */
export async function downloadInstagramMedia(client: InstagramClient, ref: { url: string; contentType: InstagramMediaDownloadPayload["contentType"] }): Promise<DownloadedInstagramMedia> {
  const file = await client.downloadFile(ref.url, { maxBytes: INSTAGRAM_MEDIA_CAPS[ref.contentType] });
  return { bytes: file.bytes, mimeType: instagramMediaType(ref.contentType, file.bytes, file.contentType) };
}

/**
 * Downloads and stores the file of a message; returns what goes in `messages.media`. It first waits for its turn in the
 * process's gate, reserving its size until the file is stored (MediaBusyError if it waits too long).
 */
export async function downloadAndStoreInstagramMedia(
  client: InstagramClient,
  ref: { url: string; contentType: InstagramMediaDownloadPayload["contentType"] },
  options: { storage?: FileStorage; now?: Date; gate?: MemoryGate; waitMs?: number } = {},
): Promise<StoredMedia> {
  const release = await (options.gate ?? inboundMediaGate()).acquire(INSTAGRAM_MEDIA_CAPS[ref.contentType], options.waitMs ?? MEDIA_DOWNLOAD_WAIT_MS);
  try {
    const file = await downloadInstagramMedia(client, ref);
    return await storeInboundMedia({ bytes: file.bytes, mimeType: file.mimeType }, { storage: options.storage, now: options.now });
  } finally {
    release();
  }
}
