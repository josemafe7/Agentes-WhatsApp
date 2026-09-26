// Knowledge bases (RAG level 2), documents, chunks and the chunks used in each answer ([CON-03]–[CON-23]).
// The FTS5 table and the vector index over kb_chunks live in a custom migration (docs/busqueda-hibrida.md).
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { KB_DOCUMENT_STATUSES, KB_SEARCH_MODES, KB_SOURCE_TYPES } from "@/lib/enums";
import { agents } from "./agents";
import { user } from "./auth";
import { bool, EMBEDDING_DIMENSIONS, f32Vector, id, timestamp, timestamps } from "./columns";
import { messages } from "./conversations";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export const knowledgeBases = sqliteTable("knowledge_bases", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  /** Model and size of the embeddings; changing them forces a re-index ([CON-13], [AJU-05]). */
  embeddingModel: text("embedding_model").notNull().default(DEFAULT_EMBEDDING_MODEL),
  embeddingDims: integer("embedding_dims").notNull().default(EMBEDDING_DIMENSIONS),
  /** Index version searched now; chunks of other versions are ignored. */
  indexVersion: integer("index_version").notNull().default(1),
  /** Version being built by a re-index; becomes indexVersion when complete ([CON-13]). */
  buildingIndexVersion: integer("building_index_version"),
  /** hybrid = vectors + words; text = words only. */
  searchMode: text("search_mode", { enum: KB_SEARCH_MODES }).notNull().default("hybrid"),
  ...timestamps(),
});

export const agentKnowledgeBases = sqliteTable(
  "agent_knowledge_bases",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("agent_knowledge_bases_agent_kb_uq").on(t.agentId, t.knowledgeBaseId),
    index("agent_knowledge_bases_kb_idx").on(t.knowledgeBaseId),
  ],
);

export const kbDocuments = sqliteTable(
  "kb_documents",
  {
    id: id(),
    kbId: text("kb_id")
      .notNull()
      .references(() => knowledgeBases.id),
    sourceType: text("source_type", { enum: KB_SOURCE_TYPES }).notNull(),
    title: text("title").notNull(),
    /** Uploaded file (FileStorage key; the original name is never a path). */
    fileKey: text("file_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    /** Web page (source_type = url) and optional sitemap it came from. */
    url: text("url"),
    sitemapUrl: text("sitemap_url"),
    /** FAQ question/answer, pasted text or the extracted Markdown. */
    faqQuestion: text("faq_question"),
    contentMd: text("content_md"),
    status: text("status", { enum: KB_DOCUMENT_STATUSES }).notNull().default("queued"),
    /** Spanish reason when status = error (e.g. «PDF escaneado: añade la clave de Mistral OCR», [CON-07]). */
    error: text("error"),
    /** SHA-256 of the uploaded bytes: the same file is not added twice to a base ([CON-14]). */
    checksum: text("checksum"),
    /** SHA-256 of the extracted content: a refreshed URL is re-processed only if it changed ([CON-09]). */
    contentHash: text("content_hash"),
    pageCount: integer("page_count"),
    /** Two-sentence summary used in the chunk prefix ([CON-10]). */
    summary: text("summary"),
    fetchedAt: timestamp("fetched_at"),
    refreshEnabled: bool("refresh_enabled").notNull().default(false),
    refreshIntervalHours: integer("refresh_interval_hours"),
    nextRefreshAt: timestamp("next_refresh_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("kb_documents_kb_id_idx").on(t.kbId),
    index("kb_documents_status_idx").on(t.status),
    uniqueIndex("kb_documents_kb_checksum_uq")
      .on(t.kbId, t.checksum)
      .where(sql`checksum IS NOT NULL`),
  ],
);

/**
 * Searchable fragments. Never INSERT OR REPLACE (breaks the FTS triggers) and never select `embedding`
 * with the row (6 KB each). Rows of a new index version are inserted; old ones deleted afterwards.
 */
export const kbChunks = sqliteTable(
  "kb_chunks",
  {
    id: id(),
    kbId: text("kb_id")
      .notNull()
      .references(() => knowledgeBases.id),
    documentId: text("document_id")
      .notNull()
      .references(() => kbDocuments.id),
    indexVersion: integer("index_version").notNull(),
    /** Position inside the document. */
    ord: integer("ord").notNull(),
    title: text("title"),
    section: text("section"),
    page: integer("page"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    /** Null until there is an OpenRouter key ([CON-12]); rows with NULL stay out of the vector index. */
    embedding: f32Vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    /** SHA-256 of model + dims + text sent to the embeddings API (demo fixtures, docs/busqueda-hibrida.md §7). */
    contentHash: text("content_hash"),
    ...timestamps(),
  },
  (t) => [
    index("kb_chunks_kb_version_idx").on(t.kbId, t.indexVersion),
    index("kb_chunks_document_id_idx").on(t.documentId),
  ],
);

/** Chunks used in an answer, with rank and score, for «¿Por qué respondió esto?» ([CON-20], [PRU-02]). */
export const messageRetrievals = sqliteTable(
  "message_retrievals",
  {
    id: id(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id),
    /** The chunk may be gone after a re-index: title, section and page are copied. */
    chunkId: text("chunk_id").references(() => kbChunks.id, { onDelete: "set null" }),
    documentId: text("document_id").references(() => kbDocuments.id, { onDelete: "set null" }),
    kbId: text("kb_id").references(() => knowledgeBases.id, { onDelete: "set null" }),
    rank: integer("rank").notNull(),
    score: real("score"),
    title: text("title"),
    section: text("section"),
    page: integer("page"),
    ...timestamps(),
  },
  (t) => [index("message_retrievals_message_id_idx").on(t.messageId)],
);
