// Shared types of the TextSearch and VectorSearch adapters (docs/busqueda-hibrida.md).
import "server-only";

/** A knowledge base and the index version to search in it (normally its current `index_version`, [CON-13]). */
export type KbScope = { kbId: string; indexVersion: number };

export type SearchOptions = {
  kbs: readonly KbScope[];
  /** Default 40 ([CON-16]). */
  limit?: number;
  /**
   * Text search only: longer words also match as prefixes, and a final «s» is dropped first, so «tintes» finds
   * «tinte» (FTS5 has no Spanish stemming, docs/busqueda-hibrida.md §3). Off by default.
   */
  prefix?: boolean;
};

/** Ranked result: higher `score` is better. Only ids and scores, never the embeddings ([CON-19]). */
export type SearchHit = { chunkId: string; score: number };

export const DEFAULT_SEARCH_LIMIT = 40;
