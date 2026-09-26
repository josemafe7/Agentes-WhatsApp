"use server";
// Server Actions of Agentes and «Nuevo agente» ([AGE-02], [AGE-05], [AGE-13]). Thin: session and permission here,
// then src/data/agents.ts, which checks the permission again and validates every field ([SEG-04], [SEG-05]).
// «Generar borrador con IA» spends AI: limited per person ([SEG-07]) and never saved until the person saves.
import { revalidatePath } from "next/cache";
import { createAgent, createAgentFromTemplate, deleteAgent, duplicateAgent, getAgent } from "@/data/agents";
import { getBusinessProfile } from "@/data/settings";
import type { AgentInstructions } from "@/db/schema";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { generateAgentDraft } from "@/server/ai/draft";
import { enforceAiRateLimit } from "@/server/ai/limits";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { agentIdRequestSchema, deleteAgentRequestSchema, draftRequestSchema, newAgentRequestSchema } from "./_lib/requests";

const AGENTS_PATH = "/agentes";
const NOT_FOUND = "No se ha encontrado el agente.";

/** Creates the agent and returns its id; the form then opens the editor ([AGE-02]). */
export async function createAgentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = newAgentRequestSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error, "Elige cómo quieres crear el agente.");
    const request = parsed.data;
    // Only what the person sent overrides the template (an absent name keeps the template's).
    const overrides: Record<string, unknown> = {};
    if (request.name !== undefined) overrides.name = request.name;
    if (request.source === "draft") {
      overrides.instructions = request.instructions;
      if (request.tone !== undefined) overrides.tone = request.tone;
    }
    const agent =
      request.source === "blank" ? await createAgent(actor, overrides) : await createAgentFromTemplate(actor, request.sector, overrides);
    revalidatePath(AGENTS_PATH);
    return ok({ id: agent.id }, "Agente creado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Duplicar»: a copy with its configuration, context files and knowledge bases. */
export async function duplicateAgentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = agentIdRequestSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    const copy = await duplicateAgent(actor, parsed.data.agentId);
    revalidatePath(AGENTS_PATH);
    return ok({ id: copy.id }, `Agente duplicado: «${copy.name}».`);
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * «Borrar»: while the agent is active in a channel it is refused with the channels' names unless the person
 * confirmed that they stay without an agent ([AGE-13]).
 */
export async function deleteAgentAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = deleteAgentRequestSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    await deleteAgent(actor, parsed.data.agentId, { confirmActiveChannels: parsed.data.confirmActiveChannels === true });
    revalidatePath(AGENTS_PATH);
    return ok(undefined, "Agente borrado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** The draft shown in the form, to review before saving ([AGE-04], [AGE-05]). FAQs arrive with Conocimiento. */
export type AgentDraftView = { name: string; tone: string; instructions: AgentInstructions };

/** Name the draft generator needs when the business has not written its own yet. */
const UNNAMED_BUSINESS = "El negocio";

/**
 * «Generar borrador con IA» from the business web or a description ([AGE-05], [ASI-08]). Nothing is saved: the
 * form shows the draft and the person decides. Without a key, or when the web cannot be read, it says so.
 */
export async function generateAgentDraftAction(input: unknown): Promise<ActionResult<AgentDraftView>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = draftRequestSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await enforceAiRateLimit("generate", actor.userId);
    const request = parsed.data;
    // The cost is linked to the agent being edited: it must exist (ai_runs references it).
    const agentId = request.agentId ? (await getAgent(actor, request.agentId)).id : null;
    const profile = await getBusinessProfile(actor);
    const draft = await generateAgentDraft({
      source: request.source === "url" ? { url: request.url } : { description: request.description },
      sector: profile.sector,
      business: { name: profile.name.trim() || UNNAMED_BUSINESS, terminology: profile.terminology },
      agentId,
    });
    return ok({ name: draft.name, tone: draft.tone, instructions: draft.instructions }, "Borrador listo. Revísalo y, si te sirve, guárdalo.");
  } catch (error) {
    // No key, a web that cannot be read or a failed generation come with their Spanish message (src/server/ai/draft.ts).
    return toActionFailure(error);
  }
}
