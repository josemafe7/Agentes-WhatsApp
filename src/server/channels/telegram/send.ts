// Sending through the Bot API ([TG-03], [TG-09], docs/integracion-telegram.md «Envío»): one message per call (a single
// reply per turn), to the chat the customer wrote from. Plain text of 4,096 characters at most (a longer one is cut,
// never split in two); a person's image goes as a photo with its text as the caption. A 429 waits what Telegram asks
// and tries again; what is left is final.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { TELEGRAM_MAX_CAPTION, TELEGRAM_MAX_TEXT, type TelegramClient } from "@/lib/telegram/client";
import { isTelegramApiError } from "@/lib/telegram/errors";
import { getFileStorage, readAll, type FileStorage } from "@/server/adapters/file-storage";
import { safeErrorMessage } from "@/server/redact";
import { ChannelSendError, type OutboundMessage, type SendResult } from "../types";
import { telegramExternalId } from "./normalize";

/** First try plus retries of a transient error. */
export const SEND_MAX_ATTEMPTS = 4;
/** The retries never wait longer than this in total: the reply job has a time budget. */
export const SEND_MAX_TOTAL_WAIT_MS = 10_000;
const BASE_DELAY_MS = 1_000;
const ELLIPSIS = "…";
/** Newest inbound messages looked at for the chat to answer in. */
const CHAT_LOOKUP_MESSAGES = 5;

/** `text` cut to `max` UTF-16 units (how Telegram counts), ending in «…» and never in half a character. */
export function fitTelegramText(text: string, max: number = TELEGRAM_MAX_TEXT): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - ELLIPSIS.length);
  const last = cut.charCodeAt(cut.length - 1);
  // A high surrogate left alone at the end is the first half of a character (an emoji) cut in two.
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}${ELLIPSIS}`;
}

/** Wait before retry number `retry` (0-based): what Telegram asks for (429), else 1 s, 2 s, 4 s… */
export function sendRetryDelayMs(retryAfterSec: number | null, retry: number): number {
  return retryAfterSec !== null ? retryAfterSec * 1_000 : BASE_DELAY_MS * 2 ** retry;
}

/**
 * The chat to answer in: the one the conversation's newest message came from («La conversación guarda chat.id»), else
 * the contact's Telegram id (in a private chat they are the same). null when there is neither.
 */
export async function loadTelegramChatId(conversationId: string, externalIds: readonly string[]): Promise<string | null> {
  const rows = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.createdAt))
    .limit(CHAT_LOOKUP_MESSAGES);
  const stored = rows.map((row) => row.metadata.telegramChatId).find((value): value is string => typeof value === "string" && /^-?\d{1,20}$/.test(value));
  return stored ?? externalIds.find((id) => /^\d{1,20}$/.test(id)) ?? null;
}

export type SendDeps = { sleep?: (ms: number) => Promise<void>; storage?: FileStorage };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function sendOnce(client: TelegramClient, chatId: string, message: OutboundMessage, storage: FileStorage) {
  if (message.contentType === "text") {
    const text = message.text?.trim();
    if (!text) throw new ChannelSendError("El mensaje está vacío.", false);
    return client.sendMessage({ chatId, text: fitTelegramText(text) });
  }
  if (message.contentType === "image") {
    const fileKey = message.media?.fileKey;
    const file = fileKey ? await storage.get(fileKey) : null;
    if (!file) throw new ChannelSendError("No se ha encontrado el archivo del mensaje.", false);
    const bytes = await readAll(file.stream);
    const caption = message.text?.trim() ? fitTelegramText(message.text.trim(), TELEGRAM_MAX_CAPTION) : null;
    return client.sendPhoto({ chatId, file: { bytes, mimeType: message.media?.mimeType ?? file.contentType, fileName: message.media?.fileName ?? null }, caption });
  }
  throw new ChannelSendError("Este tipo de mensaje no se puede enviar por Telegram.", false);
}

/**
 * Sends one message and returns its id in the channel; transient errors are retried with bounded waits. Throws
 * ChannelSendError with the Spanish message and Telegram's code; it is final (retryable false): the retries already ran.
 */
export async function sendTelegramMessage(client: TelegramClient, chatId: string, message: OutboundMessage, deps: SendDeps = {}): Promise<SendResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const storage = deps.storage ?? getFileStorage();
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      const sent = await sendOnce(client, chatId, message, storage);
      // Telegram tells bots nothing more about a message: it stays «enviado».
      return { externalId: telegramExternalId(sent.chat.id, sent.message_id), status: "sent", sentAt: new Date() };
    } catch (error) {
      if (error instanceof ChannelSendError) throw error;
      if (!isTelegramApiError(error)) {
        console.error(`[telegram] Envío fallido: ${safeErrorMessage(error)}`);
        throw new ChannelSendError("No se ha podido enviar el mensaje por un error inesperado.", false);
      }
      const delay = sendRetryDelayMs(error.retryAfterSec, attempt - 1);
      if (error.retryable && attempt < SEND_MAX_ATTEMPTS && waited + delay <= SEND_MAX_TOTAL_WAIT_MS) {
        waited += delay;
        await sleep(delay);
        continue;
      }
      throw new ChannelSendError(error.userMessage, false, error.code ?? undefined);
    }
  }
}
