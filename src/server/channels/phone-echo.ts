// What the business writes to a customer from its own phone, on a number that also lives there (coexistence through
// YCloud, [YC-08]; a number linked by QR code, [QR-09]). The channel tells the app about it and the message joins the
// customer's conversation as a person's, marked «Desde el móvil»; the AI pauses there for the business's pause hours,
// as when a person answers from the inbox ([BAN-11]), and a pending AI reply is dropped. A message the app itself sent
// comes back the same way: it is already stored with that id, so it is told apart and nothing happens.
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { conversations, messages, type MessageMedia } from "@/db/schema";
import type { MessageContentType } from "@/lib/enums";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { replyDedupeKey } from "@/server/engine/schedule";
import { recordFirstHumanResponse } from "@/server/handoff/service";
import { upsertContactForSender } from "@/server/inbound/contacts";
import { messageSearchText } from "@/server/inbound/message-search";
import { publishConversationEvent } from "@/server/realtime/events";
import { storableJson } from "@/server/storable-text";
import type { ChannelRecord, InboundSender } from "./types";

/** Who a message written on the phone is signed by in the inbox. */
export const PHONE_SENDER_NAME = "Desde el móvil";
export const PHONE_PAUSE_REASON = "Has respondido desde el móvil";
const HOUR_MS = 60 * 60_000;
/** Conversations of a channel + contact looked at: one real and one simulated at most, in practice. */
const CONVERSATION_CANDIDATES = 10;

export type PhoneEcho = {
  /** Ids of the message in the channel (the first is stored): any of them already stored = our own send, or a repeat. */
  externalIds: string[];
  /** The customer it was written to: their identities in the channel type, most stable first. Never keyed by phone. */
  recipient: InboundSender;
  contentType: MessageContentType;
  text: string | null;
  media?: MessageMedia | null;
  sentAt: Date;
  metadata?: Record<string, unknown>;
};

export type PhoneEchoOutcome = { kind: "recorded"; conversationId: string; messageId: string } | { kind: "duplicate" };

export async function recordPhoneEcho(channel: ChannelRecord, received: PhoneEcho, options: { now?: Date; queue?: JobQueue } = {}): Promise<PhoneEchoOutcome> {
  const now = options.now ?? new Date();
  const echo = storableJson(received);
  const ids = echo.externalIds.filter(Boolean);
  if (ids.length === 0) return { kind: "duplicate" };
  const { aiPauseHours } = await loadBusinessSettings();
  const recorded = await db.transaction(async (tx) => {
    const [known] = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.channelId, channel.id), inArray(messages.externalId, ids)));
    if (known) return null;
    const { contactId } = await upsertContactForSender(tx, channel.type, echo.recipient, now);
    const candidates = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.channelId, channel.id), eq(conversations.contactId, contactId), eq(conversations.isTest, false)))
      .orderBy(desc(conversations.createdAt))
      .limit(CONVERSATION_CANDIDATES);
    // Never into a conversation the simulator started ([AJU-13]).
    const existing = candidates.find((row) => row.metadata.simulated !== true);
    const conversation =
      existing ??
      (await tx.insert(conversations).values({ channelId: channel.id, contactId, status: "open", aiMode: "ai", createdAt: now, updatedAt: now }).returning())[0];
    const [message] = await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        channelId: channel.id,
        direction: "outbound",
        senderType: "human",
        senderName: PHONE_SENDER_NAME,
        externalId: ids[0],
        contentType: echo.contentType,
        text: echo.text,
        searchText: messageSearchText(echo.text),
        media: echo.media ?? null,
        status: "sent",
        metadata: { ...echo.metadata, sentFromPhone: true },
        sentAt: echo.sentAt,
        statusUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
      .returning({ id: messages.id });
    if (!message) return null;
    const aiPausedUntil = conversation.aiMode === "ai" ? new Date(now.getTime() + aiPauseHours * HOUR_MS) : null;
    await tx
      .update(conversations)
      .set({
        lastOutboundAt: echo.sentAt,
        lastMessageAt: now,
        // The business has just answered there: nothing is left unread.
        unreadCount: 0,
        ...(aiPausedUntil && (!conversation.aiPausedUntil || conversation.aiPausedUntil < aiPausedUntil) ? { aiPausedUntil, pauseReason: PHONE_PAUSE_REASON } : {}),
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    await recordFirstHumanResponse(tx, conversation.id, message.id, now);
    await publishConversationEvent(
      { type: "message.created", conversationId: conversation.id, channelId: channel.id, messageId: message.id, direction: "outbound", senderType: "human" },
      { channelType: channel.type, executor: tx },
    );
    await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: channel.id, change: "ai" }, { channelType: channel.type, executor: tx });
    return { conversationId: conversation.id, messageId: message.id };
  });
  if (!recorded) return { kind: "duplicate" };
  await (options.queue ?? getJobQueue()).cancel({ dedupeKey: replyDedupeKey(recorded.conversationId) });
  return { kind: "recorded", ...recorded };
}
