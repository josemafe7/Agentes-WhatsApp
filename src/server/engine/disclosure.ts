// The AI notice ([CUM-01]): the first AI message of each conversation carries it in front, with the channel's own
// text or the business default (Ajustes › Privacidad y legal), so it never depends on the model remembering it.
import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { DEFAULT_AI_DISCLOSURE_TEXT } from "@/data/legal-texts";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { messages } from "@/db/schema";

/** The notice that applies to a channel: its own, the business's, or the default text. */
export async function aiDisclosureText(channelDisclosure: string | null): Promise<string> {
  return channelDisclosure?.trim() || (await loadBusinessSettings()).aiDisclosureText?.trim() || DEFAULT_AI_DISCLOSURE_TEXT;
}

/**
 * `text` with the notice in front while no AI message has reached the customer yet. A draft waiting for review does
 * not count: any of them may be the one approved first, or be thrown away.
 */
export async function withAiDisclosure(conversationId: string, channelDisclosure: string | null, text: string): Promise<string> {
  const [earlier] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.senderType, "ai"), notInArray(messages.status, ["failed", "draft"])))
    .limit(1);
  if (earlier) return text;
  const notice = await aiDisclosureText(channelDisclosure);
  return text.includes(notice) ? text : `${notice}\n\n${text}`;
}
