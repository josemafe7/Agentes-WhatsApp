// Files a visitor sends from the web chat ([WEB-07], [WEB-09], [SEG-13], decision 0010): images and voice notes
// only when the chat allows them, checked by their first bytes (the declared type and name are never trusted), at
// most 4 MB (under Vercel's 4.5 MB body limit), stored with a generated key. The visitor gets a signed receipt to
// attach the file to a message, so nobody can attach a file they did not upload.
import "server-only";
import { detectLogoFormat } from "@/data/business";
import type { FileStorage } from "@/server/adapters/file-storage";
import { AppError, ValidationError } from "@/server/errors";
import { storeInboundMedia } from "@/server/media/store";
import { webchatCapabilities } from "../capabilities";
import type { ChannelRecord } from "../types";
import { issueUploadReceipt, type VisitorIdentity, type WidgetMediaKind } from "./tokens";

export const WIDGET_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Key prefix of the files visitors send: webchat/<yyyy>/<mm>/<uuid>.<ext>. */
export const WIDGET_UPLOAD_PREFIX = "webchat";
export const FILE_TOO_LARGE = "El archivo es demasiado grande. Como máximo, 4 MB.";
const UNSUPPORTED_FILE = "Solo se pueden enviar imágenes (JPG, PNG o WebP) y notas de voz.";

export type DetectedMedia = { kind: WidgetMediaKind; mimeType: string; extension: string };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// What MediaRecorder produces (WebM or Ogg with Opus in Chrome and Firefox, MP4 in Safari) plus MP3 and WAV.
const AUDIO_FORMATS: { mimeType: string; extension: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { mimeType: "audio/webm", extension: ".webm", matches: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  { mimeType: "audio/ogg", extension: ".ogg", matches: (b) => startsWith(b, ascii("OggS")) },
  { mimeType: "audio/mp4", extension: ".m4a", matches: (b) => startsWith(b, ascii("ftyp"), 4) },
  { mimeType: "audio/mpeg", extension: ".mp3", matches: (b) => startsWith(b, ascii("ID3")) || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { mimeType: "audio/wav", extension: ".wav", matches: (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WAVE"), 8) },
];

/** Image (PNG, JPG, WebP, like the logos) or voice note, by content; null for anything else (SVG, HTML, PDF…). */
export function detectWidgetMedia(bytes: Uint8Array): DetectedMedia | null {
  const image = detectLogoFormat(bytes);
  if (image) return { kind: "image", mimeType: image.contentType, extension: image.extension };
  const audio = AUDIO_FORMATS.find((format) => format.matches(bytes));
  return audio ? { kind: "audio", mimeType: audio.mimeType, extension: audio.extension } : null;
}

/** Reads the request body up to `maxBytes`; null when it is (or says it is) bigger, without reading the rest. */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Images and voice notes are optional per chat: switched off, the app refuses them ([WEB-07]). */
export function assertMediaAllowed(channel: Pick<ChannelRecord, "config">, kind: WidgetMediaKind): void {
  const capabilities = webchatCapabilities(channel);
  if (kind === "image" && !capabilities.images) throw new ValidationError("Este chat no admite imágenes.");
  if (kind === "audio" && !capabilities.audio) throw new ValidationError("Este chat no admite notas de voz.");
}

export type StoredUpload = { upload: string; kind: WidgetMediaKind; mimeType: string; size: number };

/** Checks and stores a visitor's file; returns the receipt that attaches it to a message. */
export async function storeWidgetUpload(
  channel: ChannelRecord,
  visitor: VisitorIdentity,
  bytes: Uint8Array | null,
  options: { storage?: FileStorage; now?: Date } = {},
): Promise<StoredUpload> {
  if (bytes === null) throw new AppError(413, "too_large", FILE_TOO_LARGE);
  const media = detectWidgetMedia(bytes);
  if (!media) throw new ValidationError(UNSUPPORTED_FILE);
  assertMediaAllowed(channel, media.kind);
  const now = options.now ?? new Date();
  // The one place that stores what customers send (generated key, never their file name): src/server/media/store.ts.
  const stored = await storeInboundMedia({ bytes, mimeType: media.mimeType }, { storage: options.storage, now, prefix: WIDGET_UPLOAD_PREFIX });
  const upload = issueUploadReceipt({ ...visitor, fileKey: stored.fileKey, mimeType: stored.mimeType, size: stored.size, kind: media.kind }, now);
  return { upload, kind: media.kind, mimeType: stored.mimeType, size: stored.size };
}
