// Bodies of POST /{PHONE_NUMBER_ID}/messages by type (docs/integracion-whatsapp-mensajes.md §11.4), without the
// destination (`to` or `recipient`) and `messaging_product`, which the sender adds. Pure.
import type { WhatsAppTemplateSend } from "./templates";

export type WhatsAppMediaType = "image" | "audio" | "video" | "document" | "sticker";

/** Only image, video and document take a caption (≤ 1,024 characters); audio and stickers never. */
const CAPTION_TYPES: ReadonlySet<WhatsAppMediaType> = new Set(["image", "video", "document"]);

export function textMessage(body: string, previewUrl = false): Record<string, unknown> {
  return { type: "text", text: { body, preview_url: previewUrl } };
}

/** A file by its uploaded id (preferred: ours are private) or by a public `link` — only one of them. */
export function mediaMessage(
  type: WhatsAppMediaType,
  source: { id: string } | { link: string },
  options: { caption?: string | null; filename?: string | null; voice?: boolean } = {},
): Record<string, unknown> {
  const caption = CAPTION_TYPES.has(type) && options.caption?.trim() ? { caption: options.caption.trim() } : {};
  const filename = type === "document" && options.filename ? { filename: options.filename } : {};
  const voice = type === "audio" && options.voice ? { voice: true } : {};
  return { type, [type]: { ...source, ...caption, ...filename, ...voice } };
}

export function templateMessage(template: WhatsAppTemplateSend): Record<string, unknown> {
  return { type: "template", template };
}

/** A reaction to a message the customer sent (no reply context allowed). */
export function reactionMessage(messageId: string, emoji: string): Record<string, unknown> {
  return { type: "reaction", reaction: { message_id: messageId, emoji } };
}
