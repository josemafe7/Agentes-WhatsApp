// Conservación ([CUM-05], [CUM-06]): the daily clean-up with the periods of Ajustes › Privacidad y legal. Raw channel
// webhooks go after their days (7–30); the file of a voice note, some days after its transcript (the transcript stays);
// any other file of a message, after the attachments' days; conversations quiet for longer than their months are
// deleted or anonymized as the business chose, and so are the older messages, notes and hand-off details of the ones
// still alive, and the team's notices of that age. It also clears what is only useful for a while (screen events,
// finished jobs, rate-limit counters). Files go from the storage before their rows, and child rows before their
// parents: foreign keys are never trusted to cascade. It works in short batches while its job has time and may stop
// between any two: each batch looks again for what is still expired, so nothing is deleted twice. When a round ends,
// one entry in the activity log says how much went, without anything personal. System code (no actor).
import "server-only";
import { subMonths } from "date-fns";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, notInArray, or, type SQL } from "drizzle-orm";
import { writeAudit } from "@/data/audit";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import {
  aiRuns,
  bookings,
  conversations,
  DEFAULT_RETENTION,
  handoffEvents,
  internalNotes,
  messageRetrievals,
  messages,
  notifications,
  webhookEvents,
  type MessageMedia,
  type RetentionSettings,
} from "@/db/schema";
import { getFileStorage, isValidFileKey, type FileStorage } from "@/server/adapters/file-storage";
import { getJobQueue, type EnqueueResult, type JobQueue } from "@/server/adapters/job-queue";
import { getRateLimiter, type RateLimiter } from "@/server/adapters/rate-limiter";
import { getRealtime, type Realtime } from "@/server/adapters/realtime";
import { deleteKv, getKv, setKv } from "@/server/kv";
import { transcribedAtOf } from "@/server/media/metadata";
import { safeErrorMessage } from "@/server/redact";
import { jsonTextContains } from "@/server/sql-helpers";

export const RETENTION_JOB = "compliance.retention";
const RETENTION_JOB_KEY = "compliance.retention";
export const RETENTION_INTERVAL_MS = 24 * 60 * 60_000;
/** The totals of a round that goes on over several runs of its job. */
const ROUND_KV_KEY = "compliance.retention.round";
/** The last round that finished, with what it did. */
export const LAST_ROUND_KV_KEY = "compliance.retention.last_round";
/** No batch starts with less time than this left: deleting files may go to Supabase Storage. */
export const MIN_BATCH_MS = 10_000;

const DAY_MS = 24 * 60 * 60_000;
const ROW_BATCH = 200;
const MESSAGE_BATCH = 100;
const FILE_BATCH = 25;
const CONVERSATION_BATCH = 20;
/** Messages looked at to know whether a file is still used by another one. */
const SHARED_FILE_LOOKUP = 20;
/** Screen events are useful for a moment; finished jobs and rate-limit counters, for a few days. */
const REALTIME_KEEP_MS = DAY_MS;
const FINISHED_JOBS_KEEP_MS = 7 * DAY_MS;
const RATE_LIMITS_KEEP_MS = 7 * DAY_MS;

/** What a round deleted or anonymized: the activity log keeps it ([CUM-06]). */
export type RetentionCounts = {
  webhookEvents: number;
  audioFiles: number;
  attachmentFiles: number;
  conversationsDeleted: number;
  conversationsAnonymized: number;
  messagesDeleted: number;
  messagesAnonymized: number;
  notesDeleted: number;
  notificationsDeleted: number;
};

const emptyCounts = (): RetentionCounts => ({
  webhookEvents: 0,
  audioFiles: 0,
  attachmentFiles: 0,
  conversationsDeleted: 0,
  conversationsAnonymized: 0,
  messagesDeleted: 0,
  messagesAnonymized: 0,
  notesDeleted: 0,
  notificationsDeleted: 0,
});

export type RetentionDeps = {
  /** Milliseconds its job has left (JobContext.remainingMs). */
  remainingMs: () => number;
  now?: Date;
  storage?: FileStorage;
  realtime?: Realtime;
  rateLimiter?: RateLimiter;
  queue?: JobQueue;
};

export type RetentionOutcome = { finished: boolean; counts: RetentionCounts };

type Cutoffs = { webhooks: Date; audio: Date; attachments: Date; conversations: Date };
/** Where the look for voice notes goes on from, within one run (arrival time, then id). */
type Cursor = { createdAt: Date; id: string };
type Round = { counts: RetentionCounts; cutoffs: Cutoffs; storage: FileStorage; now: Date; voiceNotesAfter?: Cursor };
/** One batch of a step; true when there may be more of it. */
type Step = (round: Round) => Promise<boolean>;

/** The daily job, one for the whole installation (idempotent): the server asks for it when it starts. */
export function ensureRetentionJob(options: { queue?: JobQueue; now?: Date } = {}): Promise<EnqueueResult> {
  return (options.queue ?? getJobQueue()).ensureRecurring({ type: RETENTION_JOB, key: RETENTION_JOB_KEY, intervalMs: RETENTION_INTERVAL_MS, firstRunAt: options.now });
}

function cutoffsOf(retention: RetentionSettings, now: Date): Cutoffs {
  const daysBefore = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    webhooks: daysBefore(retention.webhookDays),
    audio: daysBefore(retention.audioDays),
    attachments: daysBefore(retention.attachmentsDays),
    conversations: subMonths(now, retention.conversationsMonths),
  };
}

/** Runs what fits of today's round; a round that does not fit goes on in the next run, with its totals. */
export async function runRetention(deps: RetentionDeps): Promise<RetentionOutcome> {
  const now = deps.now ?? new Date();
  // Ajustes › Privacidad y legal validates every period; a period missing from an older row takes its default.
  const retention: RetentionSettings = { ...DEFAULT_RETENTION, ...(await loadBusinessSettings()).retention };
  const round: Round = { counts: await roundCounts(), cutoffs: cutoffsOf(retention, now), storage: deps.storage ?? getFileStorage(), now };
  for (const step of stepsFor(retention.mode)) {
    for (let more = true; more; ) {
      if (deps.remainingMs() < MIN_BATCH_MS) {
        await setKv(ROUND_KV_KEY, { counts: round.counts });
        return { finished: false, counts: round.counts };
      }
      more = await step(round);
    }
  }
  await clearShortLivedRows(now, deps);
  await writeAudit({ actor: "system", action: "retention.cleanup", metadata: { ...round.counts } });
  await setKv(LAST_ROUND_KV_KEY, { finishedAt: now.toISOString(), counts: round.counts });
  await deleteKv(ROUND_KV_KEY);
  return { finished: true, counts: round.counts };
}

async function roundCounts(): Promise<RetentionCounts> {
  const stored = await getKv<{ counts?: Partial<Record<keyof RetentionCounts, unknown>> }>(ROUND_KV_KEY);
  const counts = emptyCounts();
  for (const key of Object.keys(counts) as (keyof RetentionCounts)[]) {
    const value = stored?.counts?.[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) counts[key] = value;
  }
  return counts;
}

function stepsFor(mode: RetentionSettings["mode"]): Step[] {
  const conversationSteps = mode === "anonymize" ? [anonymizeOldMessages, anonymizeQuietConversations, anonymizeOldHandoffs] : [deleteQuietConversations, deleteOldMessages, deleteOldHandoffs];
  return [deleteOldWebhooks, dropVoiceNoteFiles, dropAttachmentFiles, ...conversationSteps, deleteOldNotes, deleteOldNotifications];
}

// ─── Raw webhooks and the team's notices ───────────────────────────────────────────────────────────────────

async function deleteOldWebhooks(round: Round): Promise<boolean> {
  const rows = await db.select({ id: webhookEvents.id }).from(webhookEvents).where(lt(webhookEvents.receivedAt, round.cutoffs.webhooks)).limit(ROW_BATCH);
  if (rows.length === 0) return false;
  await db.delete(webhookEvents).where(inArray(webhookEvents.id, rows.map((row) => row.id)));
  round.counts.webhookEvents += rows.length;
  return rows.length === ROW_BATCH;
}

async function deleteOldNotifications(round: Round): Promise<boolean> {
  const rows = await db.select({ id: notifications.id }).from(notifications).where(lt(notifications.createdAt, round.cutoffs.conversations)).limit(ROW_BATCH);
  if (rows.length === 0) return false;
  await db.delete(notifications).where(inArray(notifications.id, rows.map((row) => row.id)));
  round.counts.notificationsDeleted += rows.length;
  return rows.length === ROW_BATCH;
}

async function clearShortLivedRows(now: Date, deps: RetentionDeps): Promise<void> {
  await (deps.realtime ?? getRealtime()).deleteBefore(new Date(now.getTime() - REALTIME_KEEP_MS));
  await (deps.queue ?? getJobQueue()).deleteFinishedBefore(new Date(now.getTime() - FINISHED_JOBS_KEEP_MS));
  await (deps.rateLimiter ?? getRateLimiter()).deleteBefore(new Date(now.getTime() - RATE_LIMITS_KEEP_MS));
}

// ─── Files ───────────────────────────────────────────────────────────────────────────────────────────────

type MediaRow = { id: string; media: MessageMedia | null };

/** Whether a message outside `ids` still points at the file (the demo shares its sample files). */
async function stillUsed(fileKey: string, ids: readonly string[]): Promise<boolean> {
  const rows = await db
    .select({ media: messages.media })
    .from(messages)
    .where(and(jsonTextContains(messages.media, JSON.stringify(fileKey)), notInArray(messages.id, [...ids])))
    .limit(SHARED_FILE_LOOKUP);
  return rows.some((row) => row.media?.fileKey === fileKey);
}

/**
 * Deletes the stored files of these messages, except one another message still uses. Returns the messages whose file
 * could not be deleted: they stay as they are, for the next round.
 */
async function deleteFilesOf(rows: readonly MediaRow[], storage: FileStorage): Promise<Set<string>> {
  const failed = new Set<string>();
  const ids = rows.map((row) => row.id);
  for (const row of rows) {
    const key = row.media?.fileKey;
    // A key the storage could never hold has nothing to delete.
    if (!key || !isValidFileKey(key) || (await stillUsed(key, ids))) continue;
    try {
      await storage.delete(key);
    } catch (error) {
      failed.add(row.id);
      console.warn(`[conservación] No se ha podido borrar un archivo: ${safeErrorMessage(error)}`);
    }
  }
  return failed;
}

/** The files of these messages go; the messages stay without them (their text and transcript are kept). */
async function dropFiles(rows: readonly (MediaRow & { metadata: Record<string, unknown> })[], round: Round): Promise<number> {
  const failed = await deleteFilesOf(rows, round.storage);
  const done = rows.filter((row) => !failed.has(row.id));
  for (const row of done) {
    await db
      .update(messages)
      .set({ media: null, metadata: { ...row.metadata, mediaDeletedAt: round.now.toISOString() } })
      .where(eq(messages.id, row.id));
  }
  return done.length;
}

const mediaRow = { id: messages.id, media: messages.media, metadata: messages.metadata };

/**
 * A voice note's file some days after it was transcribed ([CUM-05]); what the customer said stays as text ([MED-04]).
 * The time is saved with the transcript (src/server/media/prepare.ts); a transcript saved before that counts from the
 * message's arrival. A note is always transcribed after it arrives, so only those that arrived before the cutoff are
 * looked at, page after page: the ones transcribed later wait without holding back the rest.
 */
async function dropVoiceNoteFiles(round: Round): Promise<boolean> {
  const after = round.voiceNotesAfter;
  const rows = await db
    .select({ ...mediaRow, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.contentType, "audio"),
        isNotNull(messages.media),
        isNotNull(messages.transcript),
        ne(messages.transcript, ""),
        lt(messages.createdAt, round.cutoffs.audio),
        after ? or(gt(messages.createdAt, after.createdAt), and(eq(messages.createdAt, after.createdAt), gt(messages.id, after.id))) : undefined,
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(FILE_BATCH);
  const last = rows.at(-1);
  if (!last) return false;
  round.voiceNotesAfter = { createdAt: last.createdAt, id: last.id };
  const due = rows.filter((row) => (transcribedAtOf(row.metadata) ?? row.createdAt).getTime() < round.cutoffs.audio.getTime());
  round.counts.audioFiles += await dropFiles(due, round);
  return rows.length === FILE_BATCH;
}

/** Any other file of a message (sent or received), and a voice note that has no transcript. */
async function dropAttachmentFiles(round: Round): Promise<boolean> {
  const rows = await db
    .select(mediaRow)
    .from(messages)
    .where(
      and(
        isNotNull(messages.media),
        lt(messages.createdAt, round.cutoffs.attachments),
        or(ne(messages.contentType, "audio"), isNull(messages.transcript), eq(messages.transcript, "")),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(FILE_BATCH);
  const done = await dropFiles(rows, round);
  round.counts.attachmentFiles += done;
  return rows.length === FILE_BATCH && done > 0;
}

// ─── Conversations: deleting ─────────────────────────────────────────────────────────────────────────────

/** Quiet since before the cutoff: its last message (or, without messages, its creation) is older. */
const quietSince = (cutoff: Date): SQL => or(lt(conversations.lastMessageAt, cutoff), and(isNull(conversations.lastMessageAt), lt(conversations.createdAt, cutoff))) as SQL;

async function deleteQuietConversations(round: Round): Promise<boolean> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(quietSince(round.cutoffs.conversations))
    .orderBy(asc(conversations.createdAt))
    .limit(CONVERSATION_BATCH);
  if (rows.length === 0) return false;
  const ids = rows.map((row) => row.id);
  const withFiles = await db
    .select({ id: messages.id, conversationId: messages.conversationId, media: messages.media })
    .from(messages)
    .where(and(inArray(messages.conversationId, ids), isNotNull(messages.media)));
  const failed = await deleteFilesOf(withFiles, round.storage);
  const kept = new Set(withFiles.filter((row) => failed.has(row.id)).map((row) => row.conversationId));
  const doomed = ids.filter((id) => !kept.has(id));
  if (doomed.length > 0) {
    const removed = await deleteConversationRows(doomed);
    round.counts.conversationsDeleted += doomed.length;
    round.counts.messagesDeleted += removed.messages;
    round.counts.notesDeleted += removed.notes;
  }
  return rows.length === CONVERSATION_BATCH && doomed.length > 0;
}

/** A conversation and everything under it; the AI's costs and the bookings stay without the link ([INF-07], [AGD-14]). */
async function deleteConversationRows(ids: string[]): Promise<{ messages: number; notes: number }> {
  return db.transaction(async (tx) => {
    const theirMessages = tx.select({ id: messages.id }).from(messages).where(inArray(messages.conversationId, ids));
    await tx.delete(messageRetrievals).where(inArray(messageRetrievals.messageId, theirMessages));
    await tx.update(aiRuns).set({ messageId: null }).where(inArray(aiRuns.messageId, theirMessages));
    await tx.update(aiRuns).set({ conversationId: null }).where(inArray(aiRuns.conversationId, ids));
    await tx.delete(handoffEvents).where(inArray(handoffEvents.conversationId, ids));
    const notes = await tx.delete(internalNotes).where(inArray(internalNotes.conversationId, ids)).returning({ id: internalNotes.id });
    await tx.update(bookings).set({ conversationId: null }).where(inArray(bookings.conversationId, ids));
    const removed = await tx.delete(messages).where(inArray(messages.conversationId, ids)).returning({ id: messages.id });
    await tx.delete(conversations).where(inArray(conversations.id, ids));
    return { messages: removed.length, notes: notes.length };
  });
}

/** In a conversation still alive, what is older than its months goes. */
async function deleteOldMessages(round: Round): Promise<boolean> {
  const rows = await db
    .select({ id: messages.id, conversationId: messages.conversationId, media: messages.media })
    .from(messages)
    .where(lt(messages.createdAt, round.cutoffs.conversations))
    .orderBy(asc(messages.createdAt))
    .limit(MESSAGE_BATCH);
  if (rows.length === 0) return false;
  const failed = await deleteFilesOf(rows, round.storage);
  const done = rows.filter((row) => !failed.has(row.id));
  if (done.length > 0) {
    const ids = done.map((row) => row.id);
    await db.transaction(async (tx) => {
      await tx.delete(messageRetrievals).where(inArray(messageRetrievals.messageId, ids));
      await tx.update(aiRuns).set({ messageId: null }).where(inArray(aiRuns.messageId, ids));
      await tx.update(handoffEvents).set({ firstHumanMessageId: null }).where(inArray(handoffEvents.firstHumanMessageId, ids));
      await tx.delete(messages).where(inArray(messages.id, ids));
    });
    await resetSummaries(done.map((row) => row.conversationId));
    round.counts.messagesDeleted += done.length;
  }
  return rows.length === MESSAGE_BATCH && done.length > 0;
}

async function deleteOldHandoffs(round: Round): Promise<boolean> {
  const rows = await db.select({ id: handoffEvents.id }).from(handoffEvents).where(lt(handoffEvents.requestedAt, round.cutoffs.conversations)).limit(ROW_BATCH);
  if (rows.length === 0) return false;
  await db.delete(handoffEvents).where(inArray(handoffEvents.id, rows.map((row) => row.id)));
  return rows.length === ROW_BATCH;
}

/** Internal notes are free text about the customer: past the conversations' months they go, in both modes. */
async function deleteOldNotes(round: Round): Promise<boolean> {
  const rows = await db.select({ id: internalNotes.id }).from(internalNotes).where(lt(internalNotes.createdAt, round.cutoffs.conversations)).limit(ROW_BATCH);
  if (rows.length === 0) return false;
  await db.delete(internalNotes).where(inArray(internalNotes.id, rows.map((row) => row.id)));
  round.counts.notesDeleted += rows.length;
  return rows.length === ROW_BATCH;
}

// ─── Conversations: anonymizing ──────────────────────────────────────────────────────────────────────────

/** Anything of a message that may say who the customer is or what they said; an anonymized message has none. */
const personalContent = or(isNotNull(messages.text), isNotNull(messages.searchText), isNotNull(messages.transcript), isNotNull(messages.media), ne(messages.metadata, {}), ne(messages.reactions, [])) as SQL;

/** The rows stay for the reports (who wrote, when, delivery and cost); what they said goes. */
async function anonymizeOldMessages(round: Round): Promise<boolean> {
  const rows = await db
    .select({ id: messages.id, conversationId: messages.conversationId, media: messages.media })
    .from(messages)
    .where(and(lt(messages.createdAt, round.cutoffs.conversations), personalContent))
    .orderBy(asc(messages.createdAt))
    .limit(MESSAGE_BATCH);
  if (rows.length === 0) return false;
  const failed = await deleteFilesOf(rows, round.storage);
  const done = rows.filter((row) => !failed.has(row.id));
  if (done.length > 0) {
    await db
      .update(messages)
      .set({ text: null, searchText: null, transcript: null, media: null, metadata: {}, reactions: [] })
      .where(inArray(messages.id, done.map((row) => row.id)));
    await resetSummaries(done.map((row) => row.conversationId));
    round.counts.messagesAnonymized += done.length;
  }
  return rows.length === MESSAGE_BATCH && done.length > 0;
}

/** A quiet conversation keeps its state, labels and numbers, but no longer points at the customer. */
async function anonymizeQuietConversations(round: Round): Promise<boolean> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(quietSince(round.cutoffs.conversations), isNotNull(conversations.contactId)))
    .limit(CONVERSATION_BATCH);
  if (rows.length === 0) return false;
  await db
    .update(conversations)
    .set({ contactId: null, summary: null, metadata: {}, externalThreadId: null })
    .where(inArray(conversations.id, rows.map((row) => row.id)));
  round.counts.conversationsAnonymized += rows.length;
  return rows.length === CONVERSATION_BATCH;
}

/** A hand-off keeps its trigger, urgency and times for the reports; its reason and summary retold the customer. */
async function anonymizeOldHandoffs(round: Round): Promise<boolean> {
  const rows = await db
    .select({ id: handoffEvents.id })
    .from(handoffEvents)
    .where(and(lt(handoffEvents.requestedAt, round.cutoffs.conversations), or(isNotNull(handoffEvents.reason), isNotNull(handoffEvents.summary))))
    .limit(ROW_BATCH);
  if (rows.length === 0) return false;
  await db
    .update(handoffEvents)
    .set({ reason: null, summary: null })
    .where(inArray(handoffEvents.id, rows.map((row) => row.id)));
  return rows.length === ROW_BATCH;
}

/** The running summary retold what is gone: it is made again from what stays when it is needed ([MOT-13]). */
async function resetSummaries(conversationIds: readonly string[]): Promise<void> {
  for (const id of new Set(conversationIds)) {
    const [row] = await db.select({ summary: conversations.summary, metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, id));
    if (!row || (row.summary === null && !("summaryUntil" in row.metadata))) continue;
    const metadata = { ...row.metadata };
    delete metadata.summaryUntil;
    await db.update(conversations).set({ summary: null, metadata }).where(eq(conversations.id, id));
  }
}
