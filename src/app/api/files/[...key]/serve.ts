// Who may read a stored file and with which headers it is served (docs/security.md «Datos», [SEG-04], [MED-08]).
import "server-only";
import { canViewAgentAvatar } from "@/data/agents";
import { isPublicLogoKey } from "@/data/business";
import { canViewKnowledgeFile } from "@/data/knowledge-documents";
import { canViewMessageMedia } from "@/data/messages";
import { canViewWebchatLogo } from "@/data/webchat-logo";
import type { StoredFile } from "@/server/adapters/file-storage";
import type { SessionActor } from "@/server/session";

/** public = anyone (only the current business logo); private = a signed-in person with permission on its record. */
export type FileVisibility = "public" | "private";
export type FileAccess = FileVisibility | "unauthenticated" | "not_found";

/**
 * The business logo is public: the login, the legal pages, the installed app and the web chat show it without a
 * session. Anything else needs a signed-in person with permission on the record that owns the file. Record types
 * that store files add their check here, each through its own src/data function (message media: inbox.view on
 * the conversation's channel; knowledge documents: knowledge.view; agent avatars and context files: agents.view).
 * A file nobody has a rule for is «not found»: never served, and the answer does not reveal whether it exists.
 */
export async function resolveFileAccess(key: string, actor: SessionActor | null): Promise<FileAccess> {
  if (await isPublicLogoKey(key)) return "public";
  if (!actor || actor.twoFactorSetupRequired) return "unauthenticated";
  if (await canViewAgentAvatar(actor, key)) return "private";
  // A web chat's own logo, for the previews in Canales (the widget serves it through its own route) ([WEB-02]).
  if (await canViewWebchatLogo(actor, key)) return "private";
  if (await canViewMessageMedia(actor, key)) return "private";
  // Originals of knowledge documents (knowledge.view) and of agents' context files (agents.view).
  if (await canViewKnowledgeFile(actor, key)) return "private";
  return "not_found";
}

// Shown in the page (img, audio, video); anything else is downloaded, so HTML or SVG never runs in our origin.
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const INLINE_PREFIXES = ["audio/", "video/"];

function isInline(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return INLINE_TYPES.has(type) || INLINE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * «inline» for what the page shows; «attachment» for the rest, with the original name (RFC 6266): an ASCII
 * fallback plus the UTF-8 form. Control characters are dropped, so a name can never break the header.
 */
function contentDisposition(contentType: string, fileName: string | null | undefined): string {
  if (isInline(contentType)) return "inline";
  const clean = fileName?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!clean) return "attachment";
  const fallback = clean.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Audio and video: what browsers play in pieces (Safari and iOS ask for byte ranges before playing). */
export function acceptsRanges(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type.startsWith("audio/") || type.startsWith("video/");
}

/** Inclusive byte positions of a range. */
export type ByteRange = { start: number; end: number };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * The one byte range a Range header asks for (RFC 9110 §14): «bytes=first-last», «bytes=first-» or the last N bytes
 * «bytes=-N», with `last` cut at the end of the file. "unsatisfiable" when it starts past the end (416). Null for no
 * header or anything else (several ranges, other units, last before first): the whole file is served, as the RFC
 * allows.
 */
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  const match = header ? SINGLE_RANGE.exec(header.trim()) : null;
  if (!match) return null;
  const [, first, last] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    const length = Number(last);
    if (!Number.isSafeInteger(length)) return null;
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const lastByte = last === "" ? null : Number(last);
  if (!Number.isSafeInteger(start) || (lastByte !== null && (!Number.isSafeInteger(lastByte) || lastByte < start))) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: Math.min(lastByte ?? size - 1, size - 1) };
}

/**
 * Only the bytes of `range` from a file stream; the source is cancelled as soon as they are out. Storage streams
 * from the start (disk and Blob alike), so the bytes before the range are read and dropped, never kept in memory.
 */
export function sliceStream(source: ReadableStream<Uint8Array>, range: ByteRange): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let consumed = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const chunkStart = consumed;
        consumed += value.byteLength;
        if (consumed <= range.start) continue;
        const from = Math.max(0, range.start - chunkStart);
        const to = Math.min(value.byteLength, range.end + 1 - chunkStart);
        if (to > from) controller.enqueue(value.subarray(from, to));
        if (consumed > range.end) {
          controller.close();
          await reader.cancel();
        }
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Headers of a served file: stored type, never sniffed, sandboxed, and not cached by shared caches if private. */
export function fileResponseHeaders(
  file: Pick<StoredFile, "contentType" | "size">,
  visibility: FileVisibility,
  downloadName?: string | null,
): Record<string, string> {
  return {
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    "Content-Disposition": contentDisposition(file.contentType, downloadName),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    // Logo keys are new on every upload, so a cached copy never goes stale.
    "Cache-Control": visibility === "public" ? "public, max-age=86400, immutable" : "private, no-store",
    // The web chat on the business's own site shows the logo; private files stay on this origin.
    "Cross-Origin-Resource-Policy": visibility === "public" ? "cross-origin" : "same-origin",
  };
}
