// When the reply to a conversation runs ([MOT-01]): a few seconds after the customer's message (4–8 s), waiting again
// if more messages arrive, but never more than 20 s after the first unanswered one. All of them get one reply.
import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getJobQueue, type EnqueueResult, type JobQueue } from "@/server/adapters/job-queue";
import { pendingInbound } from "./pending";

export const REPLY_JOB = "reply";
export const REPLY_DEBOUNCE_MIN_MS = 4_000;
export const REPLY_DEBOUNCE_MAX_MS = 8_000;
/** From the first unanswered customer message ([MOT-01]). */
export const REPLY_MAX_WAIT_MS = 20_000;
/** Tests and the e2e run only: a fixed wait instead of 4–8 s (e.g. REPLY_DEBOUNCE_MS=500). */
export const REPLY_DEBOUNCE_ENV = "REPLY_DEBOUNCE_MS";
/** A reply that fails keeps trying a little, then the conversation waits for a person. */
export const REPLY_MAX_ATTEMPTS = 3;

export const replyJobPayload = z.object({
  conversationId: z.uuid(),
  /** Newest customer message when the job was (re)scheduled: a newer one means the job must wait ([MOT-02]). */
  lastInboundMessageId: z.uuid().nullish(),
});
export type ReplyJobPayload = z.infer<typeof replyJobPayload>;

export const replyDedupeKey = (conversationId: string) => `reply:${conversationId}`;

/** The wait before replying: 4–8 s at random, or REPLY_DEBOUNCE_MS when set (tests only). */
export function replyDebounceMs(random: () => number = Math.random): number {
  const fixed = process.env[REPLY_DEBOUNCE_ENV]?.trim();
  if (fixed && /^\d{1,6}$/.test(fixed)) return Math.min(Number(fixed), REPLY_MAX_WAIT_MS);
  return REPLY_DEBOUNCE_MIN_MS + Math.round(random() * (REPLY_DEBOUNCE_MAX_MS - REPLY_DEBOUNCE_MIN_MS));
}

export type ScheduleReplyInput = {
  conversationId: string;
  lastInboundMessageId: string | null;
  /** Arrival of the oldest customer message still without a reply (the 20 s cap counts from it). */
  firstPendingAt: Date;
  now?: Date;
  queue?: JobQueue;
  random?: () => number;
};

/** Creates or pushes back the one pending reply job of the conversation. Never runs the AI. */
export async function scheduleReply(input: ScheduleReplyInput): Promise<EnqueueResult> {
  const now = input.now ?? new Date();
  const maxRunAt = new Date(Math.max(now.getTime(), input.firstPendingAt.getTime() + REPLY_MAX_WAIT_MS));
  const runAt = new Date(Math.min(now.getTime() + replyDebounceMs(input.random), maxRunAt.getTime()));
  const payload: ReplyJobPayload = { conversationId: input.conversationId, lastInboundMessageId: input.lastInboundMessageId };
  return (input.queue ?? getJobQueue()).upsertDebounced({
    type: REPLY_JOB,
    payload,
    dedupeKey: replyDedupeKey(input.conversationId),
    runAt,
    maxRunAt,
    maxAttempts: REPLY_MAX_ATTEMPTS,
  });
}

/**
 * A person turned the AI of the conversation back on ([BAN-16]): if the customer's last messages are still unanswered,
 * the AI answers them a few seconds later, as it would a new message (the reply job runs every check of [MOT-03]).
 * Nothing when a draft of the AI already waits for review for them. Returns the job, or null.
 */
export async function scheduleReplyToUnanswered(conversationId: string, options: { now?: Date; queue?: JobQueue } = {}): Promise<EnqueueResult | null> {
  const newest = (await pendingInbound(conversationId)).at(-1);
  if (!newest) return null;
  const [draft] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound"), eq(messages.status, "draft"), gte(messages.createdAt, newest.createdAt)))
    .limit(1);
  if (draft) return null;
  const now = options.now ?? new Date();
  return scheduleReply({ conversationId, lastInboundMessageId: newest.id, firstPendingAt: now, now, queue: options.queue });
}
