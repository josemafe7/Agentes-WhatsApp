"use server";
// Server Actions of one knowledge base: web pages, FAQs, retry/refresh/delete of documents and «Probar búsqueda»
// ([CON-04], [CON-05], [CON-09], [CON-15], [CON-21]). Thin: session and permission here, then src/data, which checks
// the permission again and validates with Zod ([SEG-04], [SEG-05]). Files are uploaded through their own route
// (../_lib/upload.ts). Adding content queues work that starts right after answering.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addKnowledgeFaq,
  addKnowledgeUrl,
  deleteKnowledgeDocument,
  knowledgeRefreshInputSchema,
  knowledgeTitleInputSchema,
  renameKnowledgeDocument,
  reprocessKnowledgeDocument,
  setKnowledgeDocumentRefresh,
  updateKnowledgeFaq,
} from "@/data/knowledge-documents";
import { testKnowledgeSearch } from "@/data/knowledge-search";
import { fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { parseInput, toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { KNOWLEDGE_PATH } from "../_lib/paths";
import type { KnowledgeSearchView } from "../_lib/search-view";
import { enforceKnowledgeAddLimit, enforceKnowledgeReprocessLimit, startKnowledgeWork } from "../_lib/work";

function revalidateKnowledge(): void {
  revalidatePath(KNOWLEDGE_PATH, "layout");
}

/** «Añadir contenido › Página web» ([CON-04], [CON-09]): the page, and with «mapa del sitio» its pages too. */
export async function addKnowledgeUrlAction(kbId: unknown, input: unknown): Promise<ActionResult<{ id: string | null; sitemapQueued: boolean }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await enforceKnowledgeAddLimit(actor.userId);
    const result = await addKnowledgeUrl(actor, kbId, input);
    startKnowledgeWork();
    revalidateKnowledge();
    const message = result.sitemapQueued
      ? result.id
        ? "Página añadida. Las del mapa del sitio se añadirán en segundo plano."
        : "Las páginas del mapa del sitio se añadirán en segundo plano."
      : "Página añadida. Se está leyendo.";
    return ok(result, message);
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Añadir contenido › Pregunta frecuente» and the FAQ editor ([CON-04]). */
export async function addKnowledgeFaqAction(kbId: unknown, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await enforceKnowledgeAddLimit(actor.userId);
    const faq = await addKnowledgeFaq(actor, kbId, input);
    startKnowledgeWork();
    revalidateKnowledge();
    return ok({ id: faq.id }, "Pregunta añadida.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Saves an edited FAQ: it is processed again and its old fragments are replaced when the new ones are ready. */
export async function updateKnowledgeFaqAction(documentId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await enforceKnowledgeReprocessLimit(actor.userId);
    await updateKnowledgeFaq(actor, documentId, input);
    startKnowledgeWork();
    revalidateKnowledge();
    return ok(undefined, "Pregunta guardada.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * «Cambiar título» of a file, web page or text ([CON-10]): its fragments carry the title («Documento: título >
 * sección»), so they are processed again with it, which costs AI like editing a FAQ (same limit per person).
 */
export async function renameKnowledgeDocumentAction(documentId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    const parsed = knowledgeTitleInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await enforceKnowledgeReprocessLimit(actor.userId);
    const { changed } = await renameKnowledgeDocument(actor, documentId, parsed.data);
    if (!changed) return ok(undefined, "El título no ha cambiado.");
    startKnowledgeWork();
    revalidateKnowledge();
    return ok(undefined, "Título guardado. Los fragmentos se actualizan en segundo plano.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Reintentar» (error), «Reprocesar» (file) and «Refrescar» (web page) ([CON-05], [CON-09]). */
export async function reprocessKnowledgeDocumentAction(documentId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await enforceKnowledgeReprocessLimit(actor.userId);
    await reprocessKnowledgeDocument(actor, documentId);
    startKnowledgeWork();
    revalidateKnowledge();
    return ok(undefined, "Se está procesando de nuevo.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Periodic refresh of a web page on or off, and how often ([CON-09]). */
export async function setKnowledgeDocumentRefreshAction(documentId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    const data = parseInput(knowledgeRefreshInputSchema, input);
    await setKnowledgeDocumentRefresh(actor, documentId, data);
    revalidateKnowledge();
    return ok(undefined, data.enabled ? "Refresco activado." : "Refresco desactivado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Deletes a document with its fragments and its file ([CON-15]). */
export async function deleteKnowledgeDocumentAction(documentId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await deleteKnowledgeDocument(actor, documentId);
    revalidateKnowledge();
    return ok(undefined, "Documento borrado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const searchInputSchema = z.object({ query: z.string() }).strict();

/**
 * «Probar búsqueda» ([CON-21]): the same search the agents use, over this base only and without the chat model.
 * Returns the fragments with their scores and source; never the embeddings nor the ids of the index.
 */
export async function testKnowledgeSearchAction(kbId: unknown, input: unknown): Promise<ActionResult<KnowledgeSearchView>> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.testSearch);
    const { query } = parseInput(searchInputSchema, input);
    const search = await testKnowledgeSearch(actor, { kbIds: [kbId], query });
    return ok({
      status: search.status,
      mode: search.mode,
      reranked: search.reranked,
      results: search.results.map(({ rank, documentId, title, section, page, content, score, vectorScore, textRank }) => ({
        rank,
        documentId,
        title,
        section,
        page,
        content,
        score,
        vectorScore,
        textRank,
      })),
    });
  } catch (error) {
    return toActionFailure(error);
  }
}
