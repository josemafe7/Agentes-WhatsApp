// Daily cap of AI replies per thread and per sender ([COR-17]; 5 and 10 by default, editable). Checked when a new
// email arrives: if the AI already reached a cap today (the business's day, in its time zone), the conversation pauses
// until the end of that day with the reason, the pending reply is dropped, and a person answers. Counted: the AI's
// messages of the day that were not failed sends (drafts included: each one is a reply the AI wrote). System code.
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

export const CAP_REASON_THREAD = "Tope diario de respuestas de la IA en este hilo";
export const CAP_REASON_SENDER = "Tope diario de respuestas de la IA a este remitente";

/** Start of the business's day that contains `now`, and of the next one. */
export function businessDayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const local = new TZDate(now.getTime(), timeZone);
  const start = new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), timeZone);
  const end = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + 1, timeZone);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

export type CapCounts = { thread: number; sender: number };
export type CapLimits = { perThread: number; perSender: number };

/** Which cap is reached, if any. Pure. */
export function reachedCap(counts: CapCounts, limits: CapLimits): "thread" | "sender" | null {
  if (counts.thread >= limits.perThread) return "thread";
  if (counts.sender >= limits.perSender) return "sender";
  return null;
}

const aiReplies = (since: Date) => and(eq(messages.direction, "outbound"), eq(messages.senderType, "ai"), ne(messages.status, "failed"), gte(messages.createdAt, since));

/** AI replies since `since` in the conversation, and to the same contact in any thread of the channel. */
export async function countAiReplies(channelId: string, conversationId: string, contactId: string | null, since: Date): Promise<CapCounts> {
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
  return { thread: thread?.n ?? 0, sender: sender?.n ?? 0 };
}

/**
 * Applies the caps to a conversation that just received an email. Returns the cap reached (and pauses the AI until
 * the end of the business day), or null.
 */
export async function enforceDailyCaps(
  channel: Pick<ChannelRecord, "id" | "type" | "config">,
  conversationId: string,
  options: { now?: Date; queue?: JobQueue } = {},
): Promise<"thread" | "sender" | null> {
  const now = options.now ?? new Date();
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation || conversation.aiMode !== "ai") return null;
  const { timezone } = await loadBusinessSettings();
  const { start, end } = businessDayBounds(now, timezone);
  const config = readEmailConfig(channel.config);
  const cap = reachedCap(await countAiReplies(channel.id, conversation.id, conversation.contactId, start), {
    perThread: config.dailyCapPerThread,
    perSender: config.dailyCapPerSender,
  });
  if (!cap) return null;
  // A longer pause set by a person stays as it is.
  if (conversation.aiPausedUntil && conversation.aiPausedUntil >= end) return cap;
  await db
    .update(conversations)
    .set({ aiPausedUntil: end, pauseReason: cap === "thread" ? CAP_REASON_THREAD : CAP_REASON_SENDER, updatedAt: now })
    .where(eq(conversations.id, conversation.id));
  await (options.queue ?? getJobQueue()).cancel({ dedupeKey: replyDedupeKey(conversation.id) });
  await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: channel.id, change: "ai" }, { channelType: channel.type });
  return cap;
}
