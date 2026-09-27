// Knowledge bases (RAG level 2), documents, chunks and the chunks used in each answer ([CON-03]–[CON-23]).
// Search indexes of kb_chunks (docs/busqueda-hibrida.md): HNSW over the halfvec embedding and GIN over a generated
// tsvector, both in the normal migrations. The `es_unaccent` text search configuration comes from drizzle/0000.
import { sql } from "drizzle-orm";
import { bigint, doublePrecision, halfvec, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { KB_DOCUMENT_STATUSES, KB_SEARCH_MODES, KB_SOURCE_TYPES } from "@/lib/enums";
import { agents } from "./agents";
import { user } from "./auth";
import { bool, EMBEDDING_DIMENSIONS, id, timestamp, timestamps, tsvector } from "./columns";
import { messages } from "./conversations";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export const knowledgeBases = pgTable("knowledge_bases", {
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
}).enableRLS();

export const agentKnowledgeBases = pgTable(
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
).enableRLS();

export const kbDocuments = pgTable(
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
    sizeBytes: bigint("size_bytes", { mode: "number" }),
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
).enableRLS();

/**
 * Searchable fragments. Never select `embedding` or `search_vector` with the row (6 KB and more each): the
 * adapters read ids and scores only. Rows of a new index version are inserted; old ones deleted afterwards.
 */
export const kbChunks = pgTable(
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
    embedding: halfvec("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    /**
     * Words of title, section and content (the text the keyword search covers), lower-cased, without accents and
     * reduced to their Spanish stem by `es_unaccent`. Written by Postgres on every insert and update.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('public.es_unaccent', coalesce("title", '') || ' ' || coalesce("section", '') || ' ' || coalesce("content", ''))`,
    ),
    /** SHA-256 of model + dims + text sent to the embeddings API (demo fixtures, docs/busqueda-hibrida.md §7). */
    contentHash: text("content_hash"),
    ...timestamps(),
  },
  (t) => [
    index("kb_chunks_kb_version_idx").on(t.kbId, t.indexVersion),
    index("kb_chunks_document_id_idx").on(t.documentId),
    index("kb_chunks_search_vector_idx").using("gin", t.searchVector),
    index("kb_chunks_embedding_idx").using("hnsw", t.embedding.op("halfvec_cosine_ops")),
  ],
).enableRLS();

/** Chunks used in an answer, with rank and score, for «¿Por qué respondió esto?» ([CON-20], [PRU-02]). */
export const messageRetrievals = pgTable(
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
    score: doublePrecision("score"),
    title: text("title"),
    section: text("section"),
    page: integer("page"),
    ...timestamps(),
  },
  (t) => [index("message_retrievals_message_id_idx").on(t.messageId)],
).enableRLS();
