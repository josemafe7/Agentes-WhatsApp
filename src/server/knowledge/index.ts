// Knowledge (RAG) of the agents ([CON-*], docs/busqueda-hibrida.md): the entry points other parts of the server use.
// Screens go through src/data/knowledge*.ts, which check permissions; the job handlers are registered by ./jobs.ts.
import "server-only";

export { agentKnowledgeBaseIds, KNOWLEDGE_TOOL_NAME, latestCustomerText, prefetchKnowledge, searchForAgent, withSystemSection } from "./agent-knowledge";
export { chunkMarkdown, chunkPrefix, embeddingInput, type ChunkDraft } from "./chunking";
export * from "./constants";
export { decodeEmbedding, embeddingKey, embedTexts, encodeEmbedding, EmbeddingDimensionsError, type EmbeddingFixtures } from "./embeddings";
export { DuplicateDocumentError, KNOWLEDGE_MESSAGES, KnowledgeProcessingError, UnsupportedFileError } from "./errors";
export { applyEmbeddingFixtures, chunkEmbeddingTexts } from "./fixtures";
export { documentMarkdown, processDocument, type PipelineDeps, type StepBudget } from "./ingest";
export { backfillEmbeddings, documentsWithPendingEmbeddings } from "./maintenance";
export { enqueueDocumentProcessing, scheduleEmbeddingsBackfill } from "./queue";
export { abortReindex, processReindex, startReindex } from "./reindex";
export { fuseRrf, type FusedHit } from "./rrf";
export {
  formatKnowledgeAnswer,
  fragmentLabel,
  isRelevant,
  KNOWLEDGE_NO_RESULTS,
  mergeRetrievals,
  searchKnowledge,
  toRetrievals,
  type KnowledgeResult,
  type KnowledgeSearchResult,
  type SearchDeps,
} from "./search";
export { fallbackSummary, summarizeDocument } from "./summary";
export { charsForTokens, estimateTokens } from "./tokens";
export type { KnowledgeRetrieval } from "./types";
