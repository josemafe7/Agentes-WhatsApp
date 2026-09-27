// «Borrar sus datos» ([CTO-07], [CUM-07]): the contact and everything about them goes — identities, consents,
// conversations with their messages and transcripts, internal notes, hand-offs, the sources of the AI's answers, the
// team notifications and raw channel webhooks that name them, reminder emails in the system mail log, and their
// files — while their bookings stay, anonymised, so the reports still add up. The AI usage rows stay too (they are
// what the AI cost, [INF-07]), unlinked. Children are deleted explicitly before their parents, in one transaction
// with the activity log entry (foreign keys are enforced and cascades never relied on, docs/architecture.md). Files go
// after it commits: one that cannot be deleted stays as an orphan that nothing points to or serves.
// System function: src/data/contacts-erase.ts checks the permission and the typed confirmation.
import "server-only";
import { and, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { writeAudit, type AuditEntry } from "@/data/audit";
import { deleteFileQuietly } from "@/data/knowledge";
import { db, type Transaction } from "@/db";
import {
  aiRuns,
  bookingEvents,
  bookings,
  consents,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  internalNotes,
  messageRetrievals,
  messages,
  notifications,
  systemEmails,
  webhookEvents,
} from "@/db/schema";
import { getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { replyDedupeKey } from "@/server/engine/schedule";
import { summaryDedupeKey } from "@/server/engine/summary";
import { publishConversationEvent } from "@/server/realtime/events";

/** What was erased, in numbers only: this goes to the activity log, which never holds personal data ([SEG-10]). */
export type ContactErasure = { conversations: number; messages: number; files: number; bookingsAnonymized: number };

/** Ids per statement when a contact has many messages. */
const IDS_PER_STATEMENT = 500;
/** Channels whose raw webhooks carry the customer's identifiers (the web chat and email store none). */
const WEBHOOK_CHANNEL_TYPES = new Set(["whatsapp", "telegram"]);

function chunked<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += IDS_PER_STATEMENT) chunks.push(items.slice(start, start + IDS_PER_STATEMENT));
  return chunks;
}

/** A file still used by a message that stays (the demo and the simulator may share one) is kept. */
async function stillUsed(fileKey: string): Promise<boolean> {
  // LIKE only narrows the candidates; the key must then be exactly a message's own.
  const rows = await db
    .select({ media: messages.media })
    .from(messages)
    .where(like(messages.media, `%${JSON.stringify(fileKey)}%`))
    .limit(20);
  return rows.some((row) => row.media?.fileKey === fileKey);
}

async function eraseRows(
  tx: Transaction,
  contactId: string,
  found: { conversationIds: string[]; messageIds: string[]; bookingIds: string[]; webhookIds: string[]; emails: string[] },
  now: Date,
): Promise<number> {
  const { conversationIds, messageIds, bookingIds, webhookIds, emails } = found;
  for (const ids of chunked(messageIds)) {
    await tx.delete(messageRetrievals).where(inArray(messageRetrievals.messageId, ids));
    await tx.update(aiRuns).set({ messageId: null }).where(inArray(aiRuns.messageId, ids));
  }
  if (conversationIds.length > 0) {
    await tx.update(aiRuns).set({ conversationId: null }).where(inArray(aiRuns.conversationId, conversationIds));
    await tx.delete(handoffEvents).where(inArray(handoffEvents.conversationId, conversationIds));
    await tx.delete(internalNotes).where(inArray(internalNotes.conversationId, conversationIds));
    await tx.update(bookings).set({ conversationId: null, updatedAt: now }).where(inArray(bookings.conversationId, conversationIds));
    for (const ids of chunked(messageIds)) await tx.delete(messages).where(inArray(messages.id, ids));
    await tx.delete(conversations).where(inArray(conversations.id, conversationIds));
  }
  // Notices to the team name the customer («Traspaso: Ana», «Cita pendiente de confirmar: Ana»).
  const links = [...conversationIds.map((id) => `/bandeja/${id}`), ...bookingIds.map((id) => `/agenda?cita=${id}`)];
  for (const chunk of chunked(links)) await tx.delete(notifications).where(inArray(notifications.link, chunk));
  // Bookings stay for the reports, without anything that says who the customer was.
  const anonymized = await tx
    .update(bookings)
    .set({ contactId: null, contactName: null, notes: null, cancelReason: null, conversationId: null, updatedAt: now })
    .where(eq(bookings.contactId, contactId))
    .returning({ id: bookings.id });
  if (bookingIds.length > 0) {
    await tx.update(bookingEvents).set({ actorName: null }).where(and(inArray(bookingEvents.bookingId, bookingIds), eq(bookingEvents.actorType, "contact")));
  }
  if (webhookIds.length > 0) await tx.delete(webhookEvents).where(inArray(webhookEvents.id, webhookIds));
  if (emails.length > 0) await tx.delete(systemEmails).where(and(eq(systemEmails.kind, "reminder"), inArray(systemEmails.toEmail, emails)));
  await tx.delete(consents).where(eq(consents.contactId, contactId));
  await tx.delete(contactIdentities).where(eq(contactIdentities.contactId, contactId));
  await tx.delete(contacts).where(eq(contacts.id, contactId));
  return anonymized.length;
}

/** The raw webhooks that name one of the contact's WhatsApp or Telegram identifiers (their quoted value). */
async function webhooksNaming(identifiers: string[]): Promise<string[]> {
  if (identifiers.length === 0) return [];
  const conditions: SQL[] = identifiers.map((value) => like(webhookEvents.payload, `%${JSON.stringify(value)}%`));
  const rows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(or(...conditions));
  return rows.map((row) => row.id);
}

/**
 * Erases a contact (see the file comment). `audit` is the activity log entry, written in the same transaction with the
 * numbers of what went. Returns those numbers, or null when the contact does not exist.
 */
export async function eraseContactData(
  contactId: string,
  options: { audit: Omit<AuditEntry, "metadata">; storage?: FileStorage; queue?: JobQueue; now?: Date },
): Promise<ContactErasure | null> {
  const [contact] = await db.select({ id: contacts.id, email: contacts.email }).from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return null;
  const now = options.now ?? new Date();
  const [conversationRows, identityRows, bookingRows] = await Promise.all([
    db.select({ id: conversations.id, channelId: conversations.channelId }).from(conversations).where(eq(conversations.contactId, contact.id)),
    db.select({ channelType: contactIdentities.channelType, externalId: contactIdentities.externalId, phone: contactIdentities.phone }).from(contactIdentities).where(eq(contactIdentities.contactId, contact.id)),
    db.select({ id: bookings.id }).from(bookings).where(eq(bookings.contactId, contact.id)),
  ]);
  const conversationIds = conversationRows.map((row) => row.id);
  const messageRows = conversationIds.length > 0 ? await db.select({ id: messages.id, media: messages.media }).from(messages).where(inArray(messages.conversationId, conversationIds)) : [];
  const identifiers = identityRows.filter((row) => WEBHOOK_CHANNEL_TYPES.has(row.channelType)).flatMap((row) => [row.externalId, ...(row.phone ? [row.phone] : [])]);
  const emails = [...new Set([contact.email, ...identityRows.filter((row) => row.channelType.startsWith("email_")).map((row) => row.externalId)].filter((email): email is string => Boolean(email)))];
  const found = {
    conversationIds,
    messageIds: messageRows.map((row) => row.id),
    bookingIds: bookingRows.map((row) => row.id),
    webhookIds: await webhooksNaming([...new Set(identifiers)]),
    emails,
  };
  const fileKeys = [...new Set(messageRows.map((row) => row.media?.fileKey).filter((key): key is string => Boolean(key)))];

  const bookingsAnonymized = await db.transaction(async (tx) => {
    const anonymized = await eraseRows(tx, contact.id, found, now);
    const summary: ContactErasure = { conversations: conversationIds.length, messages: found.messageIds.length, files: fileKeys.length, bookingsAnonymized: anonymized };
    await writeAudit({ ...options.audit, metadata: summary }, tx);
    for (const row of conversationRows) {
      if (row.channelId) await publishConversationEvent({ type: "conversation.updated", conversationId: row.id, channelId: row.channelId, change: "status" }, { executor: tx });
    }
    return anonymized;
  });

  // After the commit: nothing pending may answer or summarise a conversation that is gone.
  const queue = options.queue ?? getJobQueue();
  for (const id of conversationIds) {
    await queue.cancel({ dedupeKey: replyDedupeKey(id) });
    await queue.cancel({ dedupeKey: summaryDedupeKey(id) });
  }
  const storage = options.storage ?? getFileStorage();
  for (const key of fileKeys) {
    if (!(await stillUsed(key))) await deleteFileQuietly(storage, key);
  }
  return { conversations: conversationIds.length, messages: found.messageIds.length, files: fileKeys.length, bookingsAnonymized };
}
