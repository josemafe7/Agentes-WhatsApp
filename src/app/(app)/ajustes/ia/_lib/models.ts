// Checks and warnings of the default models of Ajustes › IA ([AJU-04], [AJU-05], [MOD-02], [MOD-05], [MOD-06]).
import "server-only";
import { modelKindProblem } from "@/components/model-picker/catalog";
import type { ModelPickerKind } from "@/components/model-picker/types";
import { listAgents } from "@/data/agents";
import { createOpenRouterClient, type OpenRouterClient } from "@/lib/openrouter/client";
import type { Actor } from "@/lib/permissions";
import { AiNotConfiguredError } from "@/server/ai/errors";
import { enforceAiRateLimit } from "@/server/ai/limits";
import { getCachedModelCatalog, modelWarnings, validateModelChoice, verifyEmbeddingModel, type ModelInfo } from "@/server/ai/models";
import { getOpenRouterClient } from "@/server/ai/openrouter";
import { getAppUrl } from "@/server/app-url";
import { DEFAULT_MODEL_FIELDS, DEFAULT_MODEL_LABELS, type AiModels } from "./form";

/** The defaults that are not chat models, and the picker list each one must belong to. */
const KIND_OF_FIELD = { transcription: "transcription", embeddings: "embedding", imageDescription: "vision" } as const satisfies Partial<
  Record<keyof AiModels, ModelPickerKind>
>;

/**
 * Field errors of the chosen defaults, or null. Chat and fallback of different providers always ([MOD-05]); with a
 * saved model list, a newly chosen model must exist and fit its use ([MOD-02]). Models already saved are only
 * flagged, so a retiring one does not block other changes ([MOD-06]).
 */
export function defaultModelProblems(
  next: AiModels,
  current: AiModels,
  catalog: readonly ModelInfo[] | null,
  timeZone: string,
): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {};
  const changed = (field: keyof AiModels) => next[field] !== current[field];
  const choice = validateModelChoice(next.chat, next.fallback, catalog, {
    checkCatalog: { model: changed("chat"), fallbackModel: changed("fallback") },
    timeZone,
  });
  if (choice?.model) errors.chat = choice.model;
  if (choice?.fallbackModel) errors.fallback = choice.fallbackModel;
  if (catalog) {
    for (const [field, kind] of Object.entries(KIND_OF_FIELD) as [keyof typeof KIND_OF_FIELD, ModelPickerKind][]) {
      const problem = changed(field) ? modelKindProblem(kind, next[field], catalog, timeZone) : null;
      if (problem) errors[field] = [problem];
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * A new embeddings model is tried for real before saving: it must give 1536 numbers (decision 0013). Uses the key
 * being typed, or the one in use; without a key it cannot be tried and the search stays text-only anyway ([ARR-14]).
 * It spends a fraction of a cent, so it counts against the person's AI limit ([SEG-07]).
 */
export async function embeddingModelProblem(actor: Actor, modelId: string, options: { zdr: boolean; typedKey?: string }): Promise<string | null> {
  let client: OpenRouterClient;
  if (options.typedKey) {
    client = createOpenRouterClient({ apiKey: options.typedKey, appUrl: getAppUrl() });
  } else {
    try {
      client = await getOpenRouterClient();
    } catch (error) {
      if (error instanceof AiNotConfiguredError) return null;
      throw error;
    }
  }
  await enforceAiRateLimit("models", actor.userId);
  return verifyEmbeddingModel(client, modelId, { zdr: options.zdr });
}

export type ModelUseWarning = {
  modelId: string;
  kind: "expiring" | "missing";
  message: string;
  /** Agents with it as principal or fallback model. */
  agents: { id: string; name: string }[];
  /** Defaults of this page that use it («Chat por defecto»…). */
  defaults: string[];
};

/**
 * Models in use (defaults and agents) that announce a retirement date or left the saved model list ([MOD-06]). Uses
 * the list the pickers leave in the cache: no call to OpenRouter. Owner and admin (agents.view checked by listAgents).
 */
export async function loadModelUseWarnings(actor: Actor, defaults: AiModels, timeZone: string): Promise<ModelUseWarning[]> {
  const catalog = await getCachedModelCatalog();
  if (!catalog) return [];
  const agentList = await listAgents(actor);
  const inUse = [
    ...DEFAULT_MODEL_FIELDS.map((field) => defaults[field]),
    ...agentList.flatMap((agent) => [agent.model, agent.fallbackModel]).filter((id): id is string => Boolean(id)),
  ];
  return modelWarnings(catalog.models, inUse, timeZone).map(({ modelId, kind, message }) => ({
    modelId,
    kind,
    message,
    agents: agentList.filter((agent) => agent.model === modelId || agent.fallbackModel === modelId).map(({ id, name }) => ({ id, name })),
    defaults: DEFAULT_MODEL_FIELDS.filter((field) => defaults[field] === modelId).map((field) => DEFAULT_MODEL_LABELS[field]),
  }));
}
