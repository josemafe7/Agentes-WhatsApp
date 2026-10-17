// A Telegram update → the normalized event of the common pipeline ([TG-03], [CAN-13], docs/integracion-telegram.md
// «Recepción» and «Forma de los datos»). Pure (no database): webhook.ts and the poll ingest the event and queue the
// download. Only private chats and only what people do: their messages, a tap on a reminder's button ([TG-13]) and
// blocking or unblocking the bot ([TG-12]); groups, channels, other bots and every other kind of update are ignored. The identity is the user's id (`from.id`), never a phone. What Telegram sends is data, never
// instructions.
import "server-only";
import {
  telegramCallbackQuerySchema,
  telegramChatMemberUpdatedSchema,
  telegramMessageSchema,
  telegramPhotoSizeSchema,
  telegramUpdateSchema,
  telegramVoiceSchema,
  type TelegramPhotoSize,
} from "@/lib/telegram/schemas";
import type { InboundMessageEvent } from "../types";
import { UNSUPPORTED_TEXT } from "../whatsapp/normalize";

/** The file of a voice note or a photo, still on Telegram: downloaded in a job right after ([TG-11]). */
export type TelegramMediaDownload = { externalId: string; fileId: string; mimeType: string };

export type NormalizedTelegramUpdate = {
  updateId: number;
  /** null: nothing this app handles (another kind of update, a group, a bot…). */
  event: InboundMessageEvent | null;
  download: TelegramMediaDownload | null;
  /** A button's tap, which must always be answered ([TG-13]). */
  callbackQueryId?: string;
  /** The customer blocked (true) or unblocked (false) the bot ([TG-12]). */
  blocked?: { userId: string; blocked: boolean };
};

/** The two buttons of a reminder: «rc:<reminder>» confirms, «rx:<reminder>» asks to change it ([TG-13]). */
const REMINDER_BUTTON = /^r([cx]):([0-9a-f-]{36})$/;
const REMINDER_LABELS = { confirm: "Confirmo", change: "Necesito cambiarla" } as const;
/** «No quiero publicidad» of an envío: «mo:<contact of the envío>» ([ENV-06]). */
const MARKETING_OPT_OUT_BUTTON = /^mo:([0-9a-f-]{36})$/;
const MARKETING_OPT_OUT_LABEL = "No quiero publicidad";

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

/** A tap: answered always; when it is a reminder's button, also the customer's message about that booking. */
function callbackQuery(ignored: NormalizedTelegramUpdate, raw: unknown, now: Date): NormalizedTelegramUpdate {
  const parsed = telegramCallbackQuerySchema.safeParse(raw);
  if (!parsed.success) return ignored;
  const query = parsed.data;
  const answered = { ...ignored, callbackQueryId: query.id };
  if (!query.message || query.message.chat.type !== "private" || query.from.is_bot) return answered;
  const sender = { externalIds: [query.from.id], displayName: clean([query.from.first_name, query.from.last_name].filter(Boolean).join(" ")) };
  const marketing = MARKETING_OPT_OUT_BUTTON.exec(query.data ?? "");
  if (marketing) {
    return {
      ...answered,
      event: {
        kind: "inbound_message",
        externalId: `cb:${query.id}`,
        sender,
        contentType: "interactive",
        text: MARKETING_OPT_OUT_LABEL,
        sentAt: now,
        metadata: { telegramChatId: query.message.chat.id, button: { text: MARKETING_OPT_OUT_LABEL, payload: query.data }, marketingOptOutButton: { recipientId: marketing[1] } },
      },
    };
  }
  const match = REMINDER_BUTTON.exec(query.data ?? "");
  if (!match) return answered;
  const action = match[1] === "c" ? "confirm" : "change";
  const text = REMINDER_LABELS[action];
  return {
    ...answered,
    event: {
      kind: "inbound_message",
      externalId: `cb:${query.id}`,
      sender,
      contentType: "interactive",
      text,
      sentAt: now,
      metadata: { telegramChatId: query.message.chat.id, button: { text, payload: query.data }, reminderButton: { sendId: match[2], action } },
    },
  };
}

/** Null when `body` is not a Telegram update at all. */
export function normalizeTelegramUpdate(body: unknown, now: Date = new Date()): NormalizedTelegramUpdate | null {
  const update = telegramUpdateSchema.safeParse(body);
  if (!update.success) return null;
  const ignored: NormalizedTelegramUpdate = { updateId: update.data.update_id, event: null, download: null };
  if (update.data.callback_query !== undefined) return callbackQuery(ignored, update.data.callback_query, now);
  if (update.data.my_chat_member !== undefined) {
    const member = telegramChatMemberUpdatedSchema.safeParse(update.data.my_chat_member);
    if (!member.success || member.data.chat.type !== "private") return ignored;
    // «kicked» when the customer blocks the bot, «member» when they unblock it; «left» counts as blocked too.
    const status = member.data.new_chat_member.status;
    if (status !== "kicked" && status !== "left" && status !== "member") return ignored;
    return { ...ignored, blocked: { userId: member.data.from.id, blocked: status !== "member" } };
  }
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
