// Knowledge bases (level 2, [CON-03]–[CON-15]) and which ones each agent uses: server-only, every function checks
// the actor's permission first ([SEG-04]). Documents are in ./knowledge-documents.ts, the test search in
// ./knowledge-search.ts, context files (level 1) in ./knowledge-context-files.ts. Deleting deletes the children
// explicitly (nothing relies on cascades).
import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentKnowledgeBases, agents, kbChunks, kbDocuments, knowledgeBases, messageRetrievals } from "@/db/schema";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import type { KbDocumentStatus, KbSearchMode } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { resolveDefaultModels } from "@/server/ai/openrouter";
import { NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { cancelDocumentProcessing, cancelReindex } from "@/server/knowledge/queue";
import { startReindex } from "@/server/knowledge/reindex";
import { deleteChunksWhere } from "@/server/knowledge/store";
import { safeErrorMessage } from "@/server/redact";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

/** State of a base as the list shows it (docs/pantallas.md «Bases de conocimiento»). */
export type KnowledgeBaseState = "empty" | "processing" | "reindexing" | "errors" | "ready";

export type KnowledgeBaseSummary = {
  id: string;
  name: string;
  description: string | null;
  embeddingModel: string;
  embeddingDims: number;
  searchMode: KbSearchMode;
  /** A new index is being built; searches still use the current one ([CON-13]). */
  reindexing: boolean;
  state: KnowledgeBaseState;
  documentCount: number;
  /** Chunks of the index in use. */
  chunkCount: number;
  processingCount: number;
  errorCount: number;
  agents: { id: string; name: string }[];
  updatedAt: Date;
};

const IN_PROGRESS: readonly KbDocumentStatus[] = ["queued", "extracting", "chunking", "embedding"];

function stateOf(summary: Pick<KnowledgeBaseSummary, "documentCount" | "processingCount" | "errorCount" | "reindexing">): KnowledgeBaseState {
  if (summary.documentCount === 0) return "empty";
  if (summary.reindexing) return "reindexing";
  if (summary.processingCount > 0) return "processing";
  if (summary.errorCount > 0) return "errors";
  return "ready";
}

async function summaries(kbIds?: readonly string[]): Promise<KnowledgeBaseSummary[]> {
  const bases = await db
    .select()
    .from(knowledgeBases)
    .where(kbIds ? inArray(knowledgeBases.id, [...kbIds]) : undefined)
    .orderBy(asc(knowledgeBases.name));
  if (bases.length === 0) return [];
  const ids = bases.map((base) => base.id);
  const [docCounts, chunkCounts, links] = await Promise.all([
    db
      .select({ kbId: kbDocuments.kbId, status: kbDocuments.status, n: count() })
      .from(kbDocuments)
      .where(inArray(kbDocuments.kbId, ids))
      .groupBy(kbDocuments.kbId, kbDocuments.status),
    db
      .select({ kbId: kbChunks.kbId, n: count() })
      .from(kbChunks)
      .innerJoin(knowledgeBases, and(eq(knowledgeBases.id, kbChunks.kbId), eq(knowledgeBases.indexVersion, kbChunks.indexVersion)))
      .where(inArray(kbChunks.kbId, ids))
      .groupBy(kbChunks.kbId),
    db
      .select({ kbId: agentKnowledgeBases.knowledgeBaseId, id: agents.id, name: agents.name })
      .from(agentKnowledgeBases)
      .innerJoin(agents, eq(agents.id, agentKnowledgeBases.agentId))
      .where(inArray(agentKnowledgeBases.knowledgeBaseId, ids))
      .orderBy(asc(agents.name)),
  ]);
  return bases.map((base) => {
    const docs = docCounts.filter((row) => row.kbId === base.id);
    const summary = {
      id: base.id,
      name: base.name,
      description: base.description,
      embeddingModel: base.embeddingModel,
      embeddingDims: base.embeddingDims,
      searchMode: base.searchMode,
      reindexing: base.buildingIndexVersion !== null,
      documentCount: docs.reduce((sum, row) => sum + row.n, 0),
      chunkCount: chunkCounts.find((row) => row.kbId === base.id)?.n ?? 0,
      processingCount: docs.filter((row) => IN_PROGRESS.includes(row.status)).reduce((sum, row) => sum + row.n, 0),
      errorCount: docs.filter((row) => row.status === "error").reduce((sum, row) => sum + row.n, 0),
      agents: links.filter((row) => row.kbId === base.id).map(({ id, name }) => ({ id, name })),
      updatedAt: base.updatedAt,
    };
    return { ...summary, state: stateOf(summary) };
  });
}

/** System: a base by id or NotFoundError. */
export async function loadKnowledgeBaseOrThrow(kbId: unknown) {
  const id = idSchema.safeParse(kbId);
  if (!id.success) throw new NotFoundError("No se ha encontrado la base de conocimiento.");
  const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id.data));
  if (!row) throw new NotFoundError("No se ha encontrado la base de conocimiento.");
  return row;
}

// ─── Read ───────────────────────────────────────────────────────────────────────────────────────────────

export async function listKnowledgeBases(actor: Actor): Promise<KnowledgeBaseSummary[]> {
  assertCan(actor, PERMISSIONS.knowledge.view);
  return summaries();
}

export async function getKnowledgeBase(actor: Actor, kbId: unknown): Promise<KnowledgeBaseSummary> {
  assertCan(actor, PERMISSIONS.knowledge.view);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const [summary] = await summaries([base.id]);
  return summary;
}

// ─── Create, edit, delete ───────────────────────────────────────────────────────────────────────────────

const nameSchema = z.string().trim().min(1, "Escribe el nombre de la base.").max(120, "Como mucho 120 caracteres.");
const descriptionSchema = z
  .string()
  .trim()
  .max(1_000, "Como mucho 1.000 caracteres.")
  .nullable()
  .optional()
  .transform((value) => value || null);

export const knowledgeBaseCreateSchema = z.object({ name: nameSchema, description: descriptionSchema }).strict();
export const knowledgeBaseUpdateSchema = z.object({ name: nameSchema.optional(), description: descriptionSchema }).strict();

/** A new base with the default embeddings model of Settings › IA (1536 dimensions, [CON-11]). */
export async function createKnowledgeBase(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const data = parseInput(knowledgeBaseCreateSchema, input);
  const { embeddings } = await resolveDefaultModels();
  const [row] = await db
    .insert(knowledgeBases)
    .values({ name: data.name, description: data.description, embeddingModel: embeddings, embeddingDims: EMBEDDING_DIMENSIONS })
    .returning({ id: knowledgeBases.id });
  await writeAudit({ actor, action: "knowledge.base_created", targetType: "knowledge_base", targetId: row.id, metadata: { name: data.name } });
  return row;
}

export async function updateKnowledgeBase(actor: Actor, kbId: unknown, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const data = parseInput(knowledgeBaseUpdateSchema, input);
  await db
    .update(knowledgeBases)
    .set({ ...(data.name !== undefined ? { name: data.name } : {}), ...("description" in data ? { description: data.description } : {}), updatedAt: new Date() })
    .where(eq(knowledgeBases.id, base.id));
  await writeAudit({ actor, action: "knowledge.base_updated", targetType: "knowledge_base", targetId: base.id, metadata: { fields: Object.keys(data) } });
}

export const knowledgeBaseDeleteSchema = z.object({ confirmName: z.string() }).strict();

/**
 * Deletes a base, after typing its name (docs/pantallas.md): its chunks, documents, files and the links to agents.
 * Answers that used it keep their copied sources.
 */
export async function deleteKnowledgeBase(actor: Actor, kbId: unknown, input: unknown, options: { storage?: FileStorage } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const { confirmName } = parseInput(knowledgeBaseDeleteSchema, input);
  if (confirmName.trim() !== base.name.trim()) {
    throw new ValidationError(undefined, { confirmName: ["Escribe el nombre exacto de la base para borrarla."] });
  }
  const documents = await db.select({ id: kbDocuments.id, fileKey: kbDocuments.fileKey }).from(kbDocuments).where(eq(kbDocuments.kbId, base.id));
  await db.transaction(async (tx) => {
    await deleteChunksWhere(eq(kbChunks.kbId, base.id), tx);
    await tx.update(messageRetrievals).set({ documentId: null, kbId: null }).where(eq(messageRetrievals.kbId, base.id));
    await tx.delete(kbDocuments).where(eq(kbDocuments.kbId, base.id));
    await tx.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.knowledgeBaseId, base.id));
    await tx.delete(knowledgeBases).where(eq(knowledgeBases.id, base.id));
    await writeAudit(
      { actor, action: "knowledge.base_deleted", targetType: "knowledge_base", targetId: base.id, metadata: { name: base.name, documents: documents.length } },
      tx,
    );
  });
  await cancelReindex(base.id);
  const storage = options.storage ?? getFileStorage();
  for (const document of documents) {
    await cancelDocumentProcessing(document.id);
    if (document.fileKey) await deleteFileQuietly(storage, document.fileKey);
  }
}

/** Deletes a stored file; a failure leaves an orphan that nothing points to (never served). */
export async function deleteFileQuietly(storage: FileStorage, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    console.error(`[knowledge] No se ha podido borrar un archivo: ${safeErrorMessage(error)}`);
  }
}

// ─── Re-index and embeddings model ([CON-13], [AJU-05]) ─────────────────────────────────────────────────

/** «Reindexar»: builds a new index of the base and switches to it when complete. */
export async function reindexKnowledgeBase(actor: Actor, kbId: unknown): Promise<{ version: number }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const { version } = await startReindex(base.id);
  await writeAudit({ actor, action: "knowledge.base_reindexed", targetType: "knowledge_base", targetId: base.id, metadata: { version } });
  return { version };
}

const modelSchema = z.object({ model: z.string().trim().regex(/^[a-z0-9._~-]+\/[a-z0-9._:~-]+$/i, "Elige un modelo de embeddings de la lista.").max(200) }).strict();

/**
 * A new embeddings model for one base: it is re-processed into a new index with that model, and the base switches
 * to it (model included) only when it is complete. The model must have been checked (1536 dimensions) where it is
 * chosen: Settings › IA already tries it for real.
 */
export async function changeKnowledgeBaseModel(actor: Actor, kbId: unknown, input: unknown): Promise<{ version: number }> {
  assertCan(actor, PERMISSIONS.knowledge.manage);
  const base = await loadKnowledgeBaseOrThrow(kbId);
  const { model } = parseInput(modelSchema, input);
  const { version } = await startReindex(base.id, { model });
  await writeAudit({ actor, action: "knowledge.model_changed", targetType: "knowledge_base", targetId: base.id, metadata: { model, version } });
  return { version };
}

/**
 * [AJU-05]: after the person confirms the new default embeddings model in Settings › IA, every base is re-processed
 * with it (each keeps searching its current index until the new one is complete). Returns how many bases.
 */
export async function reindexAllKnowledgeBases(actor: Actor, input: unknown = {}): Promise<{ count: number }> {
  assertCan(actor, PERMISSIONS.settings.integrations);
  const data = parseInput(z.object({ model: modelSchema.shape.model.optional() }).strict(), input);
  const model = data.model ?? (await resolveDefaultModels()).embeddings;
  const bases = await db.select({ id: knowledgeBases.id }).from(knowledgeBases);
  for (const base of bases) await startReindex(base.id, { model });
  await writeAudit({ actor, action: "knowledge.all_reindexed", targetType: "knowledge_base", metadata: { model, count: bases.length } });
  return { count: bases.length };
}

// ─── Agents ↔ bases ([AGE-07], [CON-03]) ────────────────────────────────────────────────────────────────

export type AgentKnowledgeBases = { selected: { id: string; name: string }[]; available: { id: string; name: string }[] };

/** The bases of an agent and all the bases that can be chosen. */
export async function listAgentKnowledgeBases(actor: Actor, agentId: unknown): Promise<AgentKnowledgeBases> {
  assertCan(actor, PERMISSIONS.agents.view);
  const id = parseInput(idSchema, agentId);
  const [all, selected] = await Promise.all([
    db.select({ id: knowledgeBases.id, name: knowledgeBases.name }).from(knowledgeBases).orderBy(asc(knowledgeBases.name)),
    db
      .select({ id: knowledgeBases.id, name: knowledgeBases.name })
      .from(agentKnowledgeBases)
      .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentKnowledgeBases.knowledgeBaseId))
      .where(eq(agentKnowledgeBases.agentId, id))
      .orderBy(asc(agentKnowledgeBases.createdAt)),
  ]);
  return { selected, available: all };
}

export const agentKnowledgeBasesSchema = z.object({ kbIds: z.array(idSchema).max(50, "Como mucho 50 bases.") }).strict();

/** Which bases an agent searches ([CON-03]): only these. */
export async function setAgentKnowledgeBases(actor: Actor, agentId: unknown, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const id = parseInput(idSchema, agentId);
  const { kbIds } = parseInput(agentKnowledgeBasesSchema, input);
  const wanted = [...new Set(kbIds)];
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, id));
  if (!agent) throw new NotFoundError("No se ha encontrado el agente.");
  const found = wanted.length > 0 ? await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, wanted)) : [];
  if (found.length !== wanted.length) throw new ValidationError(undefined, { kbIds: ["Alguna de las bases ya no existe. Recarga la página."] });
  await db.transaction(async (tx) => {
    const current = await tx.select({ kbId: agentKnowledgeBases.knowledgeBaseId }).from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, id));
    const currentIds = new Set(current.map((row) => row.kbId));
    const removed = [...currentIds].filter((kbId) => !wanted.includes(kbId));
    if (removed.length > 0) await tx.delete(agentKnowledgeBases).where(and(eq(agentKnowledgeBases.agentId, id), inArray(agentKnowledgeBases.knowledgeBaseId, removed)));
    const added = wanted.filter((kbId) => !currentIds.has(kbId));
    if (added.length > 0) await tx.insert(agentKnowledgeBases).values(added.map((kbId) => ({ agentId: id, knowledgeBaseId: kbId })));
    await writeAudit({ actor, action: "agent.knowledge_bases_changed", targetType: "agent", targetId: id, metadata: { added: added.length, removed: removed.length } }, tx);
  });
}
