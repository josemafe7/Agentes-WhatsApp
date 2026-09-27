// Processing of one document by steps ([CON-05]–[CON-12]): en cola → extrayendo → troceando → embeddings → listo o
// error (con motivo). The status stored in kb_documents is the state machine: every step is idempotent, so a job
// that dies half-way starts again where the status says. Long work (OCR of a scan, embeddings of a long PDF) goes
// in pieces and the job is re-scheduled, so no step outlives maxDuration ([MOT-15]). Without an OpenRouter key the
// document ends «listo» with its chunks searchable by words and its embeddings pending ([CON-12]).
import "server-only";
import { and, eq, lt, or, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { kbChunks } from "@/db/schema";
import { isOpenRouterError } from "@/lib/openrouter/errors";
import { isMistralError, type MistralClient } from "@/lib/mistral/ocr";
import { getFileStorage, readAll, type FileStorage } from "@/server/adapters/file-storage";
import type { OpenRouterDeps } from "@/server/ai/openrouter";
import { isZdrEnabled } from "@/server/ai/openrouter";
import { WebFetchError } from "@/server/web-fetch";
import { knowledgeAiClient } from "./ai";
import { chunkMarkdown, embeddingInput } from "./chunking";
import { DEFAULT_REFRESH_HOURS, EMBEDDING_BATCH_SIZE, MAX_KB_FILE_BYTES, MIN_OCR_STEP_BUDGET_MS, MIN_STEP_BUDGET_MS } from "./constants";
import { embeddingKey, embedTexts } from "./embeddings";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError } from "./errors";
import {
  detectKnowledgeFile,
  extractFileToMarkdown,
  faqToMarkdown,
  fetchKnowledgePage,
  getMistralClient,
  isDefaultDocumentTitle,
  isScannedPdf,
  ocrPdfPages,
  pdfTextToMarkdown,
  readPdfPages,
  sha256Hex,
  type OcrDeps,
  type WebDeps,
} from "./extract";
import { joinPages, lastPageOf } from "./pages";
import { scheduleEmbeddingsBackfill, scheduleUrlRefresh } from "./queue";
import {
  chunksOfDocument,
  chunksWithoutEmbedding,
  countChunks,
  deleteChunksWhere,
  insertChunks,
  loadDocumentRow,
  loadKnowledgeBaseRow,
  replaceDocumentTitle,
  saveChunkEmbeddings,
  updateDocument,
  type DocumentRow,
  type KnowledgeBaseRow,
} from "./store";
import { fallbackSummary, summarizeDocument } from "./summary";
import { estimateTokens } from "./tokens";

export type PipelineDeps = OpenRouterDeps & OcrDeps & WebDeps & { storage?: FileStorage };

/** What a step needs of the job: how much time is left in this tick. */
export type StepBudget = { remainingMs(): number };

/** done = nothing left (ready, error or gone); continue = more steps, re-schedule the job now. */
export type ProcessOutcome = "done" | "continue";

/** Documents shorter than this get the first sentences as summary: a model call would add nothing. */
const MODEL_SUMMARY_MIN_TOKENS = 300;
const HOUR_MS = 3_600_000;

type StepResult = "next" | "continue";

// ─── Extract ────────────────────────────────────────────────────────────────────────────────────────────

async function readSourceFile(doc: DocumentRow, storage: FileStorage): Promise<Uint8Array> {
  const file = doc.fileKey ? await storage.get(doc.fileKey) : null;
  if (!file) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.missingFile);
  if (file.size > MAX_KB_FILE_BYTES) {
    await file.stream.cancel();
    throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.fileTooLarge(Math.round(MAX_KB_FILE_BYTES / 1024 / 1024)));
  }
  return readAll(file.stream);
}

function mistralFailure(error: unknown): never {
  // Rate limits and outages are retried by the queue; a rejected key or document is the document's error.
  if (isMistralError(error) && !error.retryable) throw new KnowledgeProcessingError(error.userMessage);
  throw error;
}

/** OCR of a scanned PDF, one range of pages per call while the tick has time; the Markdown grows page by page. */
async function continueOcr(doc: DocumentRow, bytes: Uint8Array, pageCount: number, client: MistralClient, budget: StepBudget): Promise<StepResult> {
  let markdown = doc.contentMd ?? "";
  let done = lastPageOf(markdown);
  while (done < pageCount) {
    if (budget.remainingMs() < MIN_OCR_STEP_BUDGET_MS) return "continue";
    let pages: { page: number; markdown: string }[];
    try {
      pages = await ocrPdfPages(client, bytes, { fromPage: done + 1, pageCount, fileName: doc.fileName ?? undefined });
    } catch (error) {
      mistralFailure(error);
    }
    markdown = [markdown, joinPages(pages)].filter(Boolean).join("\n\n");
    done = lastPageOf(markdown);
    await updateDocument(doc.id, { contentMd: markdown, pageCount });
  }
  if (!markdown.replace(/<!-- página \d+ -->/g, "").trim()) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.noText);
  await updateDocument(doc.id, { status: "chunking", contentHash: sha256Hex(markdown), error: null });
  return "next";
}

/**
 * The file's own title (PDF or Word metadata) replaces the one its name gave it ([CON-10]), never one somebody wrote:
 * only while the stored title is still that name, checked again in the same statement that changes it.
 */
async function adoptOwnTitle(doc: DocumentRow, ownTitle: string | null | undefined): Promise<void> {
  if (!ownTitle || ownTitle === doc.title || !isDefaultDocumentTitle(doc.title, doc.fileName)) return;
  await replaceDocumentTitle(doc.id, doc.title, ownTitle);
}

async function extractFile(doc: DocumentRow, budget: StepBudget, deps: PipelineDeps): Promise<StepResult> {
  const bytes = await readSourceFile(doc, deps.storage ?? getFileStorage());
  const kind = detectKnowledgeFile(doc.fileName ?? "", bytes);
  if (!kind) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.unsupportedFile);
  if (kind === "pdf") {
    // A scan being read by OCR: the pages done are already in content_md.
    if (doc.pageCount && lastPageOf(doc.contentMd) > 0) {
      const client = await getMistralClient(deps);
      if (!client) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.scannedWithoutKey);
      return continueOcr(doc, bytes, doc.pageCount, client, budget);
    }
    const text = await readPdfPages(bytes);
    await adoptOwnTitle(doc, text.title);
    if (isScannedPdf(text)) {
      const client = await getMistralClient(deps);
      if (!client) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.scannedWithoutKey);
      await updateDocument(doc.id, { contentMd: "", pageCount: text.pageCount });
      return continueOcr({ ...doc, contentMd: "", pageCount: text.pageCount }, bytes, text.pageCount, client, budget);
    }
    const markdown = pdfTextToMarkdown(text);
    await updateDocument(doc.id, { status: "chunking", contentMd: markdown, contentHash: sha256Hex(markdown), pageCount: text.pageCount, error: null });
    return "next";
  }
  const extracted = await extractFileToMarkdown(kind, bytes);
  await adoptOwnTitle(doc, extracted.title);
  await updateDocument(doc.id, {
    status: "chunking",
    contentMd: extracted.markdown,
    contentHash: sha256Hex(extracted.markdown),
    pageCount: extracted.pageCount,
    error: null,
  });
  return "next";
}

function webFailure(error: unknown): never {
  if (error instanceof WebFetchError) {
    const transient = error.reason === "timeout" || error.reason === "network" || (error.reason === "http_status" && (error.httpStatus ?? 0) >= 500);
    if (!transient) throw new KnowledgeProcessingError(error.userMessage);
  }
  throw error;
}

/** A web page: fetched again; if its content did not change and it is indexed, nothing else is done ([CON-09]). */
async function extractUrl(doc: DocumentRow, kb: KnowledgeBaseRow, deps: PipelineDeps): Promise<StepResult | "unchanged"> {
  if (!doc.url) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.noText);
  let page: Awaited<ReturnType<typeof fetchKnowledgePage>>;
  try {
    page = await fetchKnowledgePage(doc.url, deps);
  } catch (error) {
    webFailure(error);
  }
  const now = new Date();
  const nextRefreshAt = doc.refreshEnabled ? new Date(now.getTime() + (doc.refreshIntervalHours ?? DEFAULT_REFRESH_HOURS) * HOUR_MS) : null;
  // A title that was only the address becomes the page's own title.
  const title = doc.title === doc.url && page.title ? page.title.slice(0, 300) : doc.title;
  if (nextRefreshAt) await scheduleUrlRefresh(nextRefreshAt);
  if (doc.contentHash === page.contentHash && (await countChunks(chunksOfDocument(doc.id, kb.indexVersion))) > 0) {
    await updateDocument(doc.id, { status: "ready", fetchedAt: now, nextRefreshAt, error: null });
    return "unchanged";
  }
  await updateDocument(doc.id, { status: "chunking", title, contentMd: page.markdown, contentHash: page.contentHash, fetchedAt: now, nextRefreshAt, error: null });
  return "next";
}

async function stepExtract(doc: DocumentRow, kb: KnowledgeBaseRow, budget: StepBudget, deps: PipelineDeps): Promise<StepResult> {
  if (doc.status === "queued") await updateDocument(doc.id, { status: "extracting", error: null });
  switch (doc.sourceType) {
    case "file":
      return extractFile(doc, budget, deps);
    case "url": {
      const result = await extractUrl(doc, kb, deps);
      return result === "unchanged" ? "next" : result;
    }
    case "text":
      if (!doc.contentMd?.trim()) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.noText);
      await updateDocument(doc.id, { status: "chunking", contentHash: sha256Hex(doc.contentMd), error: null });
      return "next";
    case "faq":
      if (!doc.contentMd?.trim()) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.noText);
      await updateDocument(doc.id, { status: "chunking", contentHash: sha256Hex(`${doc.faqQuestion ?? ""}\n${doc.contentMd}`), error: null });
      return "next";
  }
}

// ─── Chunk ──────────────────────────────────────────────────────────────────────────────────────────────

/** The Markdown that is chunked: the extracted text, or the FAQ as «## pregunta» + answer. */
export function documentMarkdown(doc: Pick<DocumentRow, "sourceType" | "title" | "faqQuestion" | "contentMd">): string {
  if (doc.sourceType === "faq") return faqToMarkdown(doc.faqQuestion ?? doc.title, doc.contentMd ?? "");
  return doc.contentMd ?? "";
}

/**
 * Replaces the chunks of `doc` in `version` (and stale ones of older versions) by a fresh chunking, without
 * embeddings, in one transaction: a search never sees half a document. Chunking into the version in use also drops
 * the document's chunks of a version being built: they hold its old text, and the re-index builds them again from
 * the new one ([CON-13]). Returns the number of chunks.
 */
export async function writeDocumentChunks(
  doc: Pick<DocumentRow, "id" | "kbId" | "sourceType" | "title" | "faqQuestion" | "contentMd">,
  target: { version: number; currentVersion: number; model: string; dims: number; summary: string | null },
  afterWrite?: (tx: Executor) => Promise<void>,
): Promise<number> {
  const chunks = chunkMarkdown(documentMarkdown(doc));
  if (chunks.length === 0) throw new KnowledgeProcessingError(KNOWLEDGE_MESSAGES.noText);
  const rows = chunks.map((chunk) => ({
    ...chunk,
    title: doc.title,
    contentHash: embeddingKey(target.model, target.dims, embeddingInput({ title: doc.title, section: chunk.section, summary: target.summary, content: chunk.content })),
  }));
  await db.transaction(async (tx) => {
    const replaced = (
      target.version === target.currentVersion
        ? eq(kbChunks.documentId, doc.id)
        : and(eq(kbChunks.documentId, doc.id), or(eq(kbChunks.indexVersion, target.version), lt(kbChunks.indexVersion, target.currentVersion)))
    ) as SQL;
    await deleteChunksWhere(replaced, tx);
    await insertChunks({ kbId: doc.kbId, documentId: doc.id, version: target.version, chunks: rows }, tx);
    if (afterWrite) await afterWrite(tx);
  });
  return rows.length;
}

async function stepChunk(doc: DocumentRow, kb: KnowledgeBaseRow, deps: PipelineDeps): Promise<StepResult> {
  const markdown = documentMarkdown(doc);
  const client = estimateTokens(markdown) >= MODEL_SUMMARY_MIN_TOKENS ? await knowledgeAiClient(deps) : null;
  const summary = client ? await summarizeDocument({ title: doc.title, markdown }, { client }) : fallbackSummary(markdown);
  const next = kb.searchMode === "hybrid" ? "embedding" : "ready";
  await writeDocumentChunks(
    doc,
    { version: kb.indexVersion, currentVersion: kb.indexVersion, model: kb.embeddingModel, dims: kb.embeddingDims, summary },
    async (tx) => {
      await updateDocument(doc.id, { status: next, summary, error: null }, tx);
    },
  );
  return "next";
}

// ─── Embeddings ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Embeds chunks of `documentId` in `version` that still have none, batch by batch while the tick has time.
 * Returns true when none is left.
 */
export async function embedPendingChunks(
  input: { documentId: string; version: number; model: string; dims: number; summary: string | null; title: string },
  budget: StepBudget,
  deps: OpenRouterDeps,
): Promise<boolean> {
  const client = await knowledgeAiClient(deps);
  if (!client) return false;
  const zdr = await isZdrEnabled();
  while (budget.remainingMs() >= MIN_STEP_BUDGET_MS) {
    const pending = await chunksWithoutEmbedding(input.documentId, input.version, EMBEDDING_BATCH_SIZE);
    if (pending.length === 0) return true;
    const texts = pending.map((chunk) => embeddingInput({ title: chunk.title ?? input.title, section: chunk.section, summary: input.summary, content: chunk.content }));
    const vectors = await embedTexts(client, texts, { model: input.model, zdr, dims: input.dims });
    await saveChunkEmbeddings(pending.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index], contentHash: embeddingKey(input.model, input.dims, texts[index]) })));
  }
  return (await chunksWithoutEmbedding(input.documentId, input.version, 1)).length === 0;
}

/** Failures that a retry will not fix and that leave the document searchable by words: it waits for a working key. */
function waitsForKey(error: unknown): boolean {
  return isOpenRouterError(error) && ["invalid_key", "no_credits", "key_limit", "model_unavailable", "bad_request"].includes(error.code);
}

async function stepEmbed(doc: DocumentRow, kb: KnowledgeBaseRow, budget: StepBudget, deps: PipelineDeps): Promise<StepResult> {
  if (kb.searchMode !== "hybrid") {
    await updateDocument(doc.id, { status: "ready", error: null });
    return "next";
  }
  // The base switched to a new index version meanwhile: chunk again into the current one.
  if ((await countChunks(chunksOfDocument(doc.id, kb.indexVersion))) === 0) {
    await updateDocument(doc.id, { status: "chunking" });
    return "next";
  }
  if (!(await knowledgeAiClient(deps))) {
    await updateDocument(doc.id, { status: "ready", error: null });
    await scheduleEmbeddingsBackfill();
    return "next";
  }
  let complete: boolean;
  try {
    complete = await embedPendingChunks(
      { documentId: doc.id, version: kb.indexVersion, model: kb.embeddingModel, dims: kb.embeddingDims, summary: doc.summary, title: doc.title },
      budget,
      deps,
    );
  } catch (error) {
    if (!waitsForKey(error)) throw error;
    await updateDocument(doc.id, { status: "ready", error: null });
    await scheduleEmbeddingsBackfill();
    return "next";
  }
  if (!complete) return "continue";
  await updateDocument(doc.id, { status: "ready", error: null });
  return "next";
}

// ─── Driver ─────────────────────────────────────────────────────────────────────────────────────────────

/** Runs the steps of one document while the tick has time. Processing errors end as the document's error. */
export async function processDocument(documentId: string, budget: StepBudget, deps: PipelineDeps = {}): Promise<ProcessOutcome> {
  for (;;) {
    const doc = await loadDocumentRow(documentId);
    if (!doc || doc.status === "ready" || doc.status === "error") return "done";
    const kb = await loadKnowledgeBaseRow(doc.kbId);
    if (!kb) return "done";
    if (budget.remainingMs() < MIN_STEP_BUDGET_MS) return "continue";
    try {
      let result: StepResult;
      if (doc.status === "queued" || doc.status === "extracting") result = await stepExtract(doc, kb, budget, deps);
      else if (doc.status === "chunking") result = await stepChunk(doc, kb, deps);
      else result = await stepEmbed(doc, kb, budget, deps);
      if (result === "continue") return "continue";
    } catch (error) {
      if (!(error instanceof KnowledgeProcessingError)) throw error;
      await updateDocument(doc.id, { status: "error", error: error.reason });
      return "done";
    }
  }
}

/**
 * The job used its last attempt on a transient failure: a document waiting for embeddings stays searchable by
 * words (they are filled in later); any other ends in error with a generic reason.
 */
export async function markDocumentFailed(documentId: string, error: unknown): Promise<void> {
  const doc = await loadDocumentRow(documentId);
  if (!doc || doc.status === "ready" || doc.status === "error") return;
  if (doc.status === "embedding") {
    await updateDocument(doc.id, { status: "ready", error: null });
    await scheduleEmbeddingsBackfill();
    return;
  }
  const reason = isOpenRouterError(error) || isMistralError(error) || error instanceof WebFetchError ? error.userMessage : KNOWLEDGE_MESSAGES.unexpected;
  await updateDocument(doc.id, { status: "error", error: reason });
}
