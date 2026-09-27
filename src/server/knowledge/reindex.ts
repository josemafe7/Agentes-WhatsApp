// Atomic re-index of a base ([CON-13], [AJU-05]): a new index_version is built next to the current one (chunks and,
// with a key, embeddings with the new model) while searches keep using the old one; when every document is in the
// new version, one transaction switches the base to it, and only then are the old chunks deleted. A newer re-index
// (another model change) supersedes a running one: the old job sees another building version and stops.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { kbDocuments, knowledgeBases } from "@/db/schema";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import type { JobQueue } from "@/server/adapters/job-queue";
import type { OpenRouterDeps } from "@/server/ai/openrouter";
import { MIN_STEP_BUDGET_MS } from "./constants";
import { EmbeddingDimensionsError } from "./embeddings";
import { KnowledgeProcessingError } from "./errors";
import { embedPendingChunks, writeDocumentChunks, type StepBudget } from "./ingest";
import { cancelReindex, enqueueReindex, scheduleEmbeddingsBackfill, type ReindexPayload } from "./queue";
import { chunksOfDocument, chunksOfVersion, chunksOutsideVersion, countChunks, deleteChunksWhere, loadKnowledgeBaseRow } from "./store";
import { fallbackSummary } from "./summary";
import { knowledgeAiClient } from "./ai";

const IN_PROGRESS = ["queued", "extracting", "chunking", "embedding"] as const;

/**
 * Starts (or restarts) the re-index of a base, optionally with a new embeddings model. The current index stays in
 * use until the new one is complete. Returns the version being built.
 */
export async function startReindex(kbId: string, options: { model?: string; queue?: JobQueue } = {}): Promise<{ version: number; model: string }> {
  const kb = await loadKnowledgeBaseRow(kbId);
  if (!kb) throw new Error("Base de conocimiento no encontrada.");
  const model = options.model ?? kb.embeddingModel;
  const version = Math.max(kb.indexVersion, kb.buildingIndexVersion ?? 0) + 1;
  await db.update(knowledgeBases).set({ buildingIndexVersion: version, updatedAt: new Date() }).where(eq(knowledgeBases.id, kbId));
  await enqueueReindex({ kbId, version, model }, options.queue);
  return { version, model };
}

/** Drops a re-index in progress and the chunks it had built (the model turned out to be wrong, the base is deleted…). */
export async function abortReindex(kbId: string, version: number, queue?: JobQueue): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeBases)
      .set({ buildingIndexVersion: null, updatedAt: new Date() })
      .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.buildingIndexVersion, version)));
    await deleteChunksWhere(chunksOfVersion(kbId, version), tx);
  });
  await cancelReindex(kbId, queue);
}

export type ReindexOutcome = "done" | "continue" | "wait" | "superseded" | "aborted";

/** One run of the re-index job: builds what is missing in the new version while there is time, then switches. */
export async function processReindex(payload: ReindexPayload, budget: StepBudget, deps: OpenRouterDeps = {}): Promise<ReindexOutcome> {
  const kb = await loadKnowledgeBaseRow(payload.kbId);
  if (!kb || kb.buildingIndexVersion !== payload.version) return "superseded";
  const docs = await db
    .select({
      id: kbDocuments.id,
      kbId: kbDocuments.kbId,
      status: kbDocuments.status,
      sourceType: kbDocuments.sourceType,
      title: kbDocuments.title,
      faqQuestion: kbDocuments.faqQuestion,
      contentMd: kbDocuments.contentMd,
      summary: kbDocuments.summary,
    })
    .from(kbDocuments)
    .where(eq(kbDocuments.kbId, kb.id));
  const hasKey = kb.searchMode === "hybrid" && (await knowledgeAiClient(deps)) !== null;
  try {
    for (const doc of docs.filter((candidate) => candidate.status === "ready")) {
      if (budget.remainingMs() < MIN_STEP_BUDGET_MS) return "continue";
      const summary = doc.summary ?? fallbackSummary(doc.contentMd ?? "");
      if ((await countChunks(chunksOfDocument(doc.id, payload.version))) === 0) {
        try {
          await writeDocumentChunks(doc, { version: payload.version, currentVersion: kb.indexVersion, model: payload.model, dims: EMBEDDING_DIMENSIONS, summary });
        } catch (error) {
          // A ready document without text left (should not happen): it just has no chunks in the new version.
          if (!(error instanceof KnowledgeProcessingError)) throw error;
          continue;
        }
      }
      if (!hasKey) continue;
      const complete = await embedPendingChunks(
        { documentId: doc.id, version: payload.version, model: payload.model, dims: EMBEDDING_DIMENSIONS, summary, title: doc.title },
        budget,
        deps,
      );
      if (!complete) return "continue";
    }
  } catch (error) {
    if (!(error instanceof EmbeddingDimensionsError)) throw error;
    // The new model cannot be used: the base keeps its current index and model.
    await abortReindex(kb.id, payload.version);
    console.error(`[knowledge] Re-indexado cancelado: ${error.reason}`);
    return "aborted";
  }
  if (docs.some((doc) => (IN_PROGRESS as readonly string[]).includes(doc.status))) return "wait";

  const switched = await db.transaction(async (tx) => {
    // Checked again inside the transaction (writers are serialized): nothing started processing meanwhile.
    const busy = await tx
      .select({ id: kbDocuments.id })
      .from(kbDocuments)
      .where(and(eq(kbDocuments.kbId, kb.id), inArray(kbDocuments.status, [...IN_PROGRESS])))
      .limit(1);
    if (busy.length > 0) return "wait" as const;
    const rows = await tx
      .update(knowledgeBases)
      .set({ indexVersion: payload.version, embeddingModel: payload.model, embeddingDims: EMBEDDING_DIMENSIONS, buildingIndexVersion: null, updatedAt: new Date() })
      .where(and(eq(knowledgeBases.id, kb.id), eq(knowledgeBases.buildingIndexVersion, payload.version)))
      .returning({ id: knowledgeBases.id });
    if (rows.length === 0) return "superseded" as const;
    await deleteChunksWhere(chunksOutsideVersion(kb.id, payload.version), tx);
    return "done" as const;
  });
  if (switched === "done" && kb.searchMode === "hybrid" && !hasKey) await scheduleEmbeddingsBackfill();
  return switched;
}
