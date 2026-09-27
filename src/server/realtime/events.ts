// Typed realtime events for the screens ([BAN-03], [WEB-06]), published through the Realtime adapter
// (docs/decisions/0009). Events carry ids only, never message text: the screen reloads what changed through
// src/data, which checks permissions again. Topics: `channel:<id>` (inbox), `user:<id>` (own notifications) and
// `widget:<conversationId>` (the visitor's web chat).
import "server-only";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels } from "@/db/schema";
import { MESSAGE_DIRECTIONS, MESSAGE_STATUSES, SENDER_TYPES, type ChannelType } from "@/lib/enums";
import { can, channelFilter, PERMISSIONS, type Actor } from "@/lib/permissions";
import { getRealtime, type Realtime } from "@/server/adapters/realtime";

/** Why a conversation changed: the screen may use it to reload less. */
export const CONVERSATION_CHANGES = ["created", "inbound", "outbound", "status", "ai", "assignment", "labels", "read", "note", "agent", "handoff", "reaction"] as const;
export type ConversationChange = (typeof CONVERSATION_CHANGES)[number];

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("conversation.updated"), conversationId: z.string(), channelId: z.string(), change: z.enum(CONVERSATION_CHANGES) }),
  z.object({
    type: z.literal("message.created"),
    conversationId: z.string(),
    channelId: z.string(),
    messageId: z.string(),
    direction: z.enum(MESSAGE_DIRECTIONS),
    senderType: z.enum(SENDER_TYPES),
  }),
  z.object({ type: z.literal("message.status"), conversationId: z.string(), channelId: z.string(), messageId: z.string(), status: z.enum(MESSAGE_STATUSES) }),
  z.object({ type: z.literal("notification.created"), notificationId: z.string(), userId: z.string() }),
]);

export type AppRealtimeEvent = z.infer<typeof eventSchema>;
export type ConversationRealtimeEvent = Exclude<AppRealtimeEvent, { type: "notification.created" }>;
/** An event as the screens receive it: its position (cursor) plus its data. */
export type DeliveredRealtimeEvent = AppRealtimeEvent & { cursor: string };

export const channelTopic = (channelId: string) => `channel:${channelId}`;
export const userTopic = (userId: string) => `user:${userId}`;
export const widgetTopic = (conversationId: string) => `widget:${conversationId}`;

/**
 * Publishes a conversation or message event to its channel's topic; message events of a web chat also go to the
 * visitor's widget topic. Pass the transaction to publish atomically with the change.
 */
export async function publishConversationEvent(
  event: ConversationRealtimeEvent,
  options: { channelType?: ChannelType | null; executor?: Executor; realtime?: Realtime } = {},
): Promise<void> {
  const realtime = options.realtime ?? getRealtime();
  await realtime.publish(channelTopic(event.channelId), event, options.executor);
  if (options.channelType === "webchat" && event.type !== "conversation.updated") {
    await realtime.publish(widgetTopic(event.conversationId), event, options.executor);
  }
}

export async function publishNotificationEvent(
  event: { notificationId: string; userId: string },
  options: { executor?: Executor; realtime?: Realtime } = {},
): Promise<void> {
  const payload: AppRealtimeEvent = { type: "notification.created", ...event };
  await (options.realtime ?? getRealtime()).publish(userTopic(event.userId), payload, options.executor);
}

/** Topics a person may listen to: their notifications and the channels whose inbox they see ([PER-02]). */
export async function realtimeTopicsFor(actor: Actor): Promise<string[]> {
  const topics = [userTopic(actor.userId)];
  if (!can(actor, PERMISSIONS.inbox.view)) return topics;
  const scoped = channelFilter(actor);
  const channelIds = scoped ?? (await db.select({ id: channels.id }).from(channels)).map((row) => row.id);
  return [...topics, ...channelIds.map(channelTopic)];
}

/** Events after `cursor` that `actor` may see, and the next cursor. A missing cursor starts from now. */
export async function pollRealtimeFor(
  actor: Actor,
  cursor: string | null,
  options: { realtime?: Realtime; limit?: number } = {},
): Promise<{ cursor: string; events: DeliveredRealtimeEvent[] }> {
  const topics = await realtimeTopicsFor(actor);
  const result = await (options.realtime ?? getRealtime()).poll(cursor, topics, options.limit);
  const events: DeliveredRealtimeEvent[] = [];
  for (const event of result.events) {
    const parsed = eventSchema.safeParse(event.payload);
    if (parsed.success) events.push({ ...parsed.data, cursor: event.cursor });
  }
  return { cursor: result.cursor, events };
}
