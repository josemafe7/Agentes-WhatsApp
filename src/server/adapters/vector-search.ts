// VectorSearch: semantic search over kb_chunks.embedding (halfvec(1536), cosine distance `<=>` of pgvector),
// docs/busqueda-hibrida.md §2 and §8. Few eligible chunks → exact search (every distance computed, the filter applied
// before LIMIT). Many → the HNSW index with iterative scans, so the base and version filter still fills the results,
// re-sorted exactly afterwards and completed with the exact search if the index leaves too few.
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db as defaultDb, rowsOf, type Executor } from "@/db";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { DEFAULT_SEARCH_LIMIT, type SearchHit, type SearchOptions } from "./search-types";
import { kbScopeCondition } from "./text-search";

export interface VectorSearch {
  search(embedding: readonly number[], options: SearchOptions): Promise<SearchHit[]>;
  /** Rebuilds the HNSW index of kb_chunks.embedding. */
  rebuild(): Promise<void>;
}

/** Below this many eligible chunks the exact search is used (not measured; docs/busqueda-hibrida.md). */
export const EXACT_SEARCH_THRESHOLD = 5_000;
/** `hnsw.ef_search` of the index search: how many candidates the HNSW scan keeps (pgvector's default is 40). */
export const INDEX_TOP_K = 200;

/** The query vector's type: the same as the column, from the product's fixed size (a constant, never input). */
const HALFVEC = sql.raw(`halfvec(${EMBEDDING_DIMENSIONS})`);

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

export class PgVectorSearch implements VectorSearch {
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
    const vector = sql`${JSON.stringify(embedding)}::${HALFVEC}`;
    const scope = kbScopeCondition(options.kbs);
    const [{ n: eligible }] = rowsOf<{ n: number }>(
      await this.db.execute(sql`SELECT count(*)::int AS n FROM kb_chunks AS c WHERE (${scope}) AND c.embedding IS NOT NULL`),
    );
    if (eligible === 0) return [];
    if (eligible > this.exactThreshold) {
      const approximate = await this.indexSearch(vector, scope, limit);
      if (approximate.length >= Math.min(limit, eligible)) return approximate.map(toHit);
    }
    // MATERIALIZED: the distances are computed for the eligible chunks only, and ORDER BY … LIMIT cannot turn it into
    // an (approximate) index scan.
    const exact = rowsOf<Row>(
      await this.db.execute(sql`
        WITH scored AS MATERIALIZED (
          SELECT c.id, c.embedding <=> ${vector} AS distance
          FROM kb_chunks AS c
          WHERE (${scope}) AND c.embedding IS NOT NULL
        )
        SELECT id AS chunk_id, distance FROM scored
        ORDER BY distance, id
        LIMIT ${limit}
      `),
    );
    return exact.map(toHit);
  }

  /**
   * The HNSW index in a transaction of its own: set_config(…, true) is SET LOCAL (safe with Supabase's transaction
   * pooler). Read-only, so it does not wait for the global write lock (src/db/index.ts). The iterative scan goes on
   * through the index until the filter leaves `limit` rows; in relaxed order, so the outer query sorts them again
   * (`+ 0`: Postgres 17+ would otherwise trust the CTE's order).
   */
  private async indexSearch(vector: SQL, scope: SQL, limit: number): Promise<Row[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('hnsw.ef_search', ${String(this.topK)}, true), set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
      );
      return rowsOf<Row>(
        await tx.execute(sql`
          WITH nearest AS MATERIALIZED (
            SELECT c.id, c.embedding <=> ${vector} AS distance
            FROM kb_chunks AS c
            WHERE (${scope}) AND c.embedding IS NOT NULL
            ORDER BY distance
            LIMIT ${limit}
          )
          SELECT id AS chunk_id, distance FROM nearest
          ORDER BY distance + 0, id
        `),
      );
    }, { accessMode: "read only" });
  }

  async rebuild(): Promise<void> {
    await this.db.execute(sql`REINDEX INDEX kb_chunks_embedding_idx`);
  }
}

/** Cosine similarity (1 − distance); tiny negative rounding errors count as 0 distance. */
function toHit(row: Row): SearchHit {
  return { chunkId: row.chunk_id, score: 1 - Math.max(0, row.distance) };
}

let shared: VectorSearch | undefined;

export function getVectorSearch(): VectorSearch {
  shared ??= new PgVectorSearch();
  return shared;
}
