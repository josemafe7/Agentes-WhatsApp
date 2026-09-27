// The web chat's own logo ([WEB-02]): an image checked by its bytes and size, like the business logo, stored under
// webchat-logos/ and kept in the channel's config. Without one, the chat shows the business logo. The widget serves it
// through its own route; in the app, /api/files shows the current logo of a web chat to whoever sees Canales
// (src/app/api/files/[...key]/serve.ts), and no other key can be reached that way.
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { readWebchatConfig } from "@/lib/webchat-config";
import { generateFileKey, getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { NotFoundError, ValidationError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { writeAudit } from "./audit";
import { detectLogoFormat, MAX_LOGO_BYTES } from "./business";
import { assertCan } from "./guard";

/** Prefix of web chat logo keys: only the current logo of a web chat under it is served without a session. */
export const WEBCHAT_LOGO_KEY_PREFIX = "webchat-logos";

const INVALID_LOGO = "El logo tiene que ser una imagen PNG, JPG o WebP.";
const TOO_BIG = `El logo puede ocupar como mucho ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`;
const NOT_FOUND = "No se ha encontrado el canal.";

/** The image type read from its bytes; the name and declared type are never trusted, SVG is refused ([SEG-13]). */
export function checkWebchatLogo(bytes: Uint8Array): { contentType: string; extension: string } {
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new ValidationError(undefined, { logo: [TOO_BIG] });
  const format = detectLogoFormat(bytes);
  if (!format) throw new ValidationError(undefined, { logo: [INVALID_LOGO] });
  return format;
}

async function loadWebchat(channelId: string) {
  const id = idSchema.safeParse(channelId);
  if (!id.success) throw new NotFoundError(NOT_FOUND);
  const [row] = await db.select({ id: channels.id, type: channels.type, config: channels.config }).from(channels).where(eq(channels.id, id.data));
  if (!row) throw new NotFoundError(NOT_FOUND);
  if (row.type !== "webchat") throw new ValidationError("Este canal no es un chat web.");
  return row;
}

async function deleteQuietly(storage: FileStorage, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    // The chat already points elsewhere: an orphan file is harmless and never served.
    console.error(`[webchat] No se ha podido borrar el logo anterior: ${safeErrorMessage(error)}`);
  }
}

/** Uploads a new logo for the web chat (checked by content and size); the previous file is deleted. */
export async function saveWebchatLogo(
  actor: Actor,
  channelId: string,
  upload: { bytes: Uint8Array },
  storage: FileStorage = getFileStorage(),
): Promise<{ logoFileKey: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const format = checkWebchatLogo(upload.bytes);
  const channel = await loadWebchat(channelId);
  const previous = readWebchatConfig(channel.config).logoFileKey;
  const logoFileKey = generateFileKey(WEBCHAT_LOGO_KEY_PREFIX, format.extension);
  await storage.put(logoFileKey, upload.bytes, format.contentType);
  await db
    .update(channels)
    .set({ config: { ...channel.config, logoFileKey }, updatedAt: new Date() })
    .where(eq(channels.id, channel.id));
  await writeAudit({
    actor,
    action: "channel.configured",
    targetType: "channel",
    targetId: channel.id,
    metadata: { fields: ["logoFileKey"], contentType: format.contentType, size: upload.bytes.byteLength },
  });
  if (previous) await deleteQuietly(storage, previous);
  return { logoFileKey };
}

/** Removes the web chat's own logo: the chat shows the business logo again. */
export async function removeWebchatLogo(actor: Actor, channelId: string, storage: FileStorage = getFileStorage()): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadWebchat(channelId);
  const previous = readWebchatConfig(channel.config).logoFileKey;
  if (!previous) return;
  await db
    .update(channels)
    .set({ config: { ...channel.config, logoFileKey: null }, updatedAt: new Date() })
    .where(eq(channels.id, channel.id));
  await writeAudit({ actor, action: "channel.configured", targetType: "channel", targetId: channel.id, metadata: { fields: ["logoFileKey"] } });
  await deleteQuietly(storage, previous);
}

/** Whether `actor` may see `key` through /api/files: whoever sees Canales, only for the current logo of a web chat. */
export async function canViewWebchatLogo(actor: Actor, key: string): Promise<boolean> {
  if (!can(actor, PERMISSIONS.channels.view) || !key.startsWith(`${WEBCHAT_LOGO_KEY_PREFIX}/`)) return false;
  const rows = await db.select({ config: channels.config }).from(channels).where(eq(channels.type, "webchat"));
  return rows.some((row) => readWebchatConfig(row.config).logoFileKey === key);
}
