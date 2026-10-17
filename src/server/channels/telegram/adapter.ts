// TelegramAdapter: the Bot API behind the common ChannelAdapter contract ([CAN-09]–[CAN-17], [TG-*]). Registered in
// src/server/channels/registry.ts. Demo channels never get here (they use the DemoAdapter, [ARR-11]), nor do replies to
// simulated messages ([AJU-13]). The webhook route checks the secret (webhook.ts); handleWebhook only turns an already
// verified update into this channel's event.
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import type { FileStorage } from "@/server/adapters/file-storage";
import { randomToken } from "@/server/crypto";
import { DEFAULT_CAPABILITIES } from "../capabilities";
import { ChannelSendError, type ChannelAdapter, type ChannelRecord, type OutboundMessage } from "../types";
import { readTelegramSecrets, telegramClientFor, TelegramNotConnectedError, type TelegramDeps } from "./config";
import { validateTelegramToken } from "./connect";
import { checkTelegramHealth } from "./health";
import { downloadTelegramMedia } from "./media";
import { normalizeTelegramUpdate } from "./normalize";
import { loadTelegramChatId, sendTelegramMessage } from "./send";

export type TelegramAdapterDeps = TelegramDeps & { storage?: FileStorage };

/** What validateAndConnect accepts; without a token it checks the one the channel already has (Revalidar). */
const connectInputSchema = z.object({ botToken: z.string().trim().min(1).max(300).optional() }).strict();
/** «Forbidden: bot was blocked by the user» (docs/integracion-telegram.md «Errores»). */
const BLOCKED_CODE = 403;

/** The conversation's customer blocked the bot: kept where a reminder looks before writing ([TG-12]). */
async function markConversationBlocked(conversationId: string): Promise<void> {
  const [row] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId));
  if (!row || row.metadata.telegramBlockedAt) return;
  await db
    .update(conversations)
    .set({ metadata: { ...row.metadata, telegramBlockedAt: new Date().toISOString() }, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

function clientOrSendError(channel: ChannelRecord, deps: TelegramDeps) {
  try {
    return telegramClientFor(channel, deps);
  } catch (error) {
    if (error instanceof TelegramNotConnectedError) throw new ChannelSendError(error.userMessage, false);
    throw error;
  }
}

/** The chat of a message's `chat.id:message_id`. */
function chatOf(externalMessageId: string): string | null {
  const separator = externalMessageId.lastIndexOf(":");
  return separator > 0 ? externalMessageId.slice(0, separator) : null;
}

export function createTelegramAdapter(deps: TelegramAdapterDeps = {}): ChannelAdapter {
  return {
    type: "telegram",
    capabilities: () => DEFAULT_CAPABILITIES.telegram,

    async validateAndConnect(channel, input) {
      const parsed = connectInputSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: "Revisa el token del bot de Telegram." };
      const stored = readTelegramSecrets(channel);
      const botToken = parsed.data.botToken ?? stored?.botToken;
      if (!botToken) return { ok: false, error: "Falta el token del bot." };
      const result = await validateTelegramToken(botToken, channel.id, deps);
      if (!result.ok) return { ok: false, error: result.error };
      // The webhook's secret is the channel's own and stays the same while the channel lives.
      return { ok: true, config: { ...result.bot }, secrets: { bot_token: botToken, webhook_secret: stored?.webhookSecret ?? randomToken() } };
    },

    async healthCheck(channel) {
      return (await checkTelegramHealth(channel, deps)).health;
    },

    async handleWebhook(_channel, input) {
      const event = normalizeTelegramUpdate(input.body)?.event;
      return event ? [event] : [];
    },

    async send(channel: ChannelRecord, message: OutboundMessage) {
      const client = clientOrSendError(channel, deps);
      const chatId = await loadTelegramChatId(message.conversationId, message.recipient.externalIds);
      if (!chatId) throw new ChannelSendError("El contacto no tiene un chat de Telegram al que escribir.", false);
      try {
        return await sendTelegramMessage(client, chatId, message, deps);
      } catch (error) {
        // 403: the customer blocked the bot; nothing more is tried by it until they unblock it ([TG-12]).
        if (error instanceof ChannelSendError && error.channelCode === BLOCKED_CODE) await markConversationBlocked(message.conversationId);
        throw error;
      }
    },

    async downloadMedia(channel, ref) {
      return downloadTelegramMedia(telegramClientFor(channel, deps), { fileId: ref.externalMediaId, mimeType: ref.mimeType });
    },

    async sendTyping(channel, externalMessageId) {
      // «escribiendo…» for five seconds at most; shown only while the AI prepares a reply.
      const chatId = chatOf(externalMessageId);
      if (chatId) await telegramClientFor(channel, deps).sendTyping(chatId);
    },

    async disconnect(channel) {
      // Telegram stops calling this installation; the caller deletes the token ([TG-04]).
      if (readTelegramSecrets(channel)) await telegramClientFor(channel, deps).deleteWebhook();
    },
  };
}

export const telegramAdapter = createTelegramAdapter();
