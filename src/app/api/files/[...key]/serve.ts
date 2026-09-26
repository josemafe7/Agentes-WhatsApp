// Who may read a stored file and with which headers it is served (docs/security.md «Datos», [SEG-04], [MED-08]).
import "server-only";
import { isPublicLogoKey } from "@/data/business";
import type { StoredFile } from "@/server/adapters/file-storage";
import type { SessionActor } from "@/server/session";

/** public = anyone (only the current business logo); private = a signed-in person with permission on its record. */
export type FileVisibility = "public" | "private";
export type FileAccess = FileVisibility | "unauthenticated" | "not_found";

/**
 * The business logo is public: the login, the legal pages, the installed app and the web chat show it without a
 * session. Anything else needs a signed-in person with permission on the record that owns the file. Record types
 * that store files add their check here, each through its own src/data function (message media: inbox.view on
 * the conversation's channel; knowledge documents: knowledge.view; agent files: agents.view). Until then, «not
 * found»: a file nobody has a rule for is never served, and the answer does not reveal whether it exists.
 */
export async function resolveFileAccess(key: string, actor: SessionActor | null): Promise<FileAccess> {
  if (await isPublicLogoKey(key)) return "public";
  if (!actor || actor.twoFactorSetupRequired) return "unauthenticated";
  return "not_found";
}

// Shown in the page (img, audio, video); anything else is downloaded, so HTML or SVG never runs in our origin.
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const INLINE_PREFIXES = ["audio/", "video/"];

function isInline(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return INLINE_TYPES.has(type) || INLINE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/** Headers of a served file: stored type, never sniffed, sandboxed, and not cached by shared caches if private. */
export function fileResponseHeaders(file: Pick<StoredFile, "contentType" | "size">, visibility: FileVisibility): Record<string, string> {
  return {
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    "Content-Disposition": isInline(file.contentType) ? "inline" : "attachment",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    // Logo keys are new on every upload, so a cached copy never goes stale.
    "Cache-Control": visibility === "public" ? "public, max-age=86400, immutable" : "private, no-store",
    // The web chat on the business's own site shows the logo; private files stay on this origin.
    "Cross-Origin-Resource-Policy": visibility === "public" ? "cross-origin" : "same-origin",
  };
}
