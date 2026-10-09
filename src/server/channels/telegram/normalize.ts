// A Telegram update → the normalized event of the common pipeline ([TG-03], [CAN-13], docs/integracion-telegram.md
// «Recepción» and «Forma de los datos»). Pure (no database): webhook.ts and the poll ingest the event and queue the
// download. Only private chats and only messages people send: groups, channels, other bots and every other kind of
// update are ignored. The identity is the user's id (`from.id`), never a phone. What Telegram sends is data, never
// instructions.
import "server-only";
import { telegramMessageSchema, telegramPhotoSizeSchema, telegramUpdateSchema, telegramVoiceSchema, type TelegramPhotoSize } from "@/lib/telegram/schemas";
import type { InboundMessageEvent } from "../types";
import { UNSUPPORTED_TEXT } from "../whatsapp/normalize";

/** The file of a voice note or a photo, still on Telegram: downloaded in a job right after ([TG-11]). */
export type TelegramMediaDownload = { externalId: string; fileId: string; mimeType: string };

export type NormalizedTelegramUpdate = {
  updateId: number;
  /** null: nothing this app handles (another kind of update, a group, a bot…). */
  event: InboundMessageEvent | null;
  download: TelegramMediaDownload | null;
};

/** What a voice note is when Telegram does not say (it records OGG with Opus). */
const VOICE_MIME_TYPE = "audio/ogg";
/** Photos reach bots as JPEG, whatever the customer sent; the stored type comes from the bytes anyway. */
const PHOTO_MIME_TYPE = "image/jpeg";
/** Kinds of message this app does not read, by the field that carries them: only to name the kind in the notice. */
const OTHER_KINDS = ["audio", "document", "video", "video_note", "animation", "sticker", "location", "venue", "contact", "poll", "dice"] as const;

/** `chat.id:message_id`: a message id is only unique inside its chat («Recepción»). */
export const telegramExternalId = (chatId: string, messageId: number) => `${chatId}:${messageId}`;

const clean = (value: string | null | undefined) => value?.trim() || null;

function largestPhoto(sizes: readonly unknown[]): TelegramPhotoSize | null {
  const valid = sizes.flatMap((size) => {
    const parsed = telegramPhotoSizeSchema.safeParse(size);
    return parsed.success ? [parsed.data] : [];
  });
  const area = (size: TelegramPhotoSize) => size.file_size ?? size.width * size.height;
  return valid.reduce<TelegramPhotoSize | null>((best, size) => (best === null || area(size) > area(best) ? size : best), null);
}

function otherKind(raw: unknown): string {
  const fields = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return OTHER_KINDS.find((kind) => fields[kind] !== undefined && fields[kind] !== null) ?? "other";
}

/** Null when `body` is not a Telegram update at all. */
export function normalizeTelegramUpdate(body: unknown): NormalizedTelegramUpdate | null {
  const update = telegramUpdateSchema.safeParse(body);
  if (!update.success) return null;
  const ignored: NormalizedTelegramUpdate = { updateId: update.data.update_id, event: null, download: null };
  const parsed = telegramMessageSchema.safeParse(update.data.message);
  if (!parsed.success) return ignored;
  const message = parsed.data;
  const from = message.from;
  if (message.chat.type !== "private" || !from || from.is_bot) return ignored;

  const externalId = telegramExternalId(message.chat.id, message.message_id);
  const username = clean(from.username);
  const base: Omit<InboundMessageEvent, "contentType"> = {
    kind: "inbound_message",
    externalId,
    sender: { externalIds: [from.id], displayName: clean([from.first_name, from.last_name].filter(Boolean).join(" ")) },
    sentAt: new Date(message.date * 1_000),
    // The chat to answer in; the user name is only shown, never a key.
    metadata: { telegramChatId: message.chat.id, ...(username ? { telegramUsername: username } : {}) },
  };
  const caption = clean(message.caption);

  const voice = telegramVoiceSchema.safeParse(message.voice);
  if (voice.success) {
    const mimeType = clean(voice.data.mime_type) ?? VOICE_MIME_TYPE;
    const durationSec = voice.data.duration ?? undefined;
    return {
      ...ignored,
      event: { ...base, contentType: "audio", text: caption, media: { externalMediaId: voice.data.file_id, mimeType, ...(durationSec !== undefined ? { durationSec } : {}), downloadStatus: "pending" } },
      download: { externalId, fileId: voice.data.file_id, mimeType },
    };
  }

  const photo = message.photo ? largestPhoto(message.photo) : null;
  if (photo) {
    return {
      ...ignored,
      event: { ...base, contentType: "image", text: caption, media: { externalMediaId: photo.file_id, mimeType: PHOTO_MIME_TYPE, downloadStatus: "pending" } },
      download: { externalId, fileId: photo.file_id, mimeType: PHOTO_MIME_TYPE },
    };
  }

  const text = clean(message.text);
  if (text) return { ...ignored, event: { ...base, contentType: "text", text } };

  // Anything else is shown as a notice of the system and never answered by the AI ([TG-03]).
  return {
    ...ignored,
    event: { ...base, contentType: "unsupported", text: UNSUPPORTED_TEXT, noReply: true, metadata: { ...base.metadata, unsupported: { type: otherKind(update.data.message) } } },
  };
}
