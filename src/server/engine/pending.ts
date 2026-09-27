// Which customer messages still wait for a reply: those after the last message the business sent (by the AI or a
// person; drafts and failed sends do not count, the customer never got them). Only the customer's own words count: a
// channel's notice or a type it cannot show (sender «system», [WA-36], [WA-50]) is never a turn. System reads.
import "server-only";
import { and, asc, desc, eq, gt, inArray, max, notInArray } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { messages } from "@/db/schema";

const NOT_DELIVERED = ["draft", "failed"] as const;

/** Time of the last reply that reached (or is reaching) the customer, or null. */
export async function lastReplyAt(conversationId: string, executor: Executor = db): Promise<Date | null> {
  const [row] = await executor
    .select({ at: max(messages.createdAt) })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound"),
        inArray(messages.senderType, ["ai", "human"]),
        notInArray(messages.status, [...NOT_DELIVERED]),
      ),
    );
  return row?.at ?? null;
}

/** What the customer wrote in the conversation (never the channel's notices). */
const customerMessages = (conversationId: string) =>
  and(eq(messages.conversationId, conversationId), eq(messages.direction, "inbound"), eq(messages.senderType, "contact"));

export type PendingInbound = { id: string; createdAt: Date; simulated: boolean; externalId: string | null };

/** Customer messages after the last reply, oldest first. */
export async function pendingInbound(conversationId: string, executor: Executor = db): Promise<PendingInbound[]> {
  const since = await lastReplyAt(conversationId, executor);
  return executor
    .select({ id: messages.id, createdAt: messages.createdAt, simulated: messages.simulated, externalId: messages.externalId })
    .from(messages)
    .where(and(customerMessages(conversationId), ...(since ? [gt(messages.createdAt, since)] : [])))
    .orderBy(asc(messages.createdAt), asc(messages.id));
}

/** The newest customer message of the conversation, or null. */
export async function newestInbound(conversationId: string, executor: Executor = db): Promise<PendingInbound | null> {
  const [row] = await executor
    .select({ id: messages.id, createdAt: messages.createdAt, simulated: messages.simulated, externalId: messages.externalId })
    .from(messages)
    .where(customerMessages(conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  return row ?? null;
}
