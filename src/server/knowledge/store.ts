// System reads and writes of the knowledge tables for the pipeline and the search (no actor: the callers in
// src/data check permissions). Chunks are never selected with their embedding (3 KB each), and deleting them first
// clears the message_retrievals that point to them: nothing relies on cascades (docs/conventions.md). Text is written
// storable (src/server/storable-text.ts): Postgres refuses NUL characters, and text extracted from files and web pages
// may carry some.
import "server-only";
import { and, asc, count, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { kbChunks, kbDocuments, knowledgeBases, messageRetrievals } from "@/db/schema";
import { storableJson, storableText } from "@/server/storable-text";
import type { ChunkDraft } from "./chunking";

export type KnowledgeBaseRow = typeof knowledgeBases.$inferSelect;
export type DocumentRow = typeof kbDocuments.$inferSelect;

/** Rows inserted per statement (Postgres' limit of 65,535 parameters stays far away). */
const INSERT_BATCH = 50;

export async function loadKnowledgeBaseRow(kbId: string, executor: Executor = db): Promise<KnowledgeBaseRow | null> {
  const [row] = await executor.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
  return row ?? null;
}

export async function loadDocumentRow(documentId: string, executor: Executor = db): Promise<DocumentRow | null> {
  const [row] = await executor.select().from(kbDocuments).where(eq(kbDocuments.id, documentId));
  return row ?? null;
}

export async function updateDocument(documentId: string, changes: Partial<typeof kbDocuments.$inferInsert>, executor: Executor = db): Promise<void> {
  await executor
    .update(kbDocuments)
    .set({ ...storableJson(changes), updatedAt: new Date() })
    .where(eq(kbDocuments.id, documentId));
}

/** Sets the title only if it is still `from` (somebody may have renamed the document meanwhile): true if it changed. */
export async function replaceDocumentTitle(documentId: string, from: string, to: string, executor: Executor = db): Promise<boolean> {
  const rows = await executor
    .update(kbDocuments)
    .set({ title: storableText(to), updatedAt: new Date() })
    .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.title, from)))
    .returning({ id: kbDocuments.id });
  return rows.length > 0;
}

/**
 * Deletes the chunks matching `where` (a condition on kb_chunks), clearing first the retrievals that point to them
 * (they keep their copied title, section and page for «¿Por qué respondió esto?»).
 */
export async function deleteChunksWhere(where: SQL, executor: Executor = db): Promise<number> {
  const ids = (await executor.select({ id: kbChunks.id }).from(kbChunks).where(where)).map((row) => row.id);
  for (let start = 0; start < ids.length; start += INSERT_BATCH) {
    const batch = ids.slice(start, start + INSERT_BATCH);
    await executor.update(messageRetrievals).set({ chunkId: null }).where(inArray(messageRetrievals.chunkId, batch));
    await executor.delete(kbChunks).where(inArray(kbChunks.id, batch));
  }
  return ids.length;
}

export function chunksOfDocument(documentId: string, version?: number): SQL {
  const condition = version === undefined ? eq(kbChunks.documentId, documentId) : and(eq(kbChunks.documentId, documentId), eq(kbChunks.indexVersion, version));
  return condition as SQL;
}

/** Chunks of one index version of a base (a re-index that is dropped). */
export function chunksOfVersion(kbId: string, version: number): SQL {
  return and(eq(kbChunks.kbId, kbId), eq(kbChunks.indexVersion, version)) as SQL;
}

/** Chunks of a base outside `version` (what an atomic re-index leaves behind). */
export function chunksOutsideVersion(kbId: string, version: number): SQL {
  return and(eq(kbChunks.kbId, kbId), ne(kbChunks.indexVersion, version)) as SQL;
}

export type NewChunk = ChunkDraft & { title: string; contentHash: string | null };

/** Inserts the chunks of one document and version (without embeddings). */
export async function insertChunks(input: { kbId: string; documentId: string; version: number; chunks: readonly NewChunk[] }, executor: Executor = db): Promise<void> {
  const now = new Date();
  for (let start = 0; start < input.chunks.length; start += INSERT_BATCH) {
    await executor.insert(kbChunks).values(
      input.chunks.slice(start, start + INSERT_BATCH).map((chunk) => ({
        kbId: input.kbId,
        documentId: input.documentId,
        indexVersion: input.version,
        ord: chunk.ord,
        title: storableText(chunk.title),
        section: chunk.section === null ? null : storableText(chunk.section),
        page: chunk.page,
        content: storableText(chunk.content),
        tokenCount: chunk.tokenCount,
        embedding: null,
        contentHash: chunk.contentHash,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
}

export type PendingChunk = { id: string; title: string | null; section: string | null; content: string };

/** Chunks of a document and version still without embedding, in order. */
export async function chunksWithoutEmbedding(documentId: string, version: number, limit: number): Promise<PendingChunk[]> {
  return db
    .select({ id: kbChunks.id, title: kbChunks.title, section: kbChunks.section, content: kbChunks.content })
    .from(kbChunks)
    .where(and(eq(kbChunks.documentId, documentId), eq(kbChunks.indexVersion, version), isNull(kbChunks.embedding)))
    .orderBy(asc(kbChunks.ord))
    .limit(limit);
}

export async function countChunks(where: SQL): Promise<number> {
  const [row] = await db.select({ n: count() }).from(kbChunks).where(where);
  return row?.n ?? 0;
}

/** Stores embeddings (validated by the caller) with the key of the text they came from. */
export async function saveChunkEmbeddings(items: readonly { id: string; embedding: number[]; contentHash: string }[]): Promise<void> {
  if (items.length === 0) return;
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx.update(kbChunks).set({ embedding: item.embedding, contentHash: item.contentHash, updatedAt: new Date() }).where(eq(kbChunks.id, item.id));
    }
  });
}
