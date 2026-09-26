// Server side of the model picker: turns the catalogue of src/server/ai/models.ts into the options of each kind
// ([MOD-01]–[MOD-04], [MOD-08]). Who may do what is decided here and checked again by the Server Actions.
import "server-only";
import { getBusinessProfile, isAiConfigured, loadIntegrationSettings } from "@/data/settings";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/format";
import { RECOMMENDED_CHAT_MODELS } from "@/lib/openrouter/default-models";
import { isOpenRouterError } from "@/lib/openrouter/errors";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { AiNotConfiguredError } from "@/server/ai/errors";
import type { OpenRouterDeps } from "@/server/ai/openrouter";
import {
  chatModels,
  embeddingModels,
  findModel,
  getCachedModelCatalog,
  getModelCatalog,
  modelExclusion,
  transcriptionModels,
  visionModels,
  type ModelCatalog,
  type ModelInfo,
} from "@/server/ai/models";
import { shortModelName } from "./format";
import type { ModelOption, ModelOptionsResult, ModelPickerKind } from "./types";

const PER_MILLION = 1_000_000;
const LOAD_FAILED = "No se ha podido cargar la lista de modelos de OpenRouter. Inténtalo de nuevo en un momento.";

/** Anyone who sees agents or the AI settings may see the list (read-only editors show the chosen model too). */
export function canViewModels(actor: Actor): boolean {
  return can(actor, PERMISSIONS.agents.view) || can(actor, PERMISSIONS.settings.integrations);
}

/** «Actualizar lista» calls OpenRouter with the business key: only those who choose models ([PER-04]). */
export function canRefreshModels(actor: Actor): boolean {
  return can(actor, PERMISSIONS.agents.manage) || can(actor, PERMISSIONS.settings.integrations);
}

/** Ajustes › IA «Modelos recomendados», or the documented ones until it is edited ([MOD-04]). */
export function recommendedModelIds(stored: readonly string[]): string[] {
  return stored.length > 0 ? [...stored] : [...RECOMMENDED_CHAT_MODELS];
}

const KIND_LISTS: Record<ModelPickerKind, (models: readonly ModelInfo[]) => ModelInfo[]> = {
  chat: chatModels,
  transcription: transcriptionModels,
  embedding: embeddingModels,
  vision: visionModels,
};

/**
 * The models of `candidates` that would be of `kind` once `relax` lifts the flag that keeps them out. Reuses the
 * kind rules of models.ts (tools, modalities) instead of writing them twice.
 */
function sameKind(kind: ModelPickerKind, candidates: readonly ModelInfo[], relax: (model: ModelInfo) => ModelInfo): ModelInfo[] {
  const originals = new Map(candidates.map((model) => [model.id, model]));
  return KIND_LISTS[kind](candidates.map(relax)).flatMap((model) => originals.get(model.id) ?? []);
}

/** Free or zero-price models of a kind, offered only with `allowTestOnly` (never valid for an agent, [MOD-02]). */
function testOnlyModels(kind: ModelPickerKind, models: readonly ModelInfo[]): ModelInfo[] {
  const free = models.filter((model) => modelExclusion(model) === "free" && model.expirationDate === null);
  return sameKind(kind, free, (model) => ({ ...model, testOnly: false }));
}

/** Retiring models of a kind: never offered, but one already in use keeps its details and date ([MOD-06]). */
function retiringModels(kind: ModelPickerKind, models: readonly ModelInfo[]): ModelInfo[] {
  const retiring = models.filter((model) => model.expirationDate !== null && modelExclusion(model) === null);
  return sameKind(kind, retiring, (model) => ({ ...model, expirationDate: null }));
}

/** Models that can be chosen for a kind: the lists of models.ts, plus the test-only ones when asked. */
export function modelsForKind(kind: ModelPickerKind, models: readonly ModelInfo[], options: { allowTestOnly?: boolean } = {}): ModelInfo[] {
  const offered = KIND_LISTS[kind](models);
  if (!options.allowTestOnly) return offered;
  return [...offered, ...testOnlyModels(kind, models)].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function formatExpiration(date: string, timeZone: string): string {
  return formatDateTime(`${date}T12:00:00Z`, timeZone, { preset: "date" });
}

/** What the browser gets of a model ([MOD-03]). Transcription charged by time shows its price per second (§2.4). */
export function toModelOption(model: ModelInfo, kind: ModelPickerKind, timeZone: string = DEFAULT_TIMEZONE): ModelOption {
  const perSecond = kind === "transcription" && model.priceCompletionPerM === 0;
  return {
    id: model.id,
    name: shortModelName(model.name),
    providerName: model.providerName,
    provider: model.provider,
    pricePrompt: perSecond && model.pricePromptPerM !== null ? model.pricePromptPerM / PER_MILLION : model.pricePromptPerM,
    priceCompletion: perSecond ? null : model.priceCompletionPerM,
    priceUnit: perSecond ? "second" : "million",
    contextLength: model.contextLength,
    image: model.inputModalities.includes("image"),
    pdf: model.inputModalities.includes("file"),
    audio: model.inputModalities.includes("audio"),
    testOnly: model.testOnly,
    expiresOn: model.expirationDate ? formatExpiration(model.expirationDate, timeZone) : null,
  };
}

/** Options of a kind for the picker: what can be chosen, then the retiring ones (only shown when in use). */
export function buildModelOptions(
  kind: ModelPickerKind,
  models: readonly ModelInfo[],
  options: { allowTestOnly?: boolean; timeZone?: string } = {},
): ModelOption[] {
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
  return [...modelsForKind(kind, models, options), ...retiringModels(kind, models)].map((model) => toModelOption(model, kind, timeZone));
}

const KIND_MISMATCH: Record<ModelPickerKind, string> = {
  chat: "Este modelo no sirve para responder con herramientas: elige otro de la lista.",
  transcription: "Este modelo no sirve para transcribir audios: elige otro de la lista.",
  embedding: "Este modelo no sirve para embeddings: elige otro de la lista.",
  vision: "Este modelo no puede ver imágenes: elige otro de la lista.",
};

/**
 * Why `id` cannot be chosen for `kind` with this catalogue, or null when it can. For agents' chat models use
 * validateModelChoice() of models.ts, which also applies the fallback rule ([MOD-05]).
 */
export function modelKindProblem(kind: ModelPickerKind, id: string, models: readonly ModelInfo[], timeZone: string = DEFAULT_TIMEZONE): string | null {
  if (modelsForKind(kind, models).some((model) => model.id === id)) return null;
  const model = findModel(models, id);
  if (!model) return "Este modelo no está en la lista de OpenRouter de tu cuenta. Elige otro o pulsa «Actualizar lista».";
  if (model.expirationDate) return `Este modelo se retira a partir del ${formatExpiration(model.expirationDate, timeZone)}: elige otro.`;
  if (modelExclusion(model)) return "Los modelos gratuitos, de pruebas, por lotes, alias o enrutadores no se pueden usar: elige otro de la lista.";
  return KIND_MISMATCH[kind];
}

export type LoadModelOptionsInput = {
  kind: ModelPickerKind;
  allowTestOnly: boolean;
  refresh: boolean;
  /** Only the saved list, never OpenRouter: for who only looks ([PER-03]). */
  cacheOnly?: boolean;
};

const NOT_LOADED_YET = "La lista de modelos todavía no está cargada. Se carga cuando quien gestiona los agentes elige un modelo.";

/**
 * The picker's list for `actor` (permissions are checked by the caller). Without a key nothing is loaded
 * ([MOD-08]); OpenRouter failures become a generic message (the invalid-key one says what to do).
 */
export async function loadModelOptions(
  actor: Actor,
  input: LoadModelOptionsInput,
  deps: OpenRouterDeps & { now?: Date } = {},
): Promise<ModelOptionsResult> {
  let catalog: ModelCatalog;
  try {
    if (input.cacheOnly) {
      if (!(await isAiConfigured())) throw new AiNotConfiguredError();
      const cached = await getCachedModelCatalog();
      if (!cached) return { status: "error", message: NOT_LOADED_YET };
      catalog = cached;
    } else {
      catalog = await getModelCatalog({ ...deps, refresh: input.refresh });
    }
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return { status: "no_key", canManageKey: can(actor, PERMISSIONS.settings.integrations) };
    if (isOpenRouterError(error)) return { status: "error", message: error.code === "invalid_key" ? error.userMessage : LOAD_FAILED };
    throw error;
  }
  const [{ timezone }, settings] = await Promise.all([getBusinessProfile(actor), loadIntegrationSettings()]);
  return {
    status: "ready",
    options: buildModelOptions(input.kind, catalog.models, { allowTestOnly: input.allowTestOnly, timeZone: timezone }),
    recommended: recommendedModelIds(settings.recommendedModels),
    fetchedAt: catalog.fetchedAt,
    source: catalog.source,
    canRefresh: canRefreshModels(actor),
  };
}
