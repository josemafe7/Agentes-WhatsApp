// Level 1 knowledge: context files of an agent ([CON-01], [CON-02]). A PDF, DOCX, TXT or MD upload, or pasted
// text, becomes editable Markdown that goes whole in the agent's prompt (src/server/ai/context.ts,
// loadAgentContextFiles reads title + content_md). Each agent has at most 30,000 tokens of them: from 20,000 the app
// warns about the cost per message and suggests a knowledge base; above the cap nothing is saved.
import "server-only";
import { and, asc, eq, ne, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentContextFiles, agents } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { generateFileKey, getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { CONTEXT_FILES_MAX_TOKENS, CONTEXT_FILES_WARN_TOKENS, MAX_CONTEXT_FILE_BYTES, MAX_PASTED_TEXT_CHARS } from "@/server/knowledge/constants";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError, UnsupportedFileError } from "@/server/knowledge/errors";
import { CONTEXT_FILE_KINDS, detectKnowledgeFile, extractFileToMarkdown, KNOWLEDGE_MIME_TYPES, normalizeText } from "@/server/knowledge/extract";
import { splitPages } from "@/server/knowledge/pages";
import { estimateTokens } from "@/server/knowledge/tokens";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { deleteFileQuietly } from "./knowledge";

export const CONTEXT_FILE_KEY_PREFIX = "context-files";

export type ContextFilesBudget = {
  totalTokens: number;
  maxTokens: number;
  warnTokens: number;
  /** ok; warning = close to the cap (cost per message); full = at the cap. */
  level: "ok" | "warning" | "full";
};

export type ContextFileItem = {
  id: string;
  title: string;
  tokenCount: number;
  sourceFileName: string | null;
  sourceMimeType: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ContextFileDetail = ContextFileItem & { agentId: string; contentMd: string };

function budgetOf(totalTokens: number): ContextFilesBudget {
  const level = totalTokens >= CONTEXT_FILES_MAX_TOKENS ? "full" : totalTokens >= CONTEXT_FILES_WARN_TOKENS ? "warning" : "ok";
  return { totalTokens, maxTokens: CONTEXT_FILES_MAX_TOKENS, warnTokens: CONTEXT_FILES_WARN_TOKENS, level };
}

async function tokensOfAgent(agentId: string, exceptFileId?: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(agentContextFiles.tokenCount) })
    .from(agentContextFiles)
    .where(and(eq(agentContextFiles.agentId, agentId), ...(exceptFileId ? [ne(agentContextFiles.id, exceptFileId)] : [])));
  return Number(row?.total ?? 0);
}

async function assertAgent(agentId: unknown): Promise<string> {
  const id = idSchema.safeParse(agentId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el agente.");
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, id.data));
  if (!agent) throw new NotFoundError("No se ha encontrado el agente.");
  return agent.id;
}

async function loadFileOrThrow(fileId: unknown) {
  const id = idSchema.safeParse(fileId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el archivo de contexto.");
  const [row] = await db.select().from(agentContextFiles).where(eq(agentContextFiles.id, id.data));
  if (!row) throw new NotFoundError("No se ha encontrado el archivo de contexto.");
  return row;
}

/** Refuses what would take the agent above 30,000 tokens ([CON-02]). */
function assertWithinCap(othersTokens: number, tokens: number): void {
  if (othersTokens + tokens <= CONTEXT_FILES_MAX_TOKENS) return;
  const message = `Los archivos de contexto de este agente pasarían de ${CONTEXT_FILES_MAX_TOKENS.toLocaleString("es-ES")} tokens (${(othersTokens + tokens).toLocaleString("es-ES")}). Recorta el texto o pásalo a una base de conocimiento, donde el agente busca solo lo que necesita.`;
  throw new ValidationError(message, { contentMd: [message] });
}

// ─── Read ───────────────────────────────────────────────────────────────────────────────────────────────

export async function listAgentContextFiles(actor: Actor, agentId: unknown): Promise<{ files: ContextFileItem[]; budget: ContextFilesBudget }> {
  assertCan(actor, PERMISSIONS.agents.view);
  const id = await assertAgent(agentId);
  const files = await db
    .select({
      id: agentContextFiles.id,
      title: agentContextFiles.title,
      tokenCount: agentContextFiles.tokenCount,
      sourceFileName: agentContextFiles.sourceFileName,
      sourceMimeType: agentContextFiles.sourceMimeType,
      createdAt: agentContextFiles.createdAt,
      updatedAt: agentContextFiles.updatedAt,
    })
    .from(agentContextFiles)
    .where(eq(agentContextFiles.agentId, id))
    .orderBy(asc(agentContextFiles.createdAt));
  return { files, budget: budgetOf(files.reduce((total, file) => total + file.tokenCount, 0)) };
}

export async function getAgentContextFile(actor: Actor, fileId: unknown): Promise<ContextFileDetail> {
  assertCan(actor, PERMISSIONS.agents.view);
  const row = await loadFileOrThrow(fileId);
  return {
    id: row.id,
    agentId: row.agentId,
    title: row.title,
    contentMd: row.contentMd,
    tokenCount: row.tokenCount,
    sourceFileName: row.sourceFileName,
    sourceMimeType: row.sourceMimeType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Create, edit, delete ───────────────────────────────────────────────────────────────────────────────

const titleSchema = z.string().trim().min(1, "Escribe un título.").max(200, "Como mucho 200 caracteres.");
const contentSchema = z.string().max(MAX_PASTED_TEXT_CHARS, "El texto es demasiado largo: pásalo a una base de conocimiento.");

export const contextFileTextSchema = z.object({ title: titleSchema, contentMd: contentSchema.refine((text) => text.trim().length > 0, "Pega el texto.") }).strict();
export const contextFileUpdateSchema = z.object({ title: titleSchema.optional(), contentMd: contentSchema.optional() }).strict();
export const contextFileUploadSchema = z.object({
  fileName: z.string().trim().min(1, "Falta el nombre del archivo.").max(255),
  bytes: z.instanceof(Uint8Array),
  title: titleSchema.optional(),
});

/** Pasted text as a context file. */
export async function createAgentContextFileFromText(actor: Actor, agentId: unknown, input: unknown): Promise<{ id: string; budget: ContextFilesBudget }> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const id = await assertAgent(agentId);
  const data = parseInput(contextFileTextSchema, input);
  const contentMd = normalizeText(data.contentMd);
  const tokens = estimateTokens(contentMd);
  const others = await tokensOfAgent(id);
  assertWithinCap(others, tokens);
  const [row] = await db.insert(agentContextFiles).values({ agentId: id, title: data.title, contentMd, tokenCount: tokens }).returning({ id: agentContextFiles.id });
  await writeAudit({ actor, action: "agent.context_file_added", targetType: "agent", targetId: id, metadata: { fileId: row.id, tokens } });
  return { id: row.id, budget: budgetOf(others + tokens) };
}

/**
 * An uploaded PDF, DOCX, TXT or MD turned into Markdown ([CON-01]); the original is kept. A scanned PDF has no text:
 * the person is told to paste it or use a knowledge base (OCR is only for knowledge bases).
 */
export async function createAgentContextFileFromUpload(
  actor: Actor,
  agentId: unknown,
  input: unknown,
  options: { storage?: FileStorage } = {},
): Promise<{ id: string; budget: ContextFilesBudget }> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const id = await assertAgent(agentId);
  const data = parseInput(contextFileUploadSchema, input);
  if (data.bytes.byteLength === 0) throw new UnsupportedFileError(KNOWLEDGE_MESSAGES.emptyFile);
  if (data.bytes.byteLength > MAX_CONTEXT_FILE_BYTES) throw new UnsupportedFileError(KNOWLEDGE_MESSAGES.fileTooLarge(Math.round(MAX_CONTEXT_FILE_BYTES / 1024 / 1024)));
  const kind = detectKnowledgeFile(data.fileName, data.bytes);
  if (!kind || !CONTEXT_FILE_KINDS.includes(kind)) throw new UnsupportedFileError(KNOWLEDGE_MESSAGES.unsupportedContextFile);
  let markdown: string;
  try {
    const extracted = await extractFileToMarkdown(kind, data.bytes, { scannedReason: KNOWLEDGE_MESSAGES.scannedContextFile });
    // Page markers are for citing knowledge-base chunks; in the prompt the pages just follow each other.
    markdown = splitPages(extracted.markdown)
      .map((page) => page.markdown)
      .join("\n\n");
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw new ValidationError(error.reason, { file: [error.reason] });
    throw error;
  }
  const tokens = estimateTokens(markdown);
  const others = await tokensOfAgent(id);
  assertWithinCap(others, tokens);
  const storage = options.storage ?? getFileStorage();
  const sourceFileKey = generateFileKey(CONTEXT_FILE_KEY_PREFIX, `.${kind}`);
  await storage.put(sourceFileKey, data.bytes, KNOWLEDGE_MIME_TYPES[kind]);
  try {
    const [row] = await db
      .insert(agentContextFiles)
      .values({
        agentId: id,
        title: data.title ?? (data.fileName.replace(/\.[a-z0-9]{1,10}$/i, "").trim() || data.fileName),
        contentMd: markdown,
        tokenCount: tokens,
        sourceFileKey,
        sourceFileName: data.fileName,
        sourceMimeType: KNOWLEDGE_MIME_TYPES[kind],
      })
      .returning({ id: agentContextFiles.id });
    await writeAudit({ actor, action: "agent.context_file_added", targetType: "agent", targetId: id, metadata: { fileId: row.id, tokens, kind } });
    return { id: row.id, budget: budgetOf(others + tokens) };
  } catch (error) {
    await deleteFileQuietly(storage, sourceFileKey);
    throw error;
  }
}

/** Edits the title or the Markdown; the token count is recalculated and the cap checked again. */
export async function updateAgentContextFile(actor: Actor, fileId: unknown, input: unknown): Promise<{ budget: ContextFilesBudget }> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const row = await loadFileOrThrow(fileId);
  const data = parseInput(contextFileUpdateSchema, input);
  const contentMd = data.contentMd !== undefined ? normalizeText(data.contentMd) : row.contentMd;
  if (!contentMd.trim()) throw new ValidationError(undefined, { contentMd: ["El archivo no puede quedar vacío: bórralo si ya no lo necesitas."] });
  const tokens = estimateTokens(contentMd);
  const others = await tokensOfAgent(row.agentId, row.id);
  assertWithinCap(others, tokens);
  await db
    .update(agentContextFiles)
    .set({ title: data.title ?? row.title, contentMd, tokenCount: tokens, updatedAt: new Date() })
    .where(eq(agentContextFiles.id, row.id));
  await writeAudit({ actor, action: "agent.context_file_updated", targetType: "agent", targetId: row.agentId, metadata: { fileId: row.id, tokens } });
  return { budget: budgetOf(others + tokens) };
}

export async function deleteAgentContextFile(actor: Actor, fileId: unknown, options: { storage?: FileStorage } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const row = await loadFileOrThrow(fileId);
  await db.delete(agentContextFiles).where(eq(agentContextFiles.id, row.id));
  await writeAudit({ actor, action: "agent.context_file_deleted", targetType: "agent", targetId: row.agentId, metadata: { fileId: row.id } });
  await deleteUnusedContextOriginals([row.sourceFileKey], options.storage);
}

/**
 * System: deletes the stored originals that no context file points to any more. «Duplicar» gives the copy's files the
 * same original ([AGE-16]), so it goes only with the last file that uses it. Call it after the rows are deleted.
 */
export async function deleteUnusedContextOriginals(keys: readonly (string | null)[], storage: FileStorage = getFileStorage()): Promise<void> {
  for (const key of new Set(keys.filter((candidate): candidate is string => Boolean(candidate)))) {
    const [stillUsed] = await db.select({ id: agentContextFiles.id }).from(agentContextFiles).where(eq(agentContextFiles.sourceFileKey, key)).limit(1);
    if (!stillUsed) await deleteFileQuietly(storage, key);
  }
}
