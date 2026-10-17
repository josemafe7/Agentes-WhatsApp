// Zod schemas of what the product reads from the Telegram Bot API (docs/integracion-telegram.md «Forma de los datos»).
// Unknown fields are dropped (Telegram adds fields in every version); an update is validated only AFTER its secret
// ([TG-02]) and what it carries is data, never instructions ([SEG-05]).
import { z } from "zod";

const text = (max: number) => z.string().max(max);

/** User and chat ids have up to 52 significant bits: they fit a JS number, and are kept as text everywhere else. */
export const telegramId = z.union([z.number().int(), z.string().regex(/^-?\d{1,20}$/)]).transform((value) => String(value));

/** `{ ok: false, error_code, description, parameters }` of a failed call. */
export const telegramErrorBodySchema = z.object({
  ok: z.literal(false),
  error_code: z.number().int().nullish(),
  description: z.string().nullish(),
  parameters: z.object({ retry_after: z.number().nullish(), migrate_to_chat_id: z.number().nullish() }).nullish(),
});

export const telegramOkBodySchema = z.object({ ok: z.literal(true), result: z.unknown() });

export const telegramUserSchema = z.object({
  id: telegramId,
  is_bot: z.boolean().nullish(),
  first_name: text(300).nullish(),
  last_name: text(300).nullish(),
  username: text(100).nullish(),
});
export type TelegramUser = z.infer<typeof telegramUserSchema>;

/** getMe: the bot itself; `username` is always there for a bot. */
export const telegramBotSchema = telegramUserSchema.extend({ is_bot: z.literal(true), username: text(100).min(1) });
export type TelegramBot = z.infer<typeof telegramBotSchema>;

export const telegramWebhookInfoSchema = z.object({
  url: z.string().max(2_000),
  pending_update_count: z.number().int().nonnegative().nullish(),
  last_error_date: z.number().int().nullish(),
  last_error_message: text(1_000).nullish(),
  allowed_updates: z.array(z.string()).nullish(),
});
export type TelegramWebhookInfo = z.infer<typeof telegramWebhookInfoSchema>;

export const telegramFileSchema = z.object({
  file_id: text(500),
  file_size: z.number().int().nonnegative().nullish(),
  file_path: text(1_000).nullish(),
});
export type TelegramFile = z.infer<typeof telegramFileSchema>;

const fileRef = { file_id: text(500).min(1), file_size: z.number().int().nonnegative().nullish() };

export const telegramPhotoSizeSchema = z.object({ ...fileRef, width: z.number().int().nonnegative(), height: z.number().int().nonnegative() });
export type TelegramPhotoSize = z.infer<typeof telegramPhotoSizeSchema>;

export const telegramVoiceSchema = z.object({ ...fileRef, duration: z.number().nonnegative().nullish(), mime_type: text(200).nullish() });
export type TelegramVoice = z.infer<typeof telegramVoiceSchema>;

export const telegramChatSchema = z.object({ id: telegramId, type: text(40) });

/**
 * A message of an update. Only text, voice notes and photos are read ([TG-03]); the other kinds are only looked at to
 * say «Tipo de mensaje no admitido», so their content is not validated.
 */
export const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: telegramUserSchema.nullish(),
  chat: telegramChatSchema,
  /** Unix time, in seconds. */
  date: z.number().int().nonnegative(),
  text: text(20_000).nullish(),
  caption: text(20_000).nullish(),
  photo: z.array(z.unknown()).nullish(),
  voice: z.unknown().optional(),
});
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z.unknown().optional(),
  callback_query: z.unknown().optional(),
  my_chat_member: z.unknown().optional(),
});

/** A tap on a button of one of the bot's messages (docs/integracion-telegram.md «Botones del recordatorio…»). */
export const telegramCallbackQuerySchema = z.object({
  id: text(200).min(1),
  from: telegramUserSchema,
  /** The bot's message with the button; `date: 0` when it is no longer accessible. */
  message: z.object({ message_id: z.number().int(), chat: z.object({ id: telegramId, type: text(40) }) }).nullish(),
  data: text(64).nullish(),
});

/** The customer blocks or unblocks the bot (in a private chat this update means only that). */
export const telegramChatMemberUpdatedSchema = z.object({
  chat: z.object({ id: telegramId, type: text(40) }),
  from: telegramUserSchema,
  new_chat_member: z.object({ status: text(40) }),
});
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/** What sendMessage, sendPhoto… return: the sent Message (only its id is used). */
export const telegramSentMessageSchema = z.object({ message_id: z.number().int(), chat: telegramChatSchema });
export type TelegramSentMessage = z.infer<typeof telegramSentMessageSchema>;
