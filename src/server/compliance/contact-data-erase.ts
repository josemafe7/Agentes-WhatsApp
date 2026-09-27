// «Borrar sus datos» ([CTO-07], [CUM-07]): the contact and everything about them goes — identities, consents,
// conversations with their messages and transcripts, internal notes, hand-offs, the sources of the AI's answers, the
// team notifications and raw channel webhooks that name them, reminder emails in the system mail log, and their
// files — while their bookings stay, anonymised, so the reports still add up. The AI usage rows stay too (they are
// what the AI cost, [INF-07]), unlinked. What names them elsewhere is cleared as well: the subject of the team's notice
// emails in the system mail log (and the .eml copies kept in data/outbox in development and the demo), and the payload
// of every background job about them — a pending one is cancelled, a finished one keeps only that it was erased.
// Children are deleted explicitly before their parents, in one transaction with the activity log entry (foreign keys
// are enforced and cascades never relied on, docs/architecture.md). Files go after it commits: one that cannot be
// deleted stays as an orphan that nothing points to or serves.
// System function: src/data/contacts-erase.ts checks the permission and the typed confirmation.
import "server-only";
import fs from "node:fs";
import path from "node:path";
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
  jobs,
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
import { OUTBOX_DIR } from "@/server/mailer";
import { publishConversationEvent } from "@/server/realtime/events";

/** What was erased, in numbers only: this goes to the activity log, which never holds personal data ([SEG-10]). */
export type ContactErasure = { conversations: number; messages: number; files: number; bookingsAnonymized: number };

/** Ids per statement when a contact has many messages. */
const IDS_PER_STATEMENT = 500;
/** LIKE conditions per query when looking for the jobs that name them. */
const TERMS_PER_QUERY = 50;
/** Channels whose raw webhooks carry the customer's identifiers (the web chat and email store none). */
const WEBHOOK_CHANNEL_TYPES = new Set(["whatsapp", "telegram"]);
/** What a job about an erased contact keeps of its payload. */
const ERASED_PAYLOAD = { erased: true };
/** The subject a notice email about an erased contact keeps in the log. */
export const ERASED_NOTICE_SUBJECT = "Aviso sobre un contacto borrado";
/**
 * Jobs only about team accounts (src/server/jobs/handlers/system-email.ts, the password resets): never about a customer,
 * and cancelling one could leave a person of the team without their link.
 */
const TEAM_ONLY_JOB_TYPES = new Set(["system_email.send"]);
/** Names of the files data/outbox holds (src/server/mailer.ts): nothing else is ever deleted there. */
const OUTBOX_FILE = /^[A-Za-z0-9._-]{1,200}\.eml$/;

function chunked<T>(items: readonly T[], size = IDS_PER_STATEMENT): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
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

type Found = {
  conversationIds: string[];
  messageIds: string[];
  bookingIds: string[];
  webhookIds: string[];
  emails: string[];
  /** Jobs whose payload names them, by status. */
  jobIds: { pending: string[]; other: string[] };
  /** Notice emails about them in the system mail log (their subject is redacted). */
  noticeEmailIds: string[];
};

async function eraseRows(tx: Transaction, contactId: string, found: Found, now: Date): Promise<number> {
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
  for (const chunk of chunked(noticeLinks(found))) await tx.delete(notifications).where(inArray(notifications.link, chunk));
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
  for (const ids of chunked(found.noticeEmailIds)) {
    await tx.update(systemEmails).set({ subject: ERASED_NOTICE_SUBJECT, outboxFile: null, updatedAt: now }).where(inArray(systemEmails.id, ids));
  }
  // Jobs about them: a pending one never runs (its notice would name them), and none keeps what it said.
  for (const ids of chunked(found.jobIds.pending)) {
    await tx
      .update(jobs)
      .set({ status: "cancelled", payload: ERASED_PAYLOAD, finishedAt: now, lockedUntil: null, lockedBy: null, updatedAt: now })
      .where(and(inArray(jobs.id, ids), eq(jobs.status, "pending")));
  }
  for (const ids of chunked([...found.jobIds.pending, ...found.jobIds.other])) await tx.update(jobs).set({ payload: ERASED_PAYLOAD, updatedAt: now }).where(inArray(jobs.id, ids));
  await tx.delete(consents).where(eq(consents.contactId, contactId));
  await tx.delete(contactIdentities).where(eq(contactIdentities.contactId, contactId));
  await tx.delete(contacts).where(eq(contacts.id, contactId));
  return anonymized.length;
}

/** The in-app links of the notices about their conversations and bookings. */
function noticeLinks(found: Pick<Found, "conversationIds" | "bookingIds">): string[] {
  return [...found.conversationIds.map((id) => `/bandeja/${id}`), ...found.bookingIds.map((id) => `/agenda?cita=${id}`)];
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
 * The jobs whose payload names them: their ids (conversations, bookings, messages, the contact) anywhere in it, or one
 * of their identifiers as a whole value. LIKE only narrows the candidates; each payload is then checked as text.
 */
async function jobsNaming(ids: readonly string[], values: readonly string[]): Promise<{ id: string; status: string; type: string; payload: unknown }[]> {
  const terms = [...ids.map((id) => ({ pattern: `%${id}%`, needle: id })), ...values.map((value) => ({ pattern: `%${JSON.stringify(value)}%`, needle: JSON.stringify(value) }))];
  const found = new Map<string, { id: string; status: string; type: string; payload: unknown }>();
  for (const chunk of chunked(terms, TERMS_PER_QUERY)) {
    const rows = await db
      .select({ id: jobs.id, status: jobs.status, type: jobs.type, payload: jobs.payload })
      .from(jobs)
      .where(or(...chunk.map((term) => like(jobs.payload, term.pattern))));
    for (const row of rows) {
      const text = JSON.stringify(row.payload);
      if (!TEAM_ONLY_JOB_TYPES.has(row.type) && chunk.some((term) => text.includes(term.needle))) found.set(row.id, row);
    }
  }
  return [...found.values()];
}

/** The titles of the notices about them: in-app rows and the notice jobs (email and push) that carry one. */
function titleOf(payload: unknown): string | null {
  return payload && typeof payload === "object" && typeof (payload as { title?: unknown }).title === "string" ? (payload as { title: string }).title : null;
}

/** Notice emails whose subject is one of those titles («Traspaso: Ana · Negocio»), with their outbox copy. */
async function noticeEmailsTitled(titles: ReadonlySet<string>): Promise<{ id: string; outboxFile: string | null }[]> {
  if (titles.size === 0) return [];
  const rows = await db.select({ id: systemEmails.id, subject: systemEmails.subject, outboxFile: systemEmails.outboxFile }).from(systemEmails).where(eq(systemEmails.kind, "notification"));
  return rows.filter((row) => [...titles].some((title) => row.subject === title || row.subject.startsWith(`${title} · `)));
}

/** Deletes a copy saved in data/outbox; a name that is not one of the mailer's own is never touched. */
async function deleteOutboxCopy(outboxDir: string, file: string | null): Promise<void> {
  if (!file || !OUTBOX_FILE.test(file)) return;
  await fs.promises.rm(path.join(outboxDir, file), { force: true }).catch(() => undefined);
}

/**
 * Erases a contact (see the file comment). `audit` is the activity log entry, written in the same transaction with the
 * numbers of what went. Returns those numbers, or null when the contact does not exist.
 */
export async function eraseContactData(
  contactId: string,
  options: { audit: Omit<AuditEntry, "metadata">; storage?: FileStorage; queue?: JobQueue; now?: Date; outboxDir?: string },
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
  const messageRows =
    conversationIds.length > 0
      ? await db.select({ id: messages.id, media: messages.media, externalId: messages.externalId }).from(messages).where(inArray(messages.conversationId, conversationIds))
      : [];
  const identifiers = identityRows.filter((row) => WEBHOOK_CHANNEL_TYPES.has(row.channelType)).flatMap((row) => [row.externalId, ...(row.phone ? [row.phone] : [])]);
  const emails = [...new Set([contact.email, ...identityRows.filter((row) => row.channelType.startsWith("email_")).map((row) => row.externalId)].filter((email): email is string => Boolean(email)))];
  const bookingIds = bookingRows.map((row) => row.id);
  const messageIds = messageRows.map((row) => row.id);

  // What names them outside their conversations: notices (and the jobs that email or push them), job payloads.
  const namedJobs = await jobsNaming(
    [contact.id, ...conversationIds, ...bookingIds, ...messageIds],
    [...new Set([...identityRows.flatMap((row) => [row.externalId, ...(row.phone ? [row.phone] : [])]), ...emails, ...messageRows.flatMap((row) => (row.externalId ? [row.externalId] : []))])],
  );
  const links = noticeLinks({ conversationIds, bookingIds });
  const noticeRows: { title: string }[] = [];
  for (const chunk of chunked(links)) noticeRows.push(...(await db.select({ title: notifications.title }).from(notifications).where(inArray(notifications.link, chunk))));
  const titles = new Set([...noticeRows.map((row) => row.title), ...namedJobs.map((job) => titleOf(job.payload)).filter((title): title is string => title !== null)]);
  const noticeEmails = await noticeEmailsTitled(titles);
  const reminderEmails =
    emails.length > 0 ? await db.select({ outboxFile: systemEmails.outboxFile }).from(systemEmails).where(and(eq(systemEmails.kind, "reminder"), inArray(systemEmails.toEmail, emails))) : [];

  const found: Found = {
    conversationIds,
    messageIds,
    bookingIds,
    webhookIds: await webhooksNaming([...new Set(identifiers)]),
    emails,
    jobIds: { pending: namedJobs.filter((job) => job.status === "pending").map((job) => job.id), other: namedJobs.filter((job) => job.status !== "pending").map((job) => job.id) },
    noticeEmailIds: noticeEmails.map((row) => row.id),
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
  // The copies of their notice and reminder emails kept in data/outbox (development and the demo).
  const outboxDir = options.outboxDir ?? OUTBOX_DIR;
  for (const row of [...noticeEmails, ...reminderEmails]) await deleteOutboxCopy(outboxDir, row.outboxFile);
  return { conversations: conversationIds.length, messages: found.messageIds.length, files: fileKeys.length, bookingsAnonymized };
}
