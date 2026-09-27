// Daily cap of AI replies per thread and per sender ([COR-17]; 5 and 10 by default, editable) and per mailbox (200, all
// its threads and senders together). Checked when a new email arrives and again by the reply job right before it
// sends: if the AI already reached a cap today (the business's day, in its time zone), the conversation pauses until
// the end of that day with the reason, the pending reply is dropped, and a person answers. Counted: the AI's messages
// of the day that were not failed sends (drafts included: each one is a reply the AI wrote). System code.
import "server-only";
import { TZDate } from "@date-fns/tz";
import { and, count, eq, gte, ne } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { replyDedupeKey } from "@/server/engine/schedule";
import { publishConversationEvent } from "@/server/realtime/events";
import type { ChannelRecord } from "../types";
import { readEmailConfig } from "./config";
import { DAILY_CAP_PER_CHANNEL } from "./constants";

export const CAP_REASON_THREAD = "Tope diario de respuestas de la IA en este hilo";
export const CAP_REASON_SENDER = "Tope diario de respuestas de la IA a este remitente";
export const CAP_REASON_CHANNEL = "Tope diario de respuestas de la IA en este buzón";

export type DailyCap = "thread" | "sender" | "channel";
const CAP_REASONS: Record<DailyCap, string> = { thread: CAP_REASON_THREAD, sender: CAP_REASON_SENDER, channel: CAP_REASON_CHANNEL };

/** Start of the business's day that contains `now`, and of the next one. */
export function businessDayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const local = new TZDate(now.getTime(), timeZone);
  const start = new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), timeZone);
  const end = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + 1, timeZone);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

export type CapCounts = { thread: number; sender: number; channel?: number };
export type CapLimits = { perThread: number; perSender: number; perChannel?: number };

/** Which cap is reached, if any. Pure. */
export function reachedCap(counts: CapCounts, limits: CapLimits): DailyCap | null {
  if (counts.thread >= limits.perThread) return "thread";
  if (counts.sender >= limits.perSender) return "sender";
  if (limits.perChannel !== undefined && (counts.channel ?? 0) >= limits.perChannel) return "channel";
  return null;
}

const aiReplies = (since: Date) => and(eq(messages.direction, "outbound"), eq(messages.senderType, "ai"), ne(messages.status, "failed"), gte(messages.createdAt, since));

/** AI replies since `since` in the conversation, to the same contact in any thread of the channel, and in the channel. */
export async function countAiReplies(channelId: string, conversationId: string, contactId: string | null, since: Date): Promise<Required<CapCounts>> {
  const [thread] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), aiReplies(since)));
  const [sender] = contactId
    ? await db
        .select({ n: count() })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(conversations.channelId, channelId), eq(conversations.contactId, contactId), aiReplies(since)))
    : [{ n: 0 }];
  const [channel] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), aiReplies(since)));
  return { thread: thread?.n ?? 0, sender: sender?.n ?? 0, channel: channel?.n ?? 0 };
}

type CappedChannel = Pick<ChannelRecord, "id" | "type" | "config">;

/** The cap of the business day of `now` that the conversation has reached, if any; changes nothing. */
async function capOf(channel: CappedChannel, conversation: { id: string; contactId: string | null }, now: Date): Promise<{ cap: DailyCap | null; end: Date }> {
  const { timezone } = await loadBusinessSettings();
  const { start, end } = businessDayBounds(now, timezone);
  const config = readEmailConfig(channel.config);
  const counts = await countAiReplies(channel.id, conversation.id, conversation.contactId, start);
  return { cap: reachedCap(counts, { perThread: config.dailyCapPerThread, perSender: config.dailyCapPerSender, perChannel: DAILY_CAP_PER_CHANNEL }), end };
}

/**
 * The reply job, right before sending ([COR-17]): the cap the conversation has reached today, if any, whoever wrote
 * since (another thread of the same sender, many senders at once). Changes nothing.
 */
export async function dailyCapReached(channel: CappedChannel, conversationId: string, now: Date = new Date()): Promise<DailyCap | null> {
  const [conversation] = await db.select({ id: conversations.id, contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation) return null;
  return (await capOf(channel, conversation, now)).cap;
}

/**
 * Applies the caps to a conversation that just received an email. Returns the cap reached (and pauses the AI until
 * the end of the business day), or null.
 */
export async function enforceDailyCaps(channel: CappedChannel, conversationId: string, options: { now?: Date; queue?: JobQueue } = {}): Promise<DailyCap | null> {
  const now = options.now ?? new Date();
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation || conversation.aiMode !== "ai") return null;
  const { cap, end } = await capOf(channel, conversation, now);
  if (!cap) return null;
  // A longer pause set by a person stays as it is.
  if (conversation.aiPausedUntil && conversation.aiPausedUntil >= end) return cap;
  await db
    .update(conversations)
    .set({ aiPausedUntil: end, pauseReason: CAP_REASONS[cap], updatedAt: now })
    .where(eq(conversations.id, conversation.id));
  await (options.queue ?? getJobQueue()).cancel({ dedupeKey: replyDedupeKey(conversation.id) });
  await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: channel.id, change: "ai" }, { channelType: channel.type });
  return cap;
}
