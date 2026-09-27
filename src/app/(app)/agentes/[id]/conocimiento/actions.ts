"use server";
// Server Actions of the agent's Conocimiento tab ([AGE-07], [CON-01]–[CON-03]). Thin: session and permission
// here, then src/data, which checks the permission again and validates every field with Zod ([SEG-04], [SEG-05]).
// The search mode is saved with the rest of the agent (saveAgentAction, a new version).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addKnowledgeText } from "@/data/knowledge-documents";
import { createKnowledgeBase, listAgentKnowledgeBases, setAgentKnowledgeBases } from "@/data/knowledge";
import {
  createAgentContextFileFromText,
  createAgentContextFileFromUpload,
  deleteAgentContextFile,
  getAgentContextFile,
  updateAgentContextFile,
  type ContextFileDetail,
} from "@/data/knowledge-context-files";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { AuthError, NotFoundError, toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { uploadProblem } from "./_lib/view";

const AGENT_NOT_FOUND = "No se ha encontrado el agente.";
const FILE_NOT_FOUND = "No se ha encontrado el archivo de contexto.";
const BASE_NOT_FOUND = "No se ha encontrado la base de conocimiento.";
const INVALID = "Revisa los campos marcados.";

/** Every tab of the editor (the prompt preview includes the context files) and the knowledge area. */
function revalidateKnowledge(): void {
  revalidatePath("/agentes/[id]", "layout");
  revalidatePath("/conocimiento", "layout");
}

/** The file, only through the agent it belongs to: another agent's file is «not found» ([SEG-04]). */
async function contextFileOfAgent(actor: Actor, agentId: string, fileId: string): Promise<ContextFileDetail> {
  const file = await getAgentContextFile(actor, fileId);
  if (file.agentId !== agentId) throw new NotFoundError(FILE_NOT_FOUND);
  return file;
}

const fileRefSchema = z.object({ agentId: idSchema, fileId: idSchema }).strict();

// ─── Context files ([CON-01], [CON-02]) ─────────────────────────────────────────────────────────────────

export type ContextFileView = { id: string; title: string; contentMd: string; tokenCount: number };

/** «Ver» / «Editar»: the Markdown of one file, for who may see agents (supervisor and viewer read it). */
export async function getContextFileAction(input: unknown): Promise<ActionResult<ContextFileView>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.view);
    const parsed = fileRefSchema.safeParse(input);
    if (!parsed.success) return fail(FILE_NOT_FOUND);
    const file = await contextFileOfAgent(actor, parsed.data.agentId, parsed.data.fileId);
    return ok({ id: file.id, title: file.title, contentMd: file.contentMd, tokenCount: file.tokenCount });
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Pegar texto»: pasted text becomes a context file; above the 30,000-token cap nothing is saved. */
export async function createContextFileAction(agentId: unknown, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const id = idSchema.safeParse(agentId);
    if (!id.success) return fail(AGENT_NOT_FOUND);
    const created = await createAgentContextFileFromText(actor, id.data, input);
    revalidateKnowledge();
    return ok({ id: created.id }, "Archivo de contexto añadido.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * «Subir archivo»: a PDF, DOCX, TXT or MD becomes editable Markdown ([CON-01]). The permission is checked before
 * the file is read; its bytes decide the type (the browser's name and type are not trusted, [SEG-13]).
 */
export async function uploadContextFileAction(agentId: unknown, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const id = idSchema.safeParse(agentId);
    if (!id.success) return fail(AGENT_NOT_FOUND);
    const file = formData.get("file");
    if (!(file instanceof File)) return fail(INVALID, { file: ["Elige un archivo."] });
    const problem = uploadProblem(file);
    if (problem) return fail(problem, { file: [problem] });
    const created = await createAgentContextFileFromUpload(actor, id.data, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    revalidateKnowledge();
    return ok({ id: created.id }, "Archivo añadido como texto editable. Revísalo con «Editar».");
  } catch (error) {
    return toActionFailure(error);
  }
}

const updateSchema = fileRefSchema.extend({ title: z.unknown().optional(), contentMd: z.unknown().optional() }).strict();

/** «Editar»: title and Markdown; the tokens are counted again and the cap checked ([CON-02]). */
export async function updateContextFileAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return fail(FILE_NOT_FOUND);
    const { agentId, fileId, title, contentMd } = parsed.data;
    await contextFileOfAgent(actor, agentId, fileId);
    await updateAgentContextFile(actor, fileId, { ...(title !== undefined ? { title } : {}), ...(contentMd !== undefined ? { contentMd } : {}) });
    revalidateKnowledge();
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteContextFileAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = fileRefSchema.safeParse(input);
    if (!parsed.success) return fail(FILE_NOT_FOUND);
    const file = await contextFileOfAgent(actor, parsed.data.agentId, parsed.data.fileId);
    await deleteAgentContextFile(actor, file.id);
    revalidateKnowledge();
    return ok(undefined, "Archivo de contexto borrado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const moveSchema = fileRefSchema
  .extend({
    /** An existing base… */
    kbId: idSchema.optional(),
    /** …or a new one with this name (validated by createKnowledgeBase). */
    newBaseName: z.string().max(1_000).optional(),
  })
  .strict();

/**
 * «Pasar a una base de conocimiento» ([CON-02]): the text becomes a document of the base (processed in the
 * background), the agent starts using that base and the context file goes. In that order, so a failure never
 * loses the text. Needs both editing agents and editing knowledge.
 */
export async function moveContextFileToBaseAction(input: unknown): Promise<ActionResult<{ kbId: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    if (!can(actor, PERMISSIONS.knowledge.manage)) throw new AuthError("forbidden");
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { agentId, fileId, kbId: chosenId, newBaseName } = parsed.data;
    if (!chosenId && newBaseName === undefined) return fail(INVALID, { kbId: ["Elige una base."] });
    const file = await contextFileOfAgent(actor, agentId, fileId);

    let base: { id: string; name: string };
    if (chosenId) {
      const found = (await listAgentKnowledgeBases(actor, agentId)).available.find((candidate) => candidate.id === chosenId);
      if (!found) return fail(BASE_NOT_FOUND, { kbId: [BASE_NOT_FOUND] });
      base = found;
    } else {
      const name = newBaseName ?? "";
      base = { id: (await createKnowledgeBase(actor, { name })).id, name: name.trim() };
    }

    await addKnowledgeText(actor, base.id, { title: file.title, text: file.contentMd });
    const { selected } = await listAgentKnowledgeBases(actor, agentId);
    if (!selected.some((candidate) => candidate.id === base.id)) {
      await setAgentKnowledgeBases(actor, agentId, { kbIds: [...selected.map((candidate) => candidate.id), base.id] });
    }
    await deleteAgentContextFile(actor, file.id);
    revalidateKnowledge();
    return ok({ kbId: base.id }, `«${file.title}» está ahora en la base «${base.name}».`);
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Knowledge bases of the agent ([AGE-07], [CON-03]) ──────────────────────────────────────────────────

const attachSchema = z.object({ agentId: idSchema, kbId: idSchema, attached: z.boolean() }).strict();

/** The switch of one base: the agent searches only in the bases switched on here. */
export async function setAgentKnowledgeBaseAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = attachSchema.safeParse(input);
    if (!parsed.success) return fail(BASE_NOT_FOUND);
    const { agentId, kbId, attached } = parsed.data;
    const { selected, available } = await listAgentKnowledgeBases(actor, agentId);
    const base = available.find((candidate) => candidate.id === kbId);
    if (!base) return fail(BASE_NOT_FOUND);
    const current = selected.map((candidate) => candidate.id);
    const next = attached ? [...new Set([...current, kbId])] : current.filter((id) => id !== kbId);
    await setAgentKnowledgeBases(actor, agentId, { kbIds: next });
    revalidateKnowledge();
    return ok(undefined, attached ? `Este agente ya busca en «${base.name}».` : `Este agente ya no busca en «${base.name}».`);
  } catch (error) {
    return toActionFailure(error);
  }
}
