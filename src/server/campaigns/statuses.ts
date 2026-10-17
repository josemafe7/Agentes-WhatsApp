// What WhatsApp says of an envío's message, in its results ([ENV-11]): «Entregado» and «Leído» move the contact forward,
// never back; a «failed» tries the next channel marked, through the queue ([ENV-03]). System code.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { campaignRecipients, messages } from "@/db/schema";
import type { StatusUpdateEvent } from "@/server/channels/types";
import { campaignRecipientOf, enqueueCampaignFallback } from "./fallback";
import { RECIPIENT_CODES } from "./rules";

const EARLIER: Record<"delivered" | "read", ("sent" | "delivered")[]> = { delivered: ["sent"], read: ["sent", "delivered"] };

/** «Entregado» or «Leído» of an envío's message, if it is one. */
export async function applyCampaignDelivery(messageId: string, status: StatusUpdateEvent["status"], now: Date): Promise<void> {
  if (status !== "delivered" && status !== "read") return;
  const [message] = await db.select({ metadata: messages.metadata }).from(messages).where(eq(messages.id, messageId));
  const recipientId = message ? campaignRecipientOf(message.metadata) : null;
  if (!recipientId) return;
  await db
    .update(campaignRecipients)
    .set({ status, updatedAt: now })
    .where(and(eq(campaignRecipients.id, recipientId), eq(campaignRecipients.messageId, messageId), inArray(campaignRecipients.status, EARLIER[status])));
}

/** A «failed» of an envío's message: its next channel, by the queue. A failure of the recipient does not stop the envío. */
export async function applyCampaignFailure(metadata: Record<string, unknown>, messageId: string, input: { code: number | null; reason: string | null }): Promise<void> {
  const recipientId = campaignRecipientOf(metadata);
  if (!recipientId) return;
  await enqueueCampaignFallback({ recipientId, messageId, reason: input.reason?.slice(0, 500) ?? null, channelFault: input.code === null || !RECIPIENT_CODES.has(input.code), code: input.code });
}

/** What Meta priced an envío's message, kept on its row so the envío's cost never changes ([ENV-12], [CTO-07]). */
export async function recordCampaignCost(messageId: string, cost: number): Promise<void> {
  await db.update(campaignRecipients).set({ costEstimate: cost }).where(eq(campaignRecipients.messageId, messageId));
}
