// Delivery statuses of outbound messages ([WA-38]): they only move forward (queued < sent < delivered < read <
// played), arrive in any order, and «failed» only replaces «queued» or «sent». The first `pricing` is kept ([WA-47]).
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { messages } from "@/db/schema";
import type { MessageStatus } from "@/lib/enums";
import type { ChannelDeliveryStatus, ChannelRecord, StatusUpdateEvent } from "@/server/channels/types";
import { publishConversationEvent } from "@/server/realtime/events";

const FORWARD_RANK: Partial<Record<MessageStatus, number>> = { queued: 0, sent: 1, delivered: 2, read: 3, played: 4 };

/** The status after `incoming`, or null when it changes nothing (older, repeated, or after a failure). Pure. */
export function nextMessageStatus(current: MessageStatus, incoming: ChannelDeliveryStatus): MessageStatus | null {
  const currentRank = FORWARD_RANK[current];
  if (currentRank === undefined) return null;
  if (incoming === "failed") return current === "queued" || current === "sent" ? "failed" : null;
  const incomingRank = FORWARD_RANK[incoming] ?? -1;
  return incomingRank > currentRank ? incoming : null;
}

export type AppliedStatus = { messageId: string; conversationId: string; status: MessageStatus; changed: boolean };

/** System: applies a status update to our message with that channel id; null when there is no such message. */
export async function applyStatusUpdate(
  channel: Pick<ChannelRecord, "id" | "type">,
  event: StatusUpdateEvent,
  executor: Executor = db,
): Promise<AppliedStatus | null> {
  const [message] = await executor
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      status: messages.status,
      pricingType: messages.pricingType,
      pricingCategory: messages.pricingCategory,
    })
    .from(messages)
    .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, event.externalId)));
  if (!message) return null;

  const next = nextMessageStatus(message.status, event.status);
  const firstPricing = event.pricing && message.pricingType === null && message.pricingCategory === null ? event.pricing : null;
  if (!next && !firstPricing) return { messageId: message.id, conversationId: message.conversationId, status: message.status, changed: false };

  await executor
    .update(messages)
    .set({
      ...(next ? { status: next, statusUpdatedAt: event.at } : {}),
      ...(next === "failed" ? { error: event.error ?? { message: "El canal no ha podido entregar el mensaje." } } : {}),
      ...(firstPricing ? { pricingType: firstPricing.type, pricingCategory: firstPricing.category } : {}),
      updatedAt: new Date(),
    })
    .where(eq(messages.id, message.id));
  if (next) {
    await publishConversationEvent(
      { type: "message.status", conversationId: message.conversationId, channelId: channel.id, messageId: message.id, status: next },
      { channelType: channel.type, executor },
    );
  }
  return { messageId: message.id, conversationId: message.conversationId, status: next ?? message.status, changed: next !== null };
}
