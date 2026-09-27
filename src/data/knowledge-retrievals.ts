// The knowledge fragments each AI answer used ([CON-20], [BAN-07]): written by the reply engine right after the
// answer is stored, read by «¿Por qué respondió esto?» (src/data/message-sources.ts, same access as the
// conversation). Title, section and page are copied: the chunk may disappear with a re-index or a deletion.
import "server-only";
import { inArray } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { kbChunks, kbDocuments, knowledgeBases, messageRetrievals } from "@/db/schema";
import type { KnowledgeRetrieval } from "@/server/knowledge/types";
import { safeErrorMessage } from "@/server/redact";

const idsOf = (values: readonly (string | null)[]) => [...new Set(values.filter((id): id is string => Boolean(id)))];

async function existingChunks(ids: string[], executor: Executor): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  return new Set((await executor.select({ id: kbChunks.id }).from(kbChunks).where(inArray(kbChunks.id, ids))).map((row) => row.id));
}

async function existingDocuments(ids: string[], executor: Executor): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  return new Set((await executor.select({ id: kbDocuments.id }).from(kbDocuments).where(inArray(kbDocuments.id, ids))).map((row) => row.id));
}

async function existingBases(ids: string[], executor: Executor): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  return new Set((await executor.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, ids))).map((row) => row.id));
}

/**
 * System: stores the fragments of an answer. A chunk, document or base deleted while the model worked is kept as a
 * copy without its link. Never throws: the answer is already sent, a missing source list must not undo it.
 */
export async function recordMessageRetrievals(messageId: string, retrievals: readonly KnowledgeRetrieval[], executor: Executor = db): Promise<void> {
  if (retrievals.length === 0) return;
  try {
    const [chunks, documents, bases] = await Promise.all([
      existingChunks(idsOf(retrievals.map((item) => item.chunkId)), executor),
      existingDocuments(idsOf(retrievals.map((item) => item.documentId)), executor),
      existingBases(idsOf(retrievals.map((item) => item.kbId)), executor),
    ]);
    const now = new Date();
    await executor.insert(messageRetrievals).values(
      retrievals.map((item) => ({
        messageId,
        chunkId: item.chunkId && chunks.has(item.chunkId) ? item.chunkId : null,
        documentId: item.documentId && documents.has(item.documentId) ? item.documentId : null,
        kbId: item.kbId && bases.has(item.kbId) ? item.kbId : null,
        rank: item.rank,
        score: item.score,
        title: item.title,
        section: item.section,
        page: item.page,
        createdAt: now,
        updatedAt: now,
      })),
    );
  } catch (error) {
    console.warn(`[knowledge] No se han podido guardar las fuentes de una respuesta: ${safeErrorMessage(error)}`);
  }
}
