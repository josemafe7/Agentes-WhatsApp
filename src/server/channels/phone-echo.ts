// What the business writes to a customer from its own phone, on a number that also lives there (coexistence through
// YCloud, [YC-08]; a number linked by QR code, [QR-09]), or from the Instagram app on its account ([IG-06]). The channel
// tells the app about it and the message joins the customer's conversation as a person's, marked «Desde el móvil» (or
// as the channel names it); the AI pauses there for the business's pause hours, as when a person answers from the inbox
// ([BAN-11]), and a pending AI reply is dropped. A message the app itself sent comes back the same way: it is already
// stored with that id, so it is told apart and nothing happens. If the channel tells it before the send answers, it is
// taken for the phone's and then undone when the send stores its id (absorbOwnEcho).
import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { db, type Executor } from "@/db";
import { conversations, handoffEvents, messages, type MessageMedia } from "@/db/schema";
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
  /** Who it is signed by and why the AI pauses: «Desde el móvil» unless the channel names its own app ([IG-06]). */
  senderName?: string;
  pauseReason?: string;
};

export type PhoneEchoOutcome = { kind: "recorded"; conversationId: string; messageId: string } | { kind: "duplicate" };

/** The pause an echo set (ISO dates) and the one it replaced, kept on its message. */
type PausedAi = { until: string; before: string | null; reason: string | null };

function readPausedAi(value: unknown): PausedAi | null {
  const pause = value as Partial<PausedAi> | null | undefined;
  if (!pause || typeof pause.until !== "string") return null;
  return { until: pause.until, before: typeof pause.before === "string" ? pause.before : null, reason: typeof pause.reason === "string" ? pause.reason : null };
}

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
    const aiPausedUntil = conversation.aiMode === "ai" ? new Date(now.getTime() + aiPauseHours * HOUR_MS) : null;
    const pauses = aiPausedUntil !== null && (!conversation.aiPausedUntil || conversation.aiPausedUntil < aiPausedUntil);
    // The pause it replaces, in case this turns out to be the app's own message (absorbOwnEcho).
    const pausedAi: PausedAi | null = pauses ? { until: aiPausedUntil.toISOString(), before: conversation.aiPausedUntil?.toISOString() ?? null, reason: conversation.pauseReason } : null;
    const [message] = await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        channelId: channel.id,
        direction: "outbound",
        senderType: "human",
        senderName: echo.senderName ?? PHONE_SENDER_NAME,
        externalId: ids[0],
        contentType: echo.contentType,
        text: echo.text,
        searchText: messageSearchText(echo.text),
        media: echo.media ?? null,
        status: "sent",
        metadata: { ...echo.metadata, sentFromPhone: true, ...(pausedAi ? { pausedAi } : {}) },
        sentAt: echo.sentAt,
        statusUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
      .returning({ id: messages.id });
    if (!message) return null;
    await tx
      .update(conversations)
      .set({
        lastOutboundAt: echo.sentAt,
        lastMessageAt: now,
        // The business has just answered there: nothing is left unread.
        unreadCount: 0,
        ...(pauses ? { aiPausedUntil, pauseReason: echo.pauseReason ?? PHONE_PAUSE_REASON } : {}),
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

/**
 * The channel stored id `externalId` for message `messageId` of the app, which it has just sent. If an echo with that
 * id was recorded meanwhile as written on the phone (the channel told it before the send answered, [IG-06]), that row
 * is this very message: it goes, with the pause and the first response of a hand-off it brought, so the message is
 * stored once and the app's own message never pauses the AI. «taken» = the id is another message's (never expected).
 */
export async function absorbOwnEcho(tx: Executor, channelId: string, externalId: string, messageId: string): Promise<"free" | "absorbed" | "taken"> {
  const [echo] = await tx
    .select({ id: messages.id, conversationId: messages.conversationId, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.externalId, externalId), ne(messages.id, messageId)));
  if (!echo) return "free";
  if (echo.metadata.sentFromPhone !== true) return "taken";
  const now = new Date();
  const pause = readPausedAi(echo.metadata.pausedAi);
  if (pause) {
    // Unless the AI was paused again since.
    await tx
      .update(conversations)
      .set({ aiPausedUntil: pause.before ? new Date(pause.before) : null, pauseReason: pause.reason, updatedAt: now })
      .where(and(eq(conversations.id, echo.conversationId), eq(conversations.aiPausedUntil, new Date(pause.until))));
  }
  // Children first (docs/architecture.md): a hand-off it answered waits for a person again.
  await tx.update(handoffEvents).set({ firstHumanResponseAt: null, firstHumanMessageId: null, updatedAt: now }).where(eq(handoffEvents.firstHumanMessageId, echo.id));
  await tx.delete(messages).where(eq(messages.id, echo.id));
  await publishConversationEvent({ type: "conversation.updated", conversationId: echo.conversationId, channelId, change: "ai" }, { executor: tx });
  return "absorbed";
}
