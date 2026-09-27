// Background jobs of the knowledge ([CON-05], [MOT-15]): their names, payloads and how they are enqueued. Every
// job is idempotent and chunked into steps that fit one tick; the handlers live in ./jobs.ts.
import "server-only";
import { z } from "zod";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { EMBEDDINGS_BACKFILL_INTERVAL_MS } from "./constants";

/** Extract → chunk → embeddings of one document, step by step (its status says where it is). */
export const KNOWLEDGE_PROCESS_JOB = "knowledge.process";
/** Builds a new index version of a base and switches to it when complete ([CON-13]). */
export const KNOWLEDGE_REINDEX_JOB = "knowledge.reindex";
/** Reads a sitemap and adds its pages as documents ([CON-04]). */
export const KNOWLEDGE_SITEMAP_JOB = "knowledge.sitemap";
/** Embeddings of the chunks that were stored without them (no key at the time, [CON-12]). */
export const KNOWLEDGE_EMBEDDINGS_JOB = "knowledge.embeddings";
/** Re-reads the web pages whose refresh is due ([CON-09]). */
export const KNOWLEDGE_REFRESH_JOB = "knowledge.refresh";

export const processPayloadSchema = z.object({ documentId: z.string().min(1) });
export const reindexPayloadSchema = z.object({ kbId: z.string().min(1), version: z.number().int().positive(), model: z.string().min(1) });
export const sitemapPayloadSchema = z.object({
  kbId: z.string().min(1),
  sitemapUrl: z.string().min(1),
  maxPages: z.number().int().positive(),
  refreshIntervalHours: z.number().int().positive().nullable(),
  createdBy: z.string().nullable(),
});
export const emptyPayloadSchema = z.object({}).passthrough();

export type ProcessPayload = z.infer<typeof processPayloadSchema>;
export type ReindexPayload = z.infer<typeof reindexPayloadSchema>;
export type SitemapPayload = z.infer<typeof sitemapPayloadSchema>;

export const processDedupeKey = (documentId: string) => `knowledge.process:${documentId}`;
export const reindexDedupeKey = (kbId: string) => `knowledge.reindex:${kbId}`;
const EMBEDDINGS_DEDUPE_KEY = "knowledge.embeddings";
const REFRESH_DEDUPE_KEY = "knowledge.refresh";

type QueueOption = { queue?: JobQueue; runAt?: Date };

/** Queues the processing of a document (one pending job per document). */
export async function enqueueDocumentProcessing(documentId: string, options: QueueOption = {}): Promise<void> {
  await (options.queue ?? getJobQueue()).enqueue({
    type: KNOWLEDGE_PROCESS_JOB,
    payload: { documentId } satisfies ProcessPayload,
    dedupeKey: processDedupeKey(documentId),
    runAt: options.runAt,
  });
}

/** Drops the pending processing of a document (it is being deleted). */
export async function cancelDocumentProcessing(documentId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: processDedupeKey(documentId) });
}

export async function enqueueReindex(payload: ReindexPayload, queue: JobQueue = getJobQueue()): Promise<void> {
  // A newer re-index replaces a pending older one; a running one notices the new version and stops.
  await queue.cancel({ dedupeKey: reindexDedupeKey(payload.kbId) });
  await queue.enqueue({ type: KNOWLEDGE_REINDEX_JOB, payload, dedupeKey: reindexDedupeKey(payload.kbId) });
}

export async function cancelReindex(kbId: string, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.cancel({ dedupeKey: reindexDedupeKey(kbId) });
}

export async function enqueueSitemap(payload: SitemapPayload, queue: JobQueue = getJobQueue()): Promise<void> {
  await queue.enqueue({ type: KNOWLEDGE_SITEMAP_JOB, payload, maxAttempts: 3 });
}

/** One pending job per key, at `runAt` or earlier: a pending one planned later is replaced. */
async function enqueueNoLaterThan(queue: JobQueue, input: { type: string; dedupeKey: string; runAt: Date }): Promise<void> {
  const job = { type: input.type, payload: {}, dedupeKey: input.dedupeKey, runAt: input.runAt };
  const result = await queue.enqueue(job);
  if (result.created || result.runAt.getTime() <= input.runAt.getTime()) return;
  await queue.cancel({ dedupeKey: input.dedupeKey });
  await queue.enqueue(job);
}

/**
 * The pending-embeddings job, in EMBEDDINGS_BACKFILL_INTERVAL_MS or, with `now: true` (e.g. right after an
 * OpenRouter key is saved in Settings › IA), right away.
 */
export async function scheduleEmbeddingsBackfill(options: { now?: boolean; queue?: JobQueue } = {}): Promise<void> {
  const runAt = options.now ? new Date() : new Date(Date.now() + EMBEDDINGS_BACKFILL_INTERVAL_MS);
  await enqueueNoLaterThan(options.queue ?? getJobQueue(), { type: KNOWLEDGE_EMBEDDINGS_JOB, dedupeKey: EMBEDDINGS_DEDUPE_KEY, runAt });
}

/** The web refresh job at `runAt` (the earliest due page) or earlier. */
export async function scheduleUrlRefresh(runAt: Date, queue: JobQueue = getJobQueue()): Promise<void> {
  await enqueueNoLaterThan(queue, { type: KNOWLEDGE_REFRESH_JOB, dedupeKey: REFRESH_DEDUPE_KEY, runAt });
}
