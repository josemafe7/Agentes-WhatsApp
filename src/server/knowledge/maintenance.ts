// Background upkeep of the knowledge: embeddings that waited for a key ([CON-12]), web pages due for a refresh
// ([CON-09]) and the pages of a sitemap ([CON-04]).
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, lte, min } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, knowledgeBases } from "@/db/schema";
import type { OpenRouterDeps } from "@/server/ai/openrouter";
import { knowledgeAiClient } from "./ai";
import { DEFAULT_REFRESH_HOURS, MIN_STEP_BUDGET_MS } from "./constants";
import { EmbeddingDimensionsError } from "./embeddings";
import { discoverSitemapPages, type WebDeps } from "./extract";
import { embedPendingChunks, type StepBudget } from "./ingest";
import { enqueueDocumentProcessing, scheduleEmbeddingsBackfill, scheduleUrlRefresh, type SitemapPayload } from "./queue";

/** Documents searched in one query of the pending-embeddings job. */
const PENDING_DOCUMENTS_PAGE = 20;
const HOUR_MS = 3_600_000;

/** Ready documents of hybrid bases with chunks of the current version still without embedding. */
export async function documentsWithPendingEmbeddings(options: { documentIds?: readonly string[]; limit?: number } = {}): Promise<{ documentId: string; kbId: string }[]> {
  if (options.documentIds && options.documentIds.length === 0) return [];
  const query = db
    .selectDistinct({ documentId: kbChunks.documentId, kbId: kbChunks.kbId })
    .from(kbChunks)
    .innerJoin(knowledgeBases, and(eq(knowledgeBases.id, kbChunks.kbId), eq(knowledgeBases.indexVersion, kbChunks.indexVersion)))
    .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
    .where(
      and(
        isNull(kbChunks.embedding),
        eq(knowledgeBases.searchMode, "hybrid"),
        eq(kbDocuments.status, "ready"),
        ...(options.documentIds ? [inArray(kbChunks.documentId, [...options.documentIds])] : []),
      ),
    );
  return options.limit ? query.limit(options.limit) : query;
}

export type BackfillOutcome = "done" | "continue" | "no_key";

/** Fills the embeddings that are missing, document by document, while the tick has time. */
export async function backfillEmbeddings(budget: StepBudget, deps: OpenRouterDeps = {}): Promise<BackfillOutcome> {
  if (!(await knowledgeAiClient(deps))) return (await documentsWithPendingEmbeddings({ limit: 1 })).length > 0 ? "no_key" : "done";
  for (;;) {
    const pending = await documentsWithPendingEmbeddings({ limit: PENDING_DOCUMENTS_PAGE });
    if (pending.length === 0) return "done";
    for (const { documentId, kbId } of pending) {
      if (budget.remainingMs() < MIN_STEP_BUDGET_MS) return "continue";
      const [row] = await db
        .select({ title: kbDocuments.title, summary: kbDocuments.summary, version: knowledgeBases.indexVersion, model: knowledgeBases.embeddingModel, dims: knowledgeBases.embeddingDims })
        .from(kbDocuments)
        .innerJoin(knowledgeBases, eq(knowledgeBases.id, kbDocuments.kbId))
        .where(and(eq(kbDocuments.id, documentId), eq(knowledgeBases.id, kbId)));
      if (!row) continue;
      try {
        const complete = await embedPendingChunks({ documentId, version: row.version, model: row.model, dims: row.dims, summary: row.summary, title: row.title }, budget, deps);
        if (!complete) return "continue";
      } catch (error) {
        // A base whose model is not 1536: its documents stay searchable by words; the rest go on.
        if (!(error instanceof EmbeddingDimensionsError)) throw error;
        console.error(`[knowledge] Embeddings pendientes sin calcular: ${error.reason}`);
        return "done";
      }
    }
  }
}

/**
 * At start-up (a new server or `pnpm worker`): with an OpenRouter key and embeddings still pending, the
 * pending-embeddings job is queued at once. It covers what no screen action starts: a key only in `.env.local`
 * (counted once the app restarts, [ARR-15]) and the demo loaded without vectors ([CON-12], [ARR-12]). Returns whether
 * it was queued.
 */
export async function resumePendingEmbeddings(deps: OpenRouterDeps = {}): Promise<boolean> {
  if ((await documentsWithPendingEmbeddings({ limit: 1 })).length === 0) return false;
  if (!(await knowledgeAiClient(deps))) return false;
  await scheduleEmbeddingsBackfill({ now: true });
  return true;
}

/** Queues the web pages whose refresh is due and returns when the next one is due (null: none has refresh on). */
export async function refreshDuePages(now: Date = new Date()): Promise<Date | null> {
  const due = await db
    .select({ id: kbDocuments.id, hours: kbDocuments.refreshIntervalHours })
    .from(kbDocuments)
    .where(
      and(
        eq(kbDocuments.sourceType, "url"),
        eq(kbDocuments.refreshEnabled, true),
        isNotNull(kbDocuments.nextRefreshAt),
        lte(kbDocuments.nextRefreshAt, now),
        inArray(kbDocuments.status, ["ready", "error"]),
      ),
    )
    .orderBy(asc(kbDocuments.nextRefreshAt));
  for (const { id, hours } of due) {
    // The content hash is kept: if the page did not change, nothing is chunked or embedded again ([CON-09]). The next
    // refresh is set now, so a page that fails today is tried again next time.
    const nextRefreshAt = new Date(now.getTime() + (hours ?? DEFAULT_REFRESH_HOURS) * HOUR_MS);
    await db.update(kbDocuments).set({ status: "queued", nextRefreshAt, updatedAt: now }).where(eq(kbDocuments.id, id));
    await enqueueDocumentProcessing(id, { runAt: now });
  }
  const [next] = await db
    .select({ at: min(kbDocuments.nextRefreshAt) })
    .from(kbDocuments)
    .where(and(eq(kbDocuments.sourceType, "url"), eq(kbDocuments.refreshEnabled, true), isNotNull(kbDocuments.nextRefreshAt)));
  return next?.at ?? null;
}

/** After the refresh job: the next run at the earliest due page, if any. */
export async function rescheduleRefresh(next: Date | null): Promise<void> {
  if (next) await scheduleUrlRefresh(next);
}

/**
 * The pages of a sitemap as new URL documents of the base (addresses already in it are skipped), each queued for
 * processing. Returns how many were added.
 */
export async function addSitemapPages(payload: SitemapPayload, deps: WebDeps = {}): Promise<number> {
  const [kb] = await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(eq(knowledgeBases.id, payload.kbId));
  if (!kb) return 0;
  const pages = await discoverSitemapPages(payload.sitemapUrl, { ...deps, maxPages: payload.maxPages });
  if (pages.length === 0) return 0;
  const existing = new Set(
    (await db.select({ url: kbDocuments.url }).from(kbDocuments).where(and(eq(kbDocuments.kbId, kb.id), inArray(kbDocuments.url, pages)))).map((row) => row.url),
  );
  const now = new Date();
  let added = 0;
  for (const url of pages) {
    if (existing.has(url)) continue;
    const refresh = payload.refreshIntervalHours !== null;
    const [doc] = await db
      .insert(kbDocuments)
      .values({
        kbId: kb.id,
        sourceType: "url",
        title: url,
        url,
        sitemapUrl: payload.sitemapUrl,
        status: "queued",
        refreshEnabled: refresh,
        refreshIntervalHours: payload.refreshIntervalHours,
        createdBy: payload.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: kbDocuments.id });
    await enqueueDocumentProcessing(doc.id);
    added += 1;
  }
  return added;
}
