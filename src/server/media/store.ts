// Stores the files customers send (web chat, simulator, and the channel downloads) and reads them back for the
// model ([MED-01]–[MED-08], docs/security.md «Archivos»). Keys are generated, never the customer's file name;
// the type and size are checked here; the files are private and only /api/files serves them.
import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { messages, type MessageMedia } from "@/db/schema";
import { generateFileKey, getFileStorage, isValidFileKey, readAll, type FileStorage } from "@/server/adapters/file-storage";
import { AppError } from "@/server/errors";
import { jsonTextContains } from "@/server/sql-helpers";
import { extensionForMime, MEDIA_LIMITS, storedMimeType } from "./limits";

/** Storage prefix of message media: /api/files serves it after checking the conversation ([MED-08]). */
export const MEDIA_KEY_PREFIX = "media";
const MAX_FILE_NAME = 255;

export class MediaRejectedError extends AppError {
  constructor(reason: "empty" | "too_large") {
    super(reason === "empty" ? 400 : 413, `media_${reason}`, reason === "empty" ? "El archivo está vacío." : "El archivo es demasiado grande.");
  }
}

export type StoreMediaInput = {
  bytes: Uint8Array;
  mimeType: string;
  /** Original name, only for display and downloads. */
  fileName?: string | null;
  durationSec?: number | null;
};

export type StoredMedia = MessageMedia & { fileKey: string; mimeType: string; size: number; sha256: string };

/** Name to show: without folders or control characters, at most 255 characters; undefined when nothing is left. */
export function safeFileName(name: string | null | undefined): string | undefined {
  const cleaned = (name ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILE_NAME);
  return cleaned ? cleaned : undefined;
}

/**
 * Saves one inbound file and returns what goes in `messages.media`. Throws MediaRejectedError if empty or too big.
 * `prefix`: first segment of the key («media» by default; the web chat keeps its uploads under «webchat»).
 */
export async function storeInboundMedia(
  input: StoreMediaInput,
  options: { storage?: FileStorage; now?: Date; prefix?: string } = {},
): Promise<StoredMedia> {
  const size = input.bytes.byteLength;
  if (size === 0) throw new MediaRejectedError("empty");
  if (size > MEDIA_LIMITS.storedBytes) throw new MediaRejectedError("too_large");
  const mimeType = storedMimeType(input.mimeType);
  const fileKey = generateFileKey(options.prefix ?? MEDIA_KEY_PREFIX, extensionForMime(mimeType), options.now);
  await (options.storage ?? getFileStorage()).put(fileKey, input.bytes, mimeType);
  const fileName = safeFileName(input.fileName);
  const duration = input.durationSec;
  return {
    fileKey,
    mimeType,
    size,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    ...(fileName ? { fileName } : {}),
    ...(typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? { durationSec: duration } : {}),
    downloadStatus: "done",
  };
}

/**
 * System: the original name of a message file, for its download (the key never carries it). Only called once
 * /api/files has checked that the person may see the file ([MED-08]).
 */
export async function messageMediaFileName(fileKey: string): Promise<string | null> {
  const rows = await db
    .select({ media: messages.media })
    .from(messages)
    .where(jsonTextContains(messages.media, JSON.stringify(fileKey)))
    .limit(20);
  return rows.find((row) => row.media?.fileKey === fileKey)?.media?.fileName ?? null;
}

export type ReadMediaResult ={ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: "missing" | "too_large" };

/** A stored file's bytes, only when it fits `maxBytes` (a bigger one is not even read). */
export async function readStoredMedia(fileKey: string, maxBytes: number, storage: FileStorage = getFileStorage()): Promise<ReadMediaResult> {
  if (!isValidFileKey(fileKey)) return { ok: false, reason: "missing" };
  const file = await storage.get(fileKey);
  if (!file) return { ok: false, reason: "missing" };
  if (file.size > maxBytes) {
    await file.stream.cancel();
    return { ok: false, reason: "too_large" };
  }
  const bytes = await readAll(file.stream);
  return bytes.byteLength > maxBytes ? { ok: false, reason: "too_large" } : { ok: true, bytes, contentType: file.contentType };
}
