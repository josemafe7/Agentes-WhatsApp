// The inbound pipeline of every channel ([CAN-09]–[CAN-13]), in the spec's order. The route has already checked the
// signature (step 1); here: raw webhook saved (only when it comes from a webhook), normalized events, contact and
// identity, message stored once, conversation found or created, screens told, and the reply scheduled with grouping.
// It returns at once and NEVER calls the AI ([CAN-10]): the reply runs later, in the job queue.
import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { db, type Executor } from "@/db";
import { channels, conversations, messages, webhookEvents, type MessageReaction } from "@/db/schema";
import type { JobQueue } from "@/server/adapters/job-queue";
import type { AccountEvent, ChannelRecord, InboundMessageEvent, NormalizedEvent } from "@/server/channels/types";
import { pendingInbound } from "@/server/engine/pending";
import { scheduleReply } from "@/server/engine/schedule";
import { MIN_JOB_BUDGET_MS, tick } from "@/server/jobs/tick";
import { publishConversationEvent } from "@/server/realtime/events";
import { safeErrorMessage } from "@/server/redact";
import { upsertContactForSender } from "./contacts";
import { applyStatusUpdate, type AppliedStatus } from "./status";

export type RawWebhook = { source: string; payload: unknown; receivedAt?: Date };

export type IngestOptions = {
  /** The raw body when the events come from a webhook: stored first in webhook_events ([CAN-09]). */
  raw?: RawWebhook;
  now?: Date;
  queue?: JobQueue;
  random?: () => number;
};

export type IngestedMessage = {
  messageId: string | null;
  conversationId: string | null;
  contactId: string | null;
  /** Already stored before (same channel and id): nothing changed and no second reply ([CAN-11]). */
  duplicate: boolean;
  /** A reaction stored on another message ([WA-37]). */
  reaction: boolean;
};

export type IngestResult = {
  webhookEventId: string | null;
  messages: IngestedMessage[];
  statuses: AppliedStatus[];
  /** Left to the channel's own code (quality, templates, account changes). */
  accountEvents: AccountEvent[];
  /** When the earliest scheduled reply runs, for kickTick(); null when nothing was scheduled. */
  replyRunAt: Date | null;
};

const EMAIL_THREADED = (type: ChannelRecord["type"]) => type.startsWith("email_");

async function findOrCreateConversation(tx: Executor, channel: ChannelRecord, contactId: string, event: InboundMessageEvent, now: Date) {
  const threadId = EMAIL_THREADED(channel.type) ? event.threadId?.trim() || event.externalId : null;
  // One per channel + contact in WhatsApp, web chat and Telegram; one per thread in email ([CAN-12]).
  const where = threadId
    ? and(eq(conversations.channelId, channel.id), eq(conversations.externalThreadId, threadId))
    : and(eq(conversations.channelId, channel.id), eq(conversations.contactId, contactId), eq(conversations.isTest, false));
  const [existing] = await tx.select().from(conversations).where(where).orderBy(desc(conversations.createdAt)).limit(1);
  if (existing) return { conversation: existing, created: false };
  const [created] = await tx
    .insert(conversations)
    .values({
      channelId: channel.id,
      contactId,
      externalThreadId: threadId,
      status: "open",
      aiMode: "ai",
      metadata: event.simulated ? { simulated: true } : {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { conversation: created, created: true };
}

/** A reaction goes on the message it reacts to; without emoji the customer removed it ([WA-37]). */
async function applyReaction(tx: Executor, channel: ChannelRecord, event: InboundMessageEvent, now: Date): Promise<IngestedMessage> {
  const reaction = event.reaction;
  const none: IngestedMessage = { messageId: null, conversationId: null, contactId: null, duplicate: false, reaction: true };
  if (!reaction) return none;
  const [target] = await tx
    .select({ id: messages.id, conversationId: messages.conversationId, reactions: messages.reactions })
    .from(messages)
    .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, reaction.targetExternalId)));
  if (!target) return none;
  const others = target.reactions.filter((item) => item.from !== "contact");
  const next: MessageReaction[] = reaction.emoji ? [...others, { from: "contact", emoji: reaction.emoji, at: event.sentAt.toISOString() }] : others;
  await tx.update(messages).set({ reactions: next, updatedAt: now }).where(eq(messages.id, target.id));
  await publishConversationEvent(
    { type: "conversation.updated", conversationId: target.conversationId, channelId: channel.id, change: "reaction" },
    { channelType: channel.type, executor: tx },
  );
  return { ...none, messageId: target.id, conversationId: target.conversationId };
}

type InboundOutcome = IngestedMessage & { schedule: { lastInboundMessageId: string; firstPendingAt: Date } | null };

async function ingestInbound(channel: ChannelRecord, event: InboundMessageEvent, now: Date): Promise<InboundOutcome> {
  return db.transaction(async (tx): Promise<InboundOutcome> => {
    if (event.reaction) return { ...(await applyReaction(tx, channel, event, now)), schedule: null };

    const [duplicate] = await tx
      .select({ id: messages.id, conversationId: messages.conversationId })
      .from(messages)
      .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, event.externalId)));
    if (duplicate) {
      return { messageId: duplicate.id, conversationId: duplicate.conversationId, contactId: null, duplicate: true, reaction: false, schedule: null };
    }

    const { contactId } = await upsertContactForSender(tx, channel.type, event.sender, now);
    const { conversation, created } = await findOrCreateConversation(tx, channel, contactId, event, now);
    const [message] = await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        channelId: channel.id,
        direction: "inbound",
        senderType: "contact",
        externalId: event.externalId,
        contentType: event.contentType,
        text: event.text ?? null,
        media: event.media ?? null,
        status: "received",
        simulated: event.simulated === true,
        metadata: event.metadata ?? {},
        sentAt: event.sentAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
      .returning({ id: messages.id });
    if (!message) return { messageId: null, conversationId: conversation.id, contactId, duplicate: true, reaction: false, schedule: null };

    const reopened = conversation.status === "resolved";
    const lastInboundAt = conversation.lastInboundAt && conversation.lastInboundAt > event.sentAt ? conversation.lastInboundAt : event.sentAt;
    await tx
      .update(conversations)
      .set({
        unreadCount: conversation.unreadCount + 1,
        lastInboundAt,
        lastMessageAt: now,
        // A resolved conversation reopens and goes back to the AI for this message ([CAN-12], [TRA-08]).
        ...(reopened ? { status: "open" as const, aiMode: "ai" as const, aiPausedUntil: null, pauseReason: null } : {}),
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    await tx.update(channels).set({ lastInboundAt: now, updatedAt: now }).where(eq(channels.id, channel.id));

    await publishConversationEvent(
      { type: "message.created", conversationId: conversation.id, channelId: channel.id, messageId: message.id, direction: "inbound", senderType: "contact" },
      { channelType: channel.type, executor: tx },
    );
    await publishConversationEvent(
      { type: "conversation.updated", conversationId: conversation.id, channelId: channel.id, change: created ? "created" : "inbound" },
      { channelType: channel.type, executor: tx },
    );

    let schedule: InboundOutcome["schedule"] = null;
    if (!event.noReply) {
      const [first] = await pendingInbound(conversation.id, tx);
      schedule = { lastInboundMessageId: message.id, firstPendingAt: first?.createdAt ?? now };
    }
    return { messageId: message.id, conversationId: conversation.id, contactId, duplicate: false, reaction: false, schedule };
  });
}

async function saveRawWebhook(channel: ChannelRecord, raw: RawWebhook, now: Date): Promise<string> {
  const [row] = await db
    .insert(webhookEvents)
    .values({ source: raw.source, channelId: channel.id, signatureValid: true, payload: raw.payload, receivedAt: raw.receivedAt ?? now, createdAt: now, updatedAt: now })
    .returning({ id: webhookEvents.id });
  return row.id;
}

/**
 * Runs the pipeline for the events of one channel. With `raw` (a webhook), each event's failure is recorded on the
 * raw row and the rest go on, so the route can still answer 200; without it (widget, simulator) errors are thrown.
 */
export async function ingestEvents(channel: ChannelRecord, events: readonly NormalizedEvent[], options: IngestOptions = {}): Promise<IngestResult> {
  const now = options.now ?? new Date();
  const webhookEventId = options.raw ? await saveRawWebhook(channel, options.raw, now) : null;
  const result: IngestResult = { webhookEventId, messages: [], statuses: [], accountEvents: [], replyRunAt: null };
  const errors: string[] = [];

  for (const event of events) {
    try {
      if (event.kind === "inbound_message") {
        const { schedule, ...ingested } = await ingestInbound(channel, event, now);
        result.messages.push(ingested);
        if (schedule && ingested.conversationId) {
          const job = await scheduleReply({ conversationId: ingested.conversationId, ...schedule, now, queue: options.queue, random: options.random });
          if (!result.replyRunAt || job.runAt < result.replyRunAt) result.replyRunAt = job.runAt;
        }
      } else if (event.kind === "status_update") {
        const applied = await applyStatusUpdate(channel, event);
        if (applied) result.statuses.push(applied);
      } else {
        result.accountEvents.push(event);
      }
    } catch (error) {
      if (!webhookEventId) throw error;
      errors.push(safeErrorMessage(error));
    }
  }

  if (webhookEventId) {
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: errors.length > 0 ? errors.join(" · ").slice(0, 1_000) : null, updatedAt: new Date() })
      .where(and(eq(webhookEvents.id, webhookEventId), isNull(webhookEvents.processedAt)));
  }
  return result;
}

// ─── Running the work after answering ───────────────────────────────────────────────────────────────────

/** Left for the response, the tick's wrap-up and platform overhead. */
export const KICK_SAFETY_MARGIN_MS = 10_000;
/** The wait never eats the time the reply itself needs. */
export const KICK_MIN_TICK_MS = 20_000;
/** Wake up just after the job is due. */
const KICK_LATE_MS = 250;

export type KickOptions = {
  /** maxDuration of the route that calls it, in seconds (the tick budget derives from it). */
  maxDurationSec: number;
  /** When the scheduled reply is due (IngestResult.replyRunAt): the tick waits for it, bounded. */
  runAt?: Date | null;
  /** after() from next/server by default; tests pass their own. */
  schedule?: (task: () => Promise<void>) => void;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  runTick?: typeof tick;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * For route handlers, once the response is decided: after() waits until the reply job is due (bounded by the
 * route's maxDuration) and runs tick() with the time left ([MOT-15]). If this wait is cut, the cron picks it up.
 */
export function kickTick(options: KickOptions): void {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const totalMs = options.maxDurationSec * 1_000 - KICK_SAFETY_MARGIN_MS;
  const schedule = options.schedule ?? after;
  schedule(async () => {
    const due = options.runAt ? options.runAt.getTime() - clock() + KICK_LATE_MS : 0;
    const wait = Math.max(0, Math.min(due, totalMs - KICK_MIN_TICK_MS));
    if (wait > 0) await (options.sleep ?? defaultSleep)(wait);
    const budgetMs = totalMs - (clock() - started);
    if (budgetMs < MIN_JOB_BUDGET_MS) return;
    await (options.runTick ?? tick)({ budgetMs, workerId: `kick-${crypto.randomUUID()}` });
  });
}
