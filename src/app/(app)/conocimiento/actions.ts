"use server";
// Server Actions of the knowledge bases ([CON-03], [CON-11], [CON-13], [CON-15]). Thin: session and permission here,
// then src/data/knowledge.ts, which checks the permission again and validates with Zod ([SEG-04], [SEG-05]).
// Documents, FAQs and «Probar búsqueda» are in ./[id]/actions.ts; file uploads go through their own route
// (./_lib/upload.ts).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { changeKnowledgeBaseModel, createKnowledgeBase, deleteKnowledgeBase, getKnowledgeBase, reindexKnowledgeBase, updateKnowledgeBase } from "@/data/knowledge";
import { isAiConfigured } from "@/data/settings";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { isZdrEnabled } from "@/server/ai/openrouter";
import { parseInput, toActionFailure, ValidationError } from "@/server/errors";
import { requirePermission } from "@/server/session";
// The same real check of a new embeddings model as Ajustes › IA (1536 numbers, limited per person).
import { embeddingModelProblem } from "@/app/(app)/ajustes/ia/_lib/models";
import { KNOWLEDGE_PATH } from "./_lib/paths";
import { enforceKnowledgeReprocessLimit, startKnowledgeWork } from "./_lib/work";

/** Every page of Conocimiento shows counts and states: all of them are refreshed after a change. */
function revalidateKnowledge(): void {
  revalidatePath(KNOWLEDGE_PATH, "layout");
}

/** «Nueva base»: name and description; it takes the default embeddings model of Ajustes › IA. */
export async function createKnowledgeBaseAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    const base = await createKnowledgeBase(actor, input);
    revalidateKnowledge();
    return ok({ id: base.id }, "Base creada.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateKnowledgeBaseAction(kbId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await updateKnowledgeBase(actor, kbId, input);
    revalidateKnowledge();
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Reindexar» ([CON-13]): a new index is built in the background; searches use the current one until it is done. */
export async function reindexKnowledgeBaseAction(kbId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await enforceKnowledgeReprocessLimit(actor.userId);
    await reindexKnowledgeBase(actor, kbId);
    startKnowledgeWork();
    revalidateKnowledge();
    return ok(undefined, "Reindexando. Mientras tanto se sigue buscando en el índice anterior.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const modelInputSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1, "Elige un modelo de embeddings.")
      .max(200)
      .regex(/^[a-z0-9._~-]+\/[a-z0-9._:~-]+$/i, "Elige un modelo de embeddings de la lista."),
  })
  .strict();

/**
 * Another embeddings model for this base ([CON-11], [CON-13], [AJU-05]). It is tried for real first: it must give
 * 1536 numbers, which needs the OpenRouter key. Then the base is re-processed with it and switches (model included)
 * only when the new index is complete.
 */
export async function changeKnowledgeBaseModelAction(kbId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    const base = await getKnowledgeBase(actor, kbId);
    const { model } = parseInput(modelInputSchema, input);
    if (model === base.embeddingModel) {
      throw new ValidationError(undefined, { model: ["La base ya usa este modelo. Para volver a procesarla, usa «Reindexar»."] });
    }
    if (!(await isAiConfigured())) {
      throw new ValidationError(undefined, { model: ["Sin clave de OpenRouter no se puede probar el modelo. Añádela en Ajustes › IA."] });
    }
    const problem = await embeddingModelProblem(actor, model, { zdr: await isZdrEnabled() });
    if (problem) throw new ValidationError(undefined, { model: [problem] });
    await changeKnowledgeBaseModel(actor, base.id, { model });
    startKnowledgeWork();
    revalidateKnowledge();
    return ok(undefined, "Modelo cambiado. La base se va a volver a procesar con él; mientras, se sigue buscando con el anterior.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Deletes a base after typing its name: its documents, chunks, files and links to agents ([CON-15]). */
export async function deleteKnowledgeBaseAction(kbId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.knowledge.manage);
    await deleteKnowledgeBase(actor, kbId, input);
    revalidateKnowledge();
    return ok(undefined, "Base borrada.");
  } catch (error) {
    return toActionFailure(error);
  }
}
