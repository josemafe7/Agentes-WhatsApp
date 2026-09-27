// Named numbers of the knowledge pipeline ([CON-*], docs/busqueda-hibrida.md). Values marked «no verificado» in
// the docs are calibrated with the demo; they live here so there is one place to change them. Those the screens use
// too live in src/lib/knowledge-limits.ts (no server code there) and are re-exported here.
import "server-only";

export {
  CHARS_PER_TOKEN,
  DEFAULT_REFRESH_HOURS,
  MAX_KB_FILE_BYTES,
  MAX_QUERY_CHARS,
  MAX_REFRESH_HOURS,
  MIN_REFRESH_HOURS,
  SITEMAP_MAX_PAGES,
} from "@/lib/knowledge-limits";

// ─── Chunking ([CON-10]) ────────────────────────────────────────────────────────────────────────────────

export const CHUNK_TARGET_TOKENS = 400;
export const CHUNK_MIN_TOKENS = 150;
export const CHUNK_MAX_TOKENS = 600;
export const CHUNK_OVERLAP_TOKENS = 60;
/** Spreadsheet rows per block, with the header row repeated in each ([CON-08]). */
export const SPREADSHEET_BLOCK_ROWS = 20;
/** Two sentences, at most this long, for the document summary ([CON-10]). */
export const SUMMARY_MAX_CHARS = 400;
/** What the summary model reads of a document. */
export const SUMMARY_INPUT_MAX_CHARS = 12_000;

// ─── Extraction ([CON-04], [CON-06], [CON-07]) ──────────────────────────────────────────────────────────

/** Largest file turned into a context file of an agent ([CON-01]). */
export const MAX_CONTEXT_FILE_BYTES = 10 * 1024 * 1024;
/** Largest text pasted as a document or FAQ answer. */
export const MAX_PASTED_TEXT_CHARS = 200_000;
/**
 * Below this average of characters per page a PDF counts as scanned and goes to Mistral OCR
 * (docs/integracion-mistral-ocr.md «Cuándo se usa»; no verificado).
 */
export const SCANNED_PDF_MIN_CHARS_PER_PAGE = 50;
/** Pages read by one OCR call: each step of the queue does one range (docs/integracion-mistral-ocr.md). */
export const OCR_PAGES_PER_STEP = 20;
/** Pages of a PDF that are read at all (Mistral's documented limit). */
export const MAX_PDF_PAGES = 1_000;
/** Largest sitemap.xml read. */
export const SITEMAP_MAX_BYTES = 5 * 1024 * 1024;

// ─── Embeddings ([CON-11]) ──────────────────────────────────────────────────────────────────────────────

/** Texts per embeddings request (64–128). */
export const EMBEDDING_BATCH_SIZE = 96;
/** How often the pending-embeddings job looks again while chunks wait for a key ([CON-12]). */
export const EMBEDDINGS_BACKFILL_INTERVAL_MS = 10 * 60_000;

// ─── Search ([CON-16]–[CON-19]) ─────────────────────────────────────────────────────────────────────────

/** Results of each list before fusing (40 by meaning and 40 by words). */
export const SEARCH_CANDIDATES = 40;
/** RRF constant (Cormack, Clarke and Büttcher 2009; Elasticsearch's default). */
export const RRF_K = 60;
export const SEARCH_RESULTS = 8;
/** With «Reordenar resultados» on ([AJU-04]). */
export const RERANKED_RESULTS = 6;
/** Size of the answer given to the model. */
export const ANSWER_MAX_TOKENS = 3_500;
/**
 * Relevance ([CON-18]): with none of the query's words in any fragment, the best cosine similarity by meaning must
 * reach MIN_VECTOR_SIMILARITY; a word that appears is always enough ([CON-16]). A fragment found only by meaning
 * below MIN_VECTOR_HIT_SIMILARITY is noise and is left out before mixing, so it never pads the answer. Rerank:
 * lowest relevance_score kept. All «no verificado»: calibrated with the demo.
 */
export const MIN_VECTOR_SIMILARITY = 0.3;
export const MIN_VECTOR_HIT_SIMILARITY = 0.2;
export const MIN_RERANK_SCORE = 0.1;

// ─── Context files ([CON-01], [CON-02]) ─────────────────────────────────────────────────────────────────

/** Tokens of context files per agent: above it nothing is saved. */
export const CONTEXT_FILES_MAX_TOKENS = 30_000;
/** From here the app warns about the cost per message and suggests a knowledge base. */
export const CONTEXT_FILES_WARN_TOKENS = 20_000;

// ─── Jobs ───────────────────────────────────────────────────────────────────────────────────────────────

/** A step of the pipeline does not start with less time than this left in the tick. */
export const MIN_STEP_BUDGET_MS = 10_000;
/** An OCR call can take long: it needs more time left. */
export const MIN_OCR_STEP_BUDGET_MS = 45_000;
/** A document in progress while a re-index waits for it: look again after this. */
export const REINDEX_WAIT_MS = 10_000;
