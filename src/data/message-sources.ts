// «¿Por qué respondió esto?» ([BAN-07], [CON-20]): the knowledge fragments each AI answer of a conversation used,
// numbered by rank. The knowledge phase fills message_retrievals; the inbox only reads them, with the same access as
// the conversation ([PER-02], [PER-03]).
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { messageRetrievals, messages } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { parseInput } from "@/server/errors";
import { loadConversationFor } from "./conversation-scope";

/** Messages asked at once: one page of the conversation. */
const MAX_MESSAGES = 200;

export type MessageSource = {
  rank: number;
  score: number | null;
  title: string | null;
  section: string | null;
  page: number | null;
  kbId: string | null;
  documentId: string | null;
};

/** Sources by message id; messages without sources are left out. */
export type MessageSourcesByMessage = Record<string, MessageSource[]>;

export const listMessageSourcesSchema = z.object({ conversationId: idSchema, messageIds: z.array(idSchema).max(MAX_MESSAGES) }).strict();

export async function listMessageSources(actor: Actor, input: unknown): Promise<MessageSourcesByMessage> {
  const data = parseInput(listMessageSourcesSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, data.conversationId);
  if (data.messageIds.length === 0) return {};
  const rows = await db
    .select({
      messageId: messageRetrievals.messageId,
      rank: messageRetrievals.rank,
      score: messageRetrievals.score,
      title: messageRetrievals.title,
      section: messageRetrievals.section,
      page: messageRetrievals.page,
      kbId: messageRetrievals.kbId,
      documentId: messageRetrievals.documentId,
    })
    .from(messageRetrievals)
    .innerJoin(messages, eq(messages.id, messageRetrievals.messageId))
    .where(and(eq(messages.conversationId, conversation.id), inArray(messageRetrievals.messageId, data.messageIds)))
    .orderBy(asc(messageRetrievals.messageId), asc(messageRetrievals.rank));
  const byMessage: MessageSourcesByMessage = {};
  for (const { messageId, ...source } of rows) (byMessage[messageId] ??= []).push(source);
  return byMessage;
}
