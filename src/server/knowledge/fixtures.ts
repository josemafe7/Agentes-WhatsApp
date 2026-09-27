// Precomputed embeddings of the demo ([ARR-12], [ARR-13], docs/busqueda-hibrida.md §7). `pnpm seed` processes the
// demo documents without a key (chunks searchable by words) and then fills the embeddings found in
// seed/fixtures/embeddings.json by key; `pnpm seed:embeddings` recomputes the file from the same texts.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks, kbDocuments, knowledgeBases } from "@/db/schema";
import { embeddingInput } from "./chunking";
import { decodeEmbedding, embeddingKey, type EmbeddingFixtures } from "./embeddings";
import { saveChunkEmbeddings } from "./store";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";

export type ChunkEmbeddingText = { chunkId: string; key: string; text: string };

/** The exact texts (and keys) whose embeddings the index in use of a base needs, in document order. */
export async function chunkEmbeddingTexts(kbId: string): Promise<ChunkEmbeddingText[]> {
  const rows = await db
    .select({
      chunkId: kbChunks.id,
      title: kbChunks.title,
      section: kbChunks.section,
      content: kbChunks.content,
      summary: kbDocuments.summary,
      docTitle: kbDocuments.title,
      model: knowledgeBases.embeddingModel,
      dims: knowledgeBases.embeddingDims,
    })
    .from(kbChunks)
    .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
    .innerJoin(knowledgeBases, and(eq(knowledgeBases.id, kbChunks.kbId), eq(knowledgeBases.indexVersion, kbChunks.indexVersion)))
    .where(eq(kbChunks.kbId, kbId))
    .orderBy(asc(kbDocuments.createdAt), asc(kbChunks.documentId), asc(kbChunks.ord));
  return rows.map((row) => {
    const text = embeddingInput({ title: row.title ?? row.docTitle, section: row.section, summary: row.summary, content: row.content });
    return { chunkId: row.chunkId, key: embeddingKey(row.model, row.dims, text), text };
  });
}

/**
 * Fills the chunks without embedding of a base from the fixtures whose key matches. Nothing is used when the file's
 * model or size differ from the base's. Returns how many were filled and how many are still missing.
 */
export async function applyEmbeddingFixtures(kbId: string, fixtures: EmbeddingFixtures): Promise<{ filled: number; missing: number }> {
  const [base] = await db.select({ model: knowledgeBases.embeddingModel, dims: knowledgeBases.embeddingDims }).from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
  const pendingIds = new Set(
    (
      await db
        .select({ id: kbChunks.id })
        .from(kbChunks)
        .innerJoin(knowledgeBases, and(eq(knowledgeBases.id, kbChunks.kbId), eq(knowledgeBases.indexVersion, kbChunks.indexVersion)))
        .where(and(eq(kbChunks.kbId, kbId), isNull(kbChunks.embedding)))
    ).map((row) => row.id),
  );
  if (!base || fixtures.model !== base.model || fixtures.dimensions !== base.dims || fixtures.dimensions !== EMBEDDING_DIMENSIONS) {
    return { filled: 0, missing: pendingIds.size };
  }
  const found: { id: string; embedding: number[]; contentHash: string }[] = [];
  for (const chunk of await chunkEmbeddingTexts(kbId)) {
    if (!pendingIds.has(chunk.chunkId)) continue;
    const stored = fixtures.items[chunk.key];
    if (!stored) continue;
    const embedding = decodeEmbedding(stored);
    if (embedding.length === EMBEDDING_DIMENSIONS && embedding.every(Number.isFinite)) found.push({ id: chunk.chunkId, embedding, contentHash: chunk.key });
  }
  await saveChunkEmbeddings(found);
  return { filled: found.length, missing: pendingIds.size - found.length };
}
