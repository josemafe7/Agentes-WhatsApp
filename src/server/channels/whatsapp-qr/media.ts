// Files of a number linked by QR code ([QR-06], [MED-01]–[MED-08], docs/integracion-whatsapp-qr.md «Archivos»). A
// message brings where its encrypted file is and the key that opens it. The file is ONLY ever asked to WhatsApp's own
// media host, by the path the message gives: the address a message carries is never used (a message is data from
// outside, and it could point anywhere). Downloaded right after the message arrives, within the same size limits as
// the other ways and the process's download gate, and stored privately through FileStorage.
import "server-only";
import type { FileStorage } from "@/server/adapters/file-storage";
import { inboundMediaGate, MEDIA_DOWNLOAD_WAIT_MS, type MemoryGate } from "@/server/media/download-gate";
import { INBOUND_MEDIA_CAPS } from "@/server/media/limits";
import { MediaRejectedError, storeInboundMedia, type StoredMedia } from "@/server/media/store";
import type { QrMediaRef } from "./normalize";

/** WhatsApp's media host: the only one a download ever goes to. */
export const WHATSAPP_MEDIA_HOST = "mmg.whatsapp.net";
// «/v/t62.7117-24/1234_5678_n.enc?ccb=11-4&oh=…&oe=…»: an absolute path and its query, nothing that could change the host.
const DIRECT_PATH = /^\/[A-Za-z0-9._~\-/]{1,400}(?:\?[A-Za-z0-9._~\-=&%+]{0,1500})?$/;

/** A path that can only ever be a path of the media host («//otro.sitio», «/@otro.sitio» or «/..» are not). */
export function isSafeDirectPath(directPath: string | null | undefined): directPath is string {
  return typeof directPath === "string" && DIRECT_PATH.test(directPath) && !directPath.startsWith("//") && !directPath.includes("..") && !directPath.includes("@");
}

/** The file of a message cannot be downloaded: what it says is not usable (never retried). */
export class QrMediaUnavailableError extends Error {
  constructor() {
    super("El mensaje no trae un archivo que se pueda descargar.");
    this.name = "QrMediaUnavailableError";
  }
}

/** Decrypts the file at `directPath` of `host`; the library's own function, injectable for tests. */
export type QrMediaFetcher = (file: { mediaKey: Uint8Array; directPath: string; kind: QrMediaRef["kind"]; host: string }) => Promise<AsyncIterable<Uint8Array>>;

const realFetcher: QrMediaFetcher = async ({ mediaKey, directPath, kind, host }) => {
  const { downloadContentFromMessage } = await import("baileys");
  // Never `url`: with a path and an explicit host the library has nothing else to go by.
  return downloadContentFromMessage({ mediaKey, directPath }, kind, { host });
};

export type QrMediaDeps = { storage?: FileStorage; now?: Date; gate?: MemoryGate; waitMs?: number; fetchMedia?: QrMediaFetcher };

/** Downloads, decrypts and stores the file of a message; returns what goes in `messages.media`. */
export async function downloadAndStoreQrMedia(media: QrMediaRef, deps: QrMediaDeps = {}): Promise<StoredMedia> {
  const maxBytes = INBOUND_MEDIA_CAPS[media.kind];
  if (!media.mediaKey || !isSafeDirectPath(media.directPath)) throw new QrMediaUnavailableError();
  if (media.fileLength !== null && media.fileLength > maxBytes) throw new MediaRejectedError("too_large");
  const release = await (deps.gate ?? inboundMediaGate()).acquire(maxBytes, deps.waitMs ?? MEDIA_DOWNLOAD_WAIT_MS);
  try {
    const stream = await (deps.fetchMedia ?? realFetcher)({ mediaKey: media.mediaKey, directPath: media.directPath, kind: media.kind, host: WHATSAPP_MEDIA_HOST });
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.byteLength;
      // What the message said its size was is not trusted: the download stops at the limit.
      if (total > maxBytes) throw new MediaRejectedError("too_large");
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return await storeInboundMedia({ bytes, mimeType: media.mimeType ?? "application/octet-stream", fileName: media.fileName }, { storage: deps.storage, now: deps.now });
  } finally {
    release();
  }
}
