// One conversation per email thread ([CAN-12]). Gmail gives its threadId and Outlook its conversationId; IMAP has
// neither, so the thread is the root Message-ID of References (RFC 5322 keeps the first one when trimming), then
// In-Reply-To, then the message's own id. Our replies keep the root in References, so the customer's next reply lands
// in the same conversation; an existing conversation found by any id of the chain wins.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import type { ParsedEmail } from "./parse";

const MAX_THREAD_ID = 300;

/** Thread candidates of an IMAP message, most likely first. */
export function imapThreadCandidates(email: Pick<ParsedEmail, "messageId" | "inReplyTo" | "references">): string[] {
  const ids = [email.references[0], email.inReplyTo, ...[...email.references.slice(1)].reverse(), email.messageId];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_THREAD_ID))];
}

/** A stable id when the message has no Message-ID at all. */
export function fallbackThreadId(providerId: string): string {
  return `sin-id:${providerId}`.slice(0, MAX_THREAD_ID);
}

/** The IMAP thread id: the thread of an existing conversation of the channel, or the root of the chain. */
export async function resolveImapThreadId(channelId: string, email: Pick<ParsedEmail, "messageId" | "inReplyTo" | "references">, providerId: string): Promise<string> {
  const candidates = imapThreadCandidates(email);
  if (candidates.length === 0) return fallbackThreadId(providerId);
  const rows = await db
    .select({ threadId: conversations.externalThreadId })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), inArray(conversations.externalThreadId, candidates)));
  const existing = new Set(rows.map((row) => row.threadId));
  return candidates.find((id) => existing.has(id)) ?? candidates[0];
}
