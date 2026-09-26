"use server";
// Server Actions of the agent editor ([AGE-03]–[AGE-12], [MOD-05]–[MOD-07]). Thin: session and permission here, then
// src/data, which checks the permission again and validates every field with Zod ([SEG-04], [SEG-05]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setAgentChannelActive } from "@/data/agent-channels";
import { getAgent, removeAgentAvatar, restoreAgentVersion, saveAgentAvatar, updateAgent } from "@/data/agents";
import { MAX_LOGO_BYTES } from "@/data/business";
import type { AgentInstructions } from "@/db/schema";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { agentUpdateSchema } from "@/lib/agent-input";
import { ALWAYS_ENABLED_TOOLS } from "@/lib/agent-tools";
import { isOpenRouterError } from "@/lib/openrouter/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { loadAgentContextFiles, loadPromptBusinessData } from "@/server/ai/context";
import { findModel, getCachedModelCatalog, getModelCatalog, type ModelCatalog } from "@/server/ai/models";
import { buildPrompt, SIMULATED_CHANNELS, type PromptSection } from "@/server/ai/prompt";
import { AppError, toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import type { ModelSettingsSupport } from "./_lib/model-support";

const NOT_FOUND = "No se ha encontrado el agente.";
const SAVED = "Cambios guardados.";

/** The list (name, model, channels) and every tab of the editor, «Probar» included, show what changed. */
function revalidateAgent(): void {
  revalidatePath("/agentes");
  revalidatePath("/agentes/[id]", "layout");
}

/** The hand-off is always on ([ALWAYS_ENABLED_TOOLS]): whatever the form sends, it stays in the saved list. */
function withAlwaysEnabledTools(input: unknown): unknown {
  if (typeof input !== "object" || input === null || !("systemTools" in input) || !Array.isArray(input.systemTools)) return input;
  return { ...input, systemTools: [...input.systemTools, ...ALWAYS_ENABLED_TOOLS] };
}

/** Saves the fields of one tab as a new version ([AGE-12]); errors come back per field ([AGE-15]). */
export async function saveAgentAction(agentId: unknown, input: unknown): Promise<ActionResult<{ version: number }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const id = idSchema.safeParse(agentId);
    if (!id.success) return fail(NOT_FOUND);
    const agent = await updateAgent(actor, id.data, withAlwaysEnabledTools(input));
    revalidateAgent();
    return ok({ version: agent.currentVersion }, SAVED);
  } catch (error) {
    return toActionFailure(error);
  }
}

const avatarSchema = z
  .instanceof(File, { error: "Elige una imagen." })
  .refine((file) => file.size > 0, "Elige una imagen.")
  .refine((file) => file.size <= MAX_LOGO_BYTES, "La imagen puede ocupar como mucho 512 KB.");

/** New avatar: its bytes decide the type (src/data/agents.ts); the file name is never used ([SEG-13]). */
export async function uploadAgentAvatarAction(agentId: unknown, _previous: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const id = idSchema.safeParse(agentId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = avatarSchema.safeParse(formData.get("avatar"));
    if (!parsed.success) return fail("Revisa los campos marcados.", { avatar: [parsed.error.issues[0]?.message ?? "Elige una imagen."] });
    await saveAgentAvatar(actor, id.data, { bytes: new Uint8Array(await parsed.data.arrayBuffer()) });
    revalidateAgent();
    return ok(undefined, "Avatar actualizado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeAgentAvatarAction(agentId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const id = idSchema.safeParse(agentId);
    if (!id.success) return fail(NOT_FOUND);
    await removeAgentAvatar(actor, id.data);
    revalidateAgent();
    return ok(undefined, "Avatar quitado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

const restoreSchema = z.object({ agentId: idSchema, version: z.number().int().min(1) }).strict();

/** «Restaurar»: the old configuration becomes a new version; nothing of the history is lost ([AGE-12]). */
export async function restoreAgentVersionAction(input: unknown): Promise<ActionResult<{ version: number }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.manage);
    const parsed = restoreSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado esa versión.");
    const agent = await restoreAgentVersion(actor, parsed.data.agentId, parsed.data.version);
    revalidateAgent();
    return ok({ version: agent.currentVersion }, `Versión ${parsed.data.version} restaurada como versión ${agent.currentVersion}.`);
  } catch (error) {
    return toActionFailure(error);
  }
}

const channelActiveSchema = z
  .object({ agentId: idSchema, channelId: idSchema, active: z.boolean(), confirmReplace: z.boolean().optional() })
  .strict();

/**
 * «Activo aquí» ([AGE-10], [AGE-11]). Replacing another agent is refused with its name until the person confirms
 * («Sustituirá a …»). Owner and admin only: it is a channel setting ([PER-04]).
 */
export async function setAgentChannelActiveAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const parsed = channelActiveSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado el canal.");
    const agent = await getAgent(actor, parsed.data.agentId);
    const { replacedAgentName } = await setAgentChannelActive(actor, parsed.data);
    revalidateAgent();
    revalidatePath("/canales");
    if (!parsed.data.active) return ok(undefined, "Este agente ya no responde en este canal.");
    return ok(
      undefined,
      replacedAgentName ? `Ahora responde «${agent.name}» en este canal, en lugar de «${replacedAgentName}».` : `Ahora responde «${agent.name}» en este canal.`,
    );
  } catch (error) {
    return toActionFailure(error);
  }
}

const previewSchema = z
  .object({
    agentId: idSchema,
    channel: z.enum(SIMULATED_CHANNELS).default("whatsapp"),
    /** Unsaved values of the form, so the preview shows what would be sent after saving. */
    draft: agentUpdateSchema.pick({ name: true, language: true, tone: true, instructions: true }).optional(),
  })
  .strict();

function cleanInstructions(value: Record<string, string | null | undefined>): AgentInstructions {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
}

/**
 * «Vista previa del prompt» ([AGE-06]): the whole text the model receives, in the order of [MOT-07], with the
 * platform rules first ([MOT-06]). Read-only and without AI: nothing is sent to OpenRouter.
 */
export async function previewAgentPromptAction(input: unknown): Promise<ActionResult<{ sections: PromptSection[] }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.view);
    const parsed = previewSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { agentId, channel, draft } = parsed.data;
    const agent = await getAgent(actor, agentId);
    const [business, contextFiles] = await Promise.all([loadPromptBusinessData(), loadAgentContextFiles(agent.id)]);
    const built = buildPrompt({
      business: business.business,
      hours: business.hours,
      closures: business.closures,
      services: business.services,
      agent: {
        name: draft?.name ?? agent.name,
        language: draft?.language ?? agent.language,
        tone: draft?.tone !== undefined ? draft.tone : agent.tone,
        instructions: draft?.instructions ? cleanInstructions(draft.instructions) : agent.instructions,
      },
      contextFiles,
      channel: { kind: channel },
      contact: null,
      summary: null,
      history: [],
      now: new Date(),
      timezone: business.timezone,
      aiDisclosureText: business.aiDisclosureText,
    });
    return ok({ sections: built.sections });
  } catch (error) {
    return toActionFailure(error);
  }
}

const modelSupportSchema = z.object({ modelId: z.string().trim().min(1).max(200) }).strict();

/** The 12 h list (asked again only when older, [MOD-01]); without a key or if OpenRouter fails, whatever is cached. */
async function catalogForSupport(): Promise<ModelCatalog | null> {
  try {
    return await getModelCatalog();
  } catch (error) {
    if (error instanceof AppError || isOpenRouterError(error)) return getCachedModelCatalog();
    throw error;
  }
}

/**
 * Whether the chosen model accepts temperature and which reasoning levels ([MOD-07]); null when it is unknown. Only
 * for who edits agents: it may ask OpenRouter with the business key ([PER-03]).
 */
export async function getModelSupportAction(input: unknown): Promise<ActionResult<ModelSettingsSupport | null>> {
  try {
    await requirePermission(PERMISSIONS.agents.manage);
    const parsed = modelSupportSchema.safeParse(input);
    if (!parsed.success) return ok(null);
    const model = findModel((await catalogForSupport())?.models, parsed.data.modelId);
    return ok(
      model
        ? {
            supportsTemperature: model.supportsTemperature,
            supportedEfforts: model.supportedEfforts,
            reasoningMandatory: model.reasoningMandatory,
            maxCompletionTokens: model.maxCompletionTokens,
          }
        : null,
    );
  } catch (error) {
    return toActionFailure(error);
  }
}
