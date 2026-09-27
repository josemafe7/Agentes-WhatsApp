// «Convertir en FAQ» ([CON-22], [BAN-*]): from a person's reply in the inbox, a draft FAQ (the customer's question
// before it and the person's answer) that can be edited before it is saved in the chosen base. Same access as the
// conversation ([PER-02]) plus the right to convert ([inbox.convert_faq]) and to edit the knowledge.
import "server-only";
import { and, asc, desc, eq, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { parseInput, ValidationError } from "@/server/errors";
import { loadConversationFor } from "./conversation-scope";
import { assertCan } from "./guard";
import { addKnowledgeFaq, knowledgeFaqInputSchema } from "./knowledge-documents";

/** Customer messages before the reply that make up the question. */
const MAX_QUESTION_MESSAGES = 3;
const MAX_QUESTION_CHARS = 500;
const MAX_ANSWER_CHARS = 10_000;

export type FaqDraft = { conversationId: string; messageId: string; question: string; answer: string };

const messageRefSchema = z.object({ conversationId: idSchema, messageId: idSchema }).strict();

async function loadHumanReply(actor: Actor, input: unknown) {
  const data = parseInput(messageRefSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.convertFaq, data.conversationId);
  const [reply] = await db
    .select({ id: messages.id, text: messages.text, createdAt: messages.createdAt, senderType: messages.senderType, direction: messages.direction })
    .from(messages)
    .where(and(eq(messages.id, data.messageId), eq(messages.conversationId, conversation.id)));
  if (!reply || reply.senderType !== "human" || reply.direction !== "outbound" || !reply.text?.trim()) {
    throw new ValidationError("Solo se puede convertir en FAQ una respuesta escrita por una persona.");
  }
  return { conversation, reply };
}

/** The editable draft: the customer's last messages before the reply as the question, the reply as the answer. */
export async function getFaqDraftFromMessage(actor: Actor, input: unknown): Promise<FaqDraft> {
  const { conversation, reply } = await loadHumanReply(actor, input);
  const before = await db
    .select({ senderType: messages.senderType, text: messages.text, transcript: messages.transcript })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), lt(messages.createdAt, reply.createdAt), ne(messages.senderType, "system")))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(10);
  const question: string[] = [];
  for (const message of before) {
    if (message.senderType !== "contact") {
      if (question.length > 0) break;
      continue;
    }
    const words = [message.text, message.transcript].filter((part): part is string => Boolean(part?.trim())).join(" ").trim();
    if (words) question.unshift(words);
    if (question.length === MAX_QUESTION_MESSAGES) break;
  }
  return {
    conversationId: conversation.id,
    messageId: reply.id,
    question: question.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS),
    answer: (reply.text ?? "").trim().slice(0, MAX_ANSWER_CHARS),
  };
}

/** The reply, the base and the (edited) question and answer, with the same rules as a FAQ written in the base. */
export const faqFromMessageSchema = z
  .object({ conversationId: idSchema, messageId: idSchema, kbId: idSchema, ...knowledgeFaqInputSchema.shape })
  .strict();

/** Saves the (edited) draft as a FAQ of `kbId`. */
export async function createFaqFromMessage(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const data = parseInput(faqFromMessageSchema, input);
  await loadHumanReply(actor, { conversationId: data.conversationId, messageId: data.messageId });
  return addKnowledgeFaq(actor, data.kbId, { question: data.question, answer: data.answer });
}

/** Ids of the messages of a conversation that can be converted (for the inbox to show the action). */
export async function convertibleMessageIds(actor: Actor, conversationId: unknown): Promise<string[]> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.convertFaq, conversationId);
  const rows = await db
    .select({ id: messages.id, text: messages.text })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.senderType, "human"), eq(messages.direction, "outbound")))
    .orderBy(asc(messages.createdAt));
  return rows.filter((row) => row.text?.trim()).map((row) => row.id);
}
