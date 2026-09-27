// «¿Por qué respondió esto?» of one AI answer ([BAN-07], [CON-20]): the knowledge fragments it used, numbered by
// rank with their score, title, section, page and base, and the tools the AI called in that turn (from the chat
// runs linked to the message). Same access as the conversation ([PER-02], [PER-03]); read when the panel opens.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiRuns, knowledgeBases, messageRetrievals, messages } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { NotFoundError, parseInput } from "@/server/errors";
import { loadConversationFor } from "./conversation-scope";

export type MessageReasonFragment = {
  rank: number;
  score: number | null;
  title: string | null;
  section: string | null;
  page: number | null;
  /** Null once the base is deleted: the copied title, section and page stay. */
  kbId: string | null;
  kbName: string | null;
  documentId: string | null;
};

export type MessageReasonTool = { name: string; ok: boolean };

export type MessageReason = { messageId: string; fragments: MessageReasonFragment[]; tools: MessageReasonTool[] };

export const messageReasonSchema = z.object({ conversationId: idSchema, messageId: idSchema }).strict();

export async function getMessageReason(actor: Actor, input: unknown): Promise<MessageReason> {
  const data = parseInput(messageReasonSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, data.conversationId);
  const [message] = await db
    .select({ id: messages.id, senderType: messages.senderType })
    .from(messages)
    .where(and(eq(messages.id, data.messageId), eq(messages.conversationId, conversation.id)));
  if (!message || message.senderType !== "ai") throw new NotFoundError("No se ha encontrado la respuesta de la IA.");

  const [fragments, runs] = await Promise.all([
    db
      .select({
        rank: messageRetrievals.rank,
        score: messageRetrievals.score,
        title: messageRetrievals.title,
        section: messageRetrievals.section,
        page: messageRetrievals.page,
        kbId: messageRetrievals.kbId,
        kbName: knowledgeBases.name,
        documentId: messageRetrievals.documentId,
      })
      .from(messageRetrievals)
      .leftJoin(knowledgeBases, eq(knowledgeBases.id, messageRetrievals.kbId))
      .where(eq(messageRetrievals.messageId, message.id))
      .orderBy(asc(messageRetrievals.rank)),
    db
      .select({ toolsUsed: aiRuns.toolsUsed })
      .from(aiRuns)
      .where(and(eq(aiRuns.messageId, message.id), eq(aiRuns.kind, "chat")))
      .orderBy(asc(aiRuns.createdAt), asc(aiRuns.id)),
  ]);
  return {
    messageId: message.id,
    fragments,
    tools: runs.flatMap((run) => run.toolsUsed.map(({ name, ok }) => ({ name, ok }))),
  };
}
