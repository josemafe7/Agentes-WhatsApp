// Job handlers of the knowledge ([CON-05], [CON-09], [CON-12], [CON-13]). Imported once by
// src/server/jobs/handlers/index.ts, so every process that runs tick() knows them. Each run does what fits in the
// tick and re-schedules itself for the rest.
import "server-only";
import { registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { REINDEX_WAIT_MS } from "./constants";
import { markDocumentFailed, processDocument } from "./ingest";
import { addSitemapPages, backfillEmbeddings, refreshDuePages, rescheduleRefresh } from "./maintenance";
import {
  emptyPayloadSchema,
  KNOWLEDGE_EMBEDDINGS_JOB,
  KNOWLEDGE_PROCESS_JOB,
  KNOWLEDGE_REFRESH_JOB,
  KNOWLEDGE_REINDEX_JOB,
  KNOWLEDGE_SITEMAP_JOB,
  processPayloadSchema,
  reindexPayloadSchema,
  scheduleEmbeddingsBackfill,
  sitemapPayloadSchema,
  type ProcessPayload,
  type ReindexPayload,
  type SitemapPayload,
} from "./queue";
import { processReindex } from "./reindex";

const isLastAttempt = (context: JobContext) => context.job.attempts >= context.job.maxAttempts;

export async function runProcessJob(payload: ProcessPayload, context: JobContext): Promise<void> {
  try {
    if ((await processDocument(payload.documentId, context)) === "continue") context.rescheduleAt(new Date());
  } catch (error) {
    // The queue retries with backoff; after the last attempt the document shows why it stopped.
    if (isLastAttempt(context)) await markDocumentFailed(payload.documentId, error);
    throw error;
  }
}

export async function runReindexJob(payload: ReindexPayload, context: JobContext): Promise<void> {
  const outcome = await processReindex(payload, context);
  if (outcome === "continue") context.rescheduleAt(new Date());
  else if (outcome === "wait") context.rescheduleAt(new Date(Date.now() + REINDEX_WAIT_MS));
}

export async function runEmbeddingsJob(_payload: unknown, context: JobContext): Promise<void> {
  const outcome = await backfillEmbeddings(context);
  if (outcome === "continue") context.rescheduleAt(new Date());
  // Still no key: look again later (a new key in Settings can also start it right away).
  else if (outcome === "no_key") await scheduleEmbeddingsBackfill();
}

export async function runRefreshJob(): Promise<void> {
  await rescheduleRefresh(await refreshDuePages());
}

export async function runSitemapJob(payload: SitemapPayload): Promise<void> {
  await addSitemapPages(payload);
}

registerJobHandler(KNOWLEDGE_PROCESS_JOB, runProcessJob, { payload: processPayloadSchema });
registerJobHandler(KNOWLEDGE_REINDEX_JOB, runReindexJob, { payload: reindexPayloadSchema });
registerJobHandler(KNOWLEDGE_EMBEDDINGS_JOB, runEmbeddingsJob, { payload: emptyPayloadSchema });
registerJobHandler(KNOWLEDGE_REFRESH_JOB, runRefreshJob, { payload: emptyPayloadSchema });
registerJobHandler(KNOWLEDGE_SITEMAP_JOB, runSitemapJob, { payload: sitemapPayloadSchema });
