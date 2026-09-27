// Documents of a knowledge base ([CON-04]–[CON-15]): files, web pages (with optional sitemap and refresh), FAQs and
// pasted text. Adding one stores it «en cola» and queues its processing: the work happens in the background, step
// by step ([CON-05]). Server-only; every function checks the actor's permission first ([SEG-04], [SEG-13]).
import "server-only";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentContextFiles, kbChunks, kbDocuments, knowledgeBases, messageRetrievals } from "@/db/schema";
import type { KbDocumentStatus, KbSourceType } from "@/lib/enums";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { generateFileKey, getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { DEFAULT_REFRESH_HOURS, MAX_KB_FILE_BYTES, MAX_PASTED_TEXT_CHARS, MAX_REFRESH_HOURS, MIN_REFRESH_HOURS, SITEMAP_MAX_PAGES } from "@/server/knowledge/constants";
import { DuplicateDocumentError, KNOWLEDGE_MESSAGES, UnsupportedFileError } from "@/server/knowledge/errors";
import {
  defaultDocumentTitle,
  detectKnowledgeFile,
  fileExtension,
  KNOWLEDGE_MIME_TYPES,
  MAX_DOCUMENT_TITLE_CHARS,
  OLD_OFFICE_EXTENSIONS,
  sha256Hex,
  sitemapAddressFor,
} from "@/server/knowledge/extract";
import { documentsWithPendingEmbeddings } from "@/server/knowledge/maintenance";
import { cancelDocumentProcessing, enqueueDocumentProcessing, enqueueSitemap, scheduleUrlRefresh } from "@/server/knowledge/queue";
import { deleteChunksWhere } from "@/server/knowledge/store";
import { normalizeWebAddress } from "@/server/web-fetch";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { deleteFileQuietly, loadKnowledgeBaseOrThrow } from "./knowledge";
import { CONTEXT_FILE_KEY_PREFIX } from "./knowledge-context-files";

export const KNOWLEDGE_FILE_KEY_PREFIX = "knowledge";
const HOUR_MS = 3_600_000;

export type KnowledgeDocumentItem = {
  id: string;
  kbId: string;
  sourceType: KbSourceType;
  title: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  sitemapUrl: string | null;
  faqQuestion: string | null;
  status: KbDocumentStatus;
  /** Spanish reason when status = error ([CON-05]). */
  error: string | null;
  /** «Listo (solo texto)»: ready and searchable by words, embeddings waiting for a key ([CON-12]). */
  textOnly: boolean;
  pageCount: number | null;
  /** Chunks in the index in use. */
  chunkCount: number;
  fetchedAt: Date | null;
  refreshEnabled: boolean;
  refreshIntervalHours: number | null;
  nextRefreshAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeChunkView = { id: string; ord: number; section: string | null; page: number | null; tokenCount: number; content: string; hasEmbedding: boolean };
export type KnowledgeDocumentDetail = KnowledgeDocumentItem & { summary: string | null; contentMd: string | null; chunks: KnowledgeChunkView[] };

const documentColumns = {
  id: kbDocuments.id,
  kbId: kbDocuments.kbId,
  sourceType: kbDocuments.sourceType,
  title: kbDocuments.title,
  fileName: kbDocuments.fileName,
  mimeType: kbDocuments.mimeType,
  sizeBytes: kbDocuments.sizeBytes,
  url: kbDocuments.url,
  sitemapUrl: kbDocuments.sitemapUrl,
  faqQuestion: kbDocuments.faqQuestion,
  status: kbDocuments.status,
  error: kbDocuments.error,
  pageCount: kbDocuments.pageCount,
  fetchedAt: kbDocuments.fetchedAt,
  refreshEnabled: kbDocuments.refreshEnabled,
  refreshIntervalHours: kbDocuments.refreshIntervalHours,
  nextRefreshAt: kbDocuments.nextRefreshAt,
  createdAt: kbDocuments.createdAt,
  updatedAt: kbDocuments.updatedAt,
};

type DocumentRow = Omit<KnowledgeDocumentItem, "textOnly" | "chunkCount">;

async function withCounts(rows: DocumentRow[], indexVersion: number): Promise<KnowledgeDocumentItem[]> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const [counts, pending] = await Promise.all([
    db
      .select({ documentId: kbChunks.documentId, n: count() })
      .from(kbChunks)
      .where(and(inArray(kbChunks.documentId, ids), eq(kbChunks.indexVersion, indexVersion)))
      .groupBy(kbChunks.documentId),
    documentsWithPendingEmbeddings({ documentIds: ids }),
  ]);
  const pendingIds = new Set(pending.map((row) => row.documentId));
  return rows.map((row) => ({ ...row, chunkCount: counts.find((item) => item.documentId === row.id)?.n ?? 0, textOnly: pendingIds.has(row.id) }));
}

async function loadDocumentOrThrow(documentId: unknown) {
  const id = idSchema.safeParse(documentId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el documento.");
  const [row] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, id.data));
  if (!row) throw new NotFoundError("No se ha encontrado el documento.");
  return row;
}

// ─── Read ───────────────────────────────────────────────────────────────────────────────────────────────

/** Documents of a base, newest first, with their status and number of chunks. */
export async function listKnowledgeDocuments(actor: Actor, kbId: unknown, options: { sourceType?: KbSourceType } = {}): Promise<KnowledgeDocumentItem[]> {
  assertCan(actor, PERMISSIONS.knowledge.view);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const rows = await db
    .select(documentColumns)
    .from(kbDocuments)
    .where(and(eq(kbDocuments.kbId, base.id), ...(options.sourceType ? [eq(kbDocuments.sourceType, options.sourceType)] : [])))
    .orderBy(desc(kbDocuments.createdAt), asc(kbDocuments.id));
  return withCounts(rows, base.indexVersion);
}

export type KnowledgeFaqItem = { id: string; question: string; answer: string; status: KbDocumentStatus; error: string | null; updatedAt: Date };

/** The FAQs of a base with their answers, newest first: the «Preguntas frecuentes» editor ([CON-04]). */
export async function listKnowledgeFaqs(actor: Actor, kbId: unknown): Promise<KnowledgeFaqItem[]> {
  assertCan(actor, PERMISSIONS.knowledge.view);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const rows = await db
    .select({ id: kbDocuments.id, title: kbDocuments.title, faqQuestion: kbDocuments.faqQuestion, contentMd: kbDocuments.contentMd, status: kbDocuments.status, error: kbDocuments.error, updatedAt: kbDocuments.updatedAt })
    .from(kbDocuments)
    .where(and(eq(kbDocuments.kbId, base.id), eq(kbDocuments.sourceType, "faq")))
    .orderBy(desc(kbDocuments.createdAt), asc(kbDocuments.id));
  // A FAQ keeps its answer in content_md (ingest.ts documentMarkdown builds «## pregunta» + answer from both).
  return rows.map((row) => ({ id: row.id, question: row.faqQuestion ?? row.title, answer: row.contentMd ?? "", status: row.status, error: row.error, updatedAt: row.updatedAt }));
}

/** A document with its summary, its Markdown and its chunks in the index in use (never the embeddings). */
export async function getKnowledgeDocument(actor: Actor, documentId: unknown): Promise<KnowledgeDocumentDetail> {
  assertCan(actor, PERMISSIONS.knowledge.view);
  const doc = await loadDocumentOrThrow(documentId);
  const base = await loadKnowledgeBaseOrThrow(doc.kbId);
  const inUse = and(eq(kbChunks.documentId, doc.id), eq(kbChunks.indexVersion, base.indexVersion));
  const [rows, chunks, withoutEmbedding] = await Promise.all([
    db.select(documentColumns).from(kbDocuments).where(eq(kbDocuments.id, doc.id)),
    db
      .select({ id: kbChunks.id, ord: kbChunks.ord, section: kbChunks.section, page: kbChunks.page, tokenCount: kbChunks.tokenCount, content: kbChunks.content })
      .from(kbChunks)
      .where(inUse)
      .orderBy(asc(kbChunks.ord)),
    db.select({ id: kbChunks.id }).from(kbChunks).where(and(inUse, isNull(kbChunks.embedding))),
  ]);
  const [item] = await withCounts(rows, base.indexVersion);
  const pending = new Set(withoutEmbedding.map((row) => row.id));
  return {
    ...item,
    summary: doc.summary,
    contentMd: doc.contentMd,
    chunks: chunks.map((chunk) => ({ ...chunk, hasEmbedding: !pending.has(chunk.id) })),
  };
}

// ─── Add ────────────────────────────────────────────────────────────────────────────────────────────────

async function assertNewChecksum(kbId: string, checksum: string, message: string): Promise<void> {
  const [existing] = await db.select({ id: kbDocuments.id }).from(kbDocuments).where(and(eq(kbDocuments.kbId, kbId), eq(kbDocuments.checksum, checksum))).limit(1);
  if (existing) throw new DuplicateDocumentError(message);
}

/** The unique index (kb_id, checksum) also stops a duplicate added at the same moment ([CON-14]). */
function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "";
  return /UNIQUE constraint failed/i.test(text);
}

async function insertDocument(values: typeof kbDocuments.$inferInsert, duplicateMessage: string): Promise<{ id: string }> {
  try {
    const [row] = await db.insert(kbDocuments).values(values).returning({ id: kbDocuments.id });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateDocumentError(duplicateMessage);
    throw error;
  }
}

export const knowledgeFileInputSchema = z.object({
  fileName: z.string().trim().min(1, "Falta el nombre del archivo.").max(255, "El nombre del archivo es demasiado largo."),
  bytes: z.instanceof(Uint8Array),
  title: z.string().trim().max(300).optional(),
});

/**
 * Uploads a PDF, DOCX, XLSX, CSV, TXT or MD file ([CON-04]): checked by extension and content, at most
 * MAX_KB_FILE_BYTES; the same file twice in a base is refused with «Este archivo ya está en la base» ([CON-14]).
 */
export async function addKnowledgeFile(actor: Actor, kbId: unknown, input: unknown, options: { storage?: FileStorage } = {}): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const data = parseInput(knowledgeFileInputSchema, input);
  if (data.bytes.byteLength === 0) throw new UnsupportedFileError(KNOWLEDGE_MESSAGES.emptyFile);
  if (data.bytes.byteLength > MAX_KB_FILE_BYTES) throw new UnsupportedFileError(KNOWLEDGE_MESSAGES.fileTooLarge(Math.round(MAX_KB_FILE_BYTES / 1024 / 1024)));
  if (OLD_OFFICE_EXTENSIONS.has(fileExtension(data.fileName))) throw new UnsupportedFileError(KNOWLEDGE_MESSAGES.oldExcel);
  const kind = detectKnowledgeFile(data.fileName, data.bytes);
  if (!kind) throw new UnsupportedFileError();
  const checksum = sha256Hex(data.bytes);
  await assertNewChecksum(base.id, checksum, KNOWLEDGE_MESSAGES.duplicate);

  const storage = options.storage ?? getFileStorage();
  const fileKey = generateFileKey(KNOWLEDGE_FILE_KEY_PREFIX, `.${kind}`);
  await storage.put(fileKey, data.bytes, KNOWLEDGE_MIME_TYPES[kind]);
  let row: { id: string };
  try {
    row = await insertDocument(
      {
        kbId: base.id,
        sourceType: "file",
        // Its name for now; the file's own title (PDF or Word metadata) replaces it when it is read ([CON-10]).
        title: data.title || defaultDocumentTitle(data.fileName),
        fileKey,
        fileName: data.fileName,
        mimeType: KNOWLEDGE_MIME_TYPES[kind],
        sizeBytes: data.bytes.byteLength,
        checksum,
        status: "queued",
        createdBy: actor.userId,
      },
      KNOWLEDGE_MESSAGES.duplicate,
    );
  } catch (error) {
    await deleteFileQuietly(storage, fileKey);
    throw error;
  }
  await enqueueDocumentProcessing(row.id);
  await writeAudit({ actor, action: "knowledge.document_added", targetType: "kb_document", targetId: row.id, metadata: { kbId: base.id, sourceType: "file", kind } });
  return row;
}

const refreshHoursSchema = z
  .number()
  .int()
  .min(MIN_REFRESH_HOURS, `Como poco cada ${MIN_REFRESH_HOURS} horas.`)
  .max(MAX_REFRESH_HOURS, `Como mucho cada ${MAX_REFRESH_HOURS / 24} días.`);

export const knowledgeUrlInputSchema = z
  .object({
    url: z.string().trim().min(1, "Escribe la dirección de la página.").max(2_000, "La dirección es demasiado larga."),
    /** Also add the pages of the site's sitemap.xml (or of this address, if it is a sitemap). */
    sitemap: z.boolean().optional(),
    maxPages: z.number().int().min(1).max(SITEMAP_MAX_PAGES).optional(),
    refresh: z.boolean().optional(),
    refreshIntervalHours: refreshHoursSchema.optional(),
  })
  .strict();

function webAddress(input: string): string {
  try {
    const url = new URL(normalizeWebAddress(input));
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    url.hash = "";
    return url.href;
  } catch {
    throw new ValidationError(undefined, { url: ["Escribe una dirección web completa, que empiece por http:// o https://."] });
  }
}

/**
 * A web page ([CON-04], [CON-09]); with `sitemap`, the pages of the sitemap are added in the background (up to
 * SITEMAP_MAX_PAGES). The address is checked again (public, SSRF-safe) when it is read. Returns the page's
 * document, or null when only the sitemap is read.
 */
export async function addKnowledgeUrl(actor: Actor, kbId: unknown, input: unknown): Promise<{ id: string | null; sitemapQueued: boolean }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const data = parseInput(knowledgeUrlInputSchema, input);
  const url = webAddress(data.url);
  const refreshIntervalHours = data.refresh ? (data.refreshIntervalHours ?? DEFAULT_REFRESH_HOURS) : null;
  const isSitemapFile = new URL(url).pathname.toLowerCase().endsWith(".xml");
  let id: string | null = null;
  if (!isSitemapFile) {
    const [existing] = await db.select({ id: kbDocuments.id }).from(kbDocuments).where(and(eq(kbDocuments.kbId, base.id), eq(kbDocuments.url, url))).limit(1);
    if (existing && !data.sitemap) throw new DuplicateDocumentError(KNOWLEDGE_MESSAGES.duplicateUrl);
    if (!existing) {
      const row = await insertDocument(
        {
          kbId: base.id,
          sourceType: "url",
          title: url,
          url,
          status: "queued",
          refreshEnabled: refreshIntervalHours !== null,
          refreshIntervalHours,
          createdBy: actor.userId,
        },
        KNOWLEDGE_MESSAGES.duplicateUrl,
      );
      await enqueueDocumentProcessing(row.id);
      id = row.id;
    }
  }
  if (data.sitemap || isSitemapFile) {
    await enqueueSitemap({
      kbId: base.id,
      sitemapUrl: sitemapAddressFor(url),
      maxPages: data.maxPages ?? SITEMAP_MAX_PAGES,
      refreshIntervalHours,
      createdBy: actor.userId,
    });
  }
  await writeAudit({ actor, action: "knowledge.document_added", targetType: "kb_document", targetId: id ?? base.id, metadata: { kbId: base.id, sourceType: "url", sitemap: Boolean(data.sitemap || isSitemapFile) } });
  return { id, sitemapQueued: Boolean(data.sitemap || isSitemapFile) };
}

const questionSchema = z.string().trim().min(3, "Escribe la pregunta.").max(500, "Como mucho 500 caracteres.");
const answerSchema = z.string().trim().min(1, "Escribe la respuesta.").max(10_000, "Como mucho 10.000 caracteres.");
export const knowledgeFaqInputSchema = z.object({ question: questionSchema, answer: answerSchema }).strict();

/** A frequently asked question written in the panel ([CON-04]): its own small document. */
export async function addKnowledgeFaq(actor: Actor, kbId: unknown, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const data = parseInput(knowledgeFaqInputSchema, input);
  const row = await insertDocument(
    { kbId: base.id, sourceType: "faq", title: data.question, faqQuestion: data.question, contentMd: data.answer, status: "queued", createdBy: actor.userId },
    KNOWLEDGE_MESSAGES.duplicate,
  );
  await enqueueDocumentProcessing(row.id);
  await writeAudit({ actor, action: "knowledge.document_added", targetType: "kb_document", targetId: row.id, metadata: { kbId: base.id, sourceType: "faq" } });
  return row;
}

/** Edits a FAQ: it is processed again (its chunks are replaced when the new ones are ready). */
export async function updateKnowledgeFaq(actor: Actor, documentId: unknown, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const doc = await loadDocumentOrThrow(documentId);
  if (doc.sourceType !== "faq") throw new ValidationError("Este documento no es una pregunta frecuente.");
  const data = parseInput(knowledgeFaqInputSchema, input);
  await db
    .update(kbDocuments)
    .set({ title: data.question, faqQuestion: data.question, contentMd: data.answer, status: "queued", error: null, updatedAt: new Date() })
    .where(eq(kbDocuments.id, doc.id));
  await enqueueDocumentProcessing(doc.id);
  await writeAudit({ actor, action: "knowledge.document_updated", targetType: "kb_document", targetId: doc.id, metadata: { kbId: doc.kbId, sourceType: "faq" } });
}

export const knowledgeTextInputSchema = z
  .object({
    title: z.string().trim().min(1, "Escribe un título.").max(300, "Como mucho 300 caracteres."),
    text: z.string().trim().min(1, "Pega el texto.").max(MAX_PASTED_TEXT_CHARS, "El texto es demasiado largo: súbelo como archivo."),
  })
  .strict();

/** Pasted text as a document. */
export async function addKnowledgeText(actor: Actor, kbId: unknown, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const data = parseInput(knowledgeTextInputSchema, input);
  const row = await insertDocument(
    { kbId: base.id, sourceType: "text", title: data.title, contentMd: data.text, checksum: sha256Hex(data.text), status: "queued", createdBy: actor.userId },
    KNOWLEDGE_MESSAGES.duplicate,
  );
  await enqueueDocumentProcessing(row.id);
  await writeAudit({ actor, action: "knowledge.document_added", targetType: "kb_document", targetId: row.id, metadata: { kbId: base.id, sourceType: "text" } });
  return row;
}

// ─── Change and delete ──────────────────────────────────────────────────────────────────────────────────

/**
 * «Reprocesar» / «Refrescar» ([CON-05], [CON-09]): processed again from its source. A file or a web page is read
 * again; its current chunks stay searchable until the new ones replace them.
 */
export async function reprocessKnowledgeDocument(actor: Actor, documentId: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const doc = await loadDocumentOrThrow(documentId);
  const rereadsSource = doc.sourceType === "file" || doc.sourceType === "url";
  await db
    .update(kbDocuments)
    .set({ status: "queued", error: null, ...(rereadsSource ? { contentMd: null, contentHash: null } : {}), updatedAt: new Date() })
    .where(eq(kbDocuments.id, doc.id));
  await enqueueDocumentProcessing(doc.id);
  await writeAudit({ actor, action: "knowledge.document_reprocessed", targetType: "kb_document", targetId: doc.id, metadata: { kbId: doc.kbId } });
}

export const knowledgeTitleInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Escribe un título.")
      .max(MAX_DOCUMENT_TITLE_CHARS, `Como mucho ${MAX_DOCUMENT_TITLE_CHARS} caracteres.`)
      // One line, as it goes in every fragment («Documento: título > sección»).
      .transform((title) => title.replace(/\s+/g, " ")),
  })
  .strict();

/**
 * «Cambiar título» of a file, web page or text ([CON-10]). The title is in every chunk («Documento: título > sección»),
 * in the words index and in the embeddings, so the document is processed again from its chunks, like an edited FAQ:
 * its text is not read again, and its current chunks stay searchable until the new ones replace them. While its text
 * is still being read, only the title changes (the processing already queued uses it). A FAQ's title is its question.
 */
export async function renameKnowledgeDocument(actor: Actor, documentId: unknown, input: unknown): Promise<{ changed: boolean }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const doc = await loadDocumentOrThrow(documentId);
  const { title } = parseInput(knowledgeTitleInputSchema, input);
  if (doc.sourceType === "faq") throw new ValidationError(undefined, { title: ["El título de una pregunta frecuente es su pregunta: cámbiala en «Preguntas frecuentes»."] });
  if (title === doc.title) return { changed: false };
  const rechunk = doc.contentMd !== null && doc.status !== "queued" && doc.status !== "extracting";
  await db
    .update(kbDocuments)
    .set({ title, ...(rechunk ? { status: "chunking" as const, error: null } : {}), updatedAt: new Date() })
    .where(eq(kbDocuments.id, doc.id));
  if (rechunk) await enqueueDocumentProcessing(doc.id);
  await writeAudit({ actor, action: "knowledge.document_renamed", targetType: "kb_document", targetId: doc.id, metadata: { kbId: doc.kbId, sourceType: doc.sourceType } });
  return { changed: true };
}

export const knowledgeRefreshInputSchema = z.object({ enabled: z.boolean(), intervalHours: refreshHoursSchema.optional() }).strict();

/** Periodic refresh of a web page on or off ([CON-09]). */
export async function setKnowledgeDocumentRefresh(actor: Actor, documentId: unknown, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const doc = await loadDocumentOrThrow(documentId);
  if (doc.sourceType !== "url") throw new ValidationError("Solo las páginas web se pueden refrescar.");
  const data = parseInput(knowledgeRefreshInputSchema, input);
  const hours = data.intervalHours ?? doc.refreshIntervalHours ?? DEFAULT_REFRESH_HOURS;
  const nextRefreshAt = data.enabled ? new Date((doc.fetchedAt ?? new Date()).getTime() + hours * HOUR_MS) : null;
  await db
    .update(kbDocuments)
    .set({ refreshEnabled: data.enabled, refreshIntervalHours: data.enabled ? hours : doc.refreshIntervalHours, nextRefreshAt, updatedAt: new Date() })
    .where(eq(kbDocuments.id, doc.id));
  if (nextRefreshAt) await scheduleUrlRefresh(nextRefreshAt);
  await writeAudit({ actor, action: "knowledge.document_refresh_changed", targetType: "kb_document", targetId: doc.id, metadata: { enabled: data.enabled, hours } });
}

/**
 * For /api/files: whether `key` is the original file of a knowledge document the actor may see (knowledge.view),
 * or of an agent's context file (agents.view). Never true for a key that no row points to.
 */
export async function canViewKnowledgeFile(actor: Actor, key: string): Promise<boolean> {
  if (key.startsWith(`${KNOWLEDGE_FILE_KEY_PREFIX}/`)) {
    if (!can(actor, PERMISSIONS.knowledge.view)) return false;
    const [row] = await db.select({ id: kbDocuments.id }).from(kbDocuments).where(eq(kbDocuments.fileKey, key)).limit(1);
    return Boolean(row);
  }
  if (key.startsWith(`${CONTEXT_FILE_KEY_PREFIX}/`)) {
    if (!can(actor, PERMISSIONS.agents.view)) return false;
    const [row] = await db.select({ id: agentContextFiles.id }).from(agentContextFiles).where(eq(agentContextFiles.sourceFileKey, key)).limit(1);
    return Boolean(row);
  }
  return false;
}

/** Deletes a document, its chunks and its file ([CON-15]); answers that used it keep their copied sources. */
export async function deleteKnowledgeDocument(actor: Actor, documentId: unknown, options: { storage?: FileStorage } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const doc = await loadDocumentOrThrow(documentId);
  await cancelDocumentProcessing(doc.id);
  await db.transaction(async (tx) => {
    await deleteChunksWhere(eq(kbChunks.documentId, doc.id), tx);
    await tx.update(messageRetrievals).set({ documentId: null }).where(eq(messageRetrievals.documentId, doc.id));
    await tx.delete(kbDocuments).where(eq(kbDocuments.id, doc.id));
    await tx.update(knowledgeBases).set({ updatedAt: new Date() }).where(eq(knowledgeBases.id, doc.kbId));
    await writeAudit(
      { actor, action: "knowledge.document_deleted", targetType: "kb_document", targetId: doc.id, metadata: { kbId: doc.kbId, sourceType: doc.sourceType } },
      tx,
    );
  });
  if (doc.fileKey) await deleteFileQuietly(options.storage ?? getFileStorage(), doc.fileKey);
}
