// VectorSearch: semantic search over kb_chunks.embedding (F32_BLOB(1536)), docs/busqueda-hibrida.md §2.
// Few eligible chunks → exact search with vector_distance_cos (filter applied before LIMIT). Many → the libSQL
// vector index (vector_top_k filters after choosing k, so k is 200), completed with the exact search if
// the filter leaves too few. A future Postgres implementation uses pgvector HNSW behind the same interface.
import "server-only";
import { sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { DEFAULT_SEARCH_LIMIT, type SearchHit, type SearchOptions } from "./search-types";
import { kbScopeCondition } from "./text-search";

export interface VectorSearch {
  search(embedding: readonly number[], options: SearchOptions): Promise<SearchHit[]>;
  /** Rebuilds the vector index (after VACUUM or a table re-creation). */
  rebuild(): Promise<void>;
}

/** Below this many eligible chunks the exact search is used (not measured; docs/busqueda-hibrida.md). */
export const EXACT_SEARCH_THRESHOLD = 5_000;
/** k of vector_top_k: Turso's practical maximum is about 200 rows. */
export const INDEX_TOP_K = 200;

export class InvalidEmbeddingError extends Error {
  constructor(length: number) {
    super(`El embedding tiene ${length} dimensiones y la búsqueda necesita ${EMBEDDING_DIMENSIONS}.`);
    this.name = "InvalidEmbeddingError";
  }
}

/** Throws unless it is a 1536-dimension vector of finite numbers ([CON-11]). */
export function assertValidEmbedding(embedding: readonly number[]): void {
  if (embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every(Number.isFinite)) {
    throw new InvalidEmbeddingError(embedding.length);
  }
}

type Row = { chunk_id: string; distance: number };

export class LibsqlVectorSearch implements VectorSearch {
  private readonly db: Executor;
  private readonly exactThreshold: number;
  private readonly topK: number;

  constructor(options: { db?: Executor; exactThreshold?: number; topK?: number } = {}) {
    this.db = options.db ?? defaultDb;
    this.exactThreshold = options.exactThreshold ?? EXACT_SEARCH_THRESHOLD;
    this.topK = options.topK ?? INDEX_TOP_K;
  }

  async search(embedding: readonly number[], options: SearchOptions): Promise<SearchHit[]> {
    assertValidEmbedding(embedding);
    if (options.kbs.length === 0) return [];
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    const vector = JSON.stringify(embedding);
    const scope = kbScopeCondition(options.kbs);
    const [{ n: eligible }] = await this.db.all<{ n: number }>(sql`
      SELECT count(*) AS n FROM kb_chunks AS c WHERE (${scope}) AND c.embedding IS NOT NULL
    `);
    if (eligible === 0) return [];
    if (eligible > this.exactThreshold) {
      const approximate = await this.db.all<Row>(sql`
        SELECT c.id AS chunk_id, vector_distance_cos(c.embedding, vector32(${vector})) AS distance
        FROM vector_top_k('kb_chunks_embedding_idx', vector32(${vector}), ${this.topK}) AS v
        JOIN kb_chunks AS c ON c.rowid = v.id
        WHERE (${scope})
        ORDER BY distance, c.id
        LIMIT ${limit}
      `);
      if (approximate.length >= Math.min(limit, eligible)) return approximate.map(toHit);
    }
    const exact = await this.db.all<Row>(sql`
      SELECT c.id AS chunk_id, vector_distance_cos(c.embedding, vector32(${vector})) AS distance
      FROM kb_chunks AS c
      WHERE (${scope}) AND c.embedding IS NOT NULL
      ORDER BY distance, c.id
      LIMIT ${limit}
    `);
    return exact.map(toHit);
  }

  async rebuild(): Promise<void> {
    await this.db.run(sql`REINDEX kb_chunks_embedding_idx`);
  }
}

/** Cosine similarity (1 − distance); tiny negative rounding errors count as 0 distance. */
function toHit(row: Row): SearchHit {
  return { chunkId: row.chunk_id, score: 1 - Math.max(0, row.distance) };
}

let shared: VectorSearch | undefined;

export function getVectorSearch(): VectorSearch {
  shared ??= new LibsqlVectorSearch();
  return shared;
}
