// Model catalogue ([MOD-01]–[MOD-08], docs/integracion-openrouter.md §2): fetched with the business's key
// (/models/user, falling back to /models), normalized, kept 12 h in app_kv and refreshed on demand and every 12 h in the
// background. The pickers only offer what passes the rules of §2.5; after every download, models already in use that
// expire or disappear are flagged and the team is told once (src/server/ai/model-retirement.ts, [MOD-06]).
import "server-only";
import { recordAiRun } from "@/data/ai-runs";
import type { OpenRouterClient } from "@/lib/openrouter/client";
import { isOpenRouterError, OpenRouterError, type OpenRouterErrorCode } from "@/lib/openrouter/errors";
import { MODEL_ID_HINT, MODEL_ID_PATTERN, providerOf } from "@/lib/openrouter/model-id";
import type { ModelEndpoint, OpenRouterModel } from "@/lib/openrouter/schemas";
import { REASONING_EFFORTS, type ModelSupport, type ReasoningEffort } from "@/lib/openrouter/types";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import { getJobQueue } from "@/server/adapters/job-queue";
import { deleteKv, getKv, setKv } from "@/server/kv";
import { safeErrorMessage } from "@/server/redact";
import { AiNotConfiguredError } from "./errors";
import { formatExpiration, warnAboutModelsInUse } from "./model-retirement";
import { getOpenRouterClient, type OpenRouterDeps } from "./openrouter";

export { modelWarnings, type ModelWarning } from "./model-retirement";

export const MODEL_CATALOG_KV_KEY = "ai.model_catalog";
/** «Se guarda 12 horas» ([MOD-01]). */
export const MODEL_CATALOG_TTL_MS = 12 * 60 * 60 * 1000;
/** After a failed download the list is not asked again for a while; only «Actualizar lista» asks at once. */
export const MODEL_CATALOG_RETRY_KV_KEY = "ai.model_catalog_retry";
export const MODEL_CATALOG_RETRY_AFTER_MS = 5 * 60 * 1000;
/** Recurring job that downloads the list again every 12 h (src/server/jobs/handlers/model-catalog.ts). */
export const MODEL_CATALOG_REFRESH_JOB = "ai.model_catalog_refresh";
/** Bump when ModelInfo changes: an older cached shape is fetched again. */
const CATALOG_FORMAT = 1;
const PER_MILLION = 1_000_000;

export const MODEL_MODALITIES = ["text", "image", "file", "audio", "video"] as const;
export type ModelModality = (typeof MODEL_MODALITIES)[number];

/** One model as the app uses it ([MOD-03]). Prices in USD per million tokens, for display only. */
export type ModelInfo = {
  id: string;
  /** «OpenAI: GPT-5.6 Luna». */
  name: string;
  /** Id prefix («openai»): the fallback must have another one ([MOD-05]). */
  provider: string;
  /** «OpenAI» (from the name), for display. */
  providerName: string;
  /** price × 1e6, USD. Null when OpenRouter gives none. For transcription by duration it is per second (§2.4). */
  pricePromptPerM: number | null;
  priceCompletionPerM: number | null;
  contextLength: number | null;
  /** image = picture, file = PDF, audio (icons of [MOD-03]). */
  inputModalities: ModelModality[];
  outputModalities: string[];
  supportsTools: boolean;
  /** `reasoning.supported_efforts`; null = no reasoning control (nothing is sent). */
  supportedEfforts: ReasoningEffort[] | null;
  reasoningMandatory: boolean;
  supportsTemperature: boolean;
  /** Accepts `dimensions` (embeddings). */
  supportsDimensions: boolean;
  maxCompletionTokens: number | null;
  /** YYYY-MM-DD from which it may be retired, or null. */
  expirationDate: string | null;
  /** Free (`:free`) or zero-price («stealth», openrouter/free): only for trying things, never offered. */
  testOnly: boolean;
};

export type ModelCatalog = {
  format: number;
  fetchedAt: string;
  /** user = filtered by the account's privacy settings; public = the general list (fallback). */
  source: "user" | "public";
  models: ModelInfo[];
};

// ─── Normalization and rules ────────────────────────────────────────────────────────────────────────────

function perMillion(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed * PER_MILLION : null;
}

function isModality(value: string): value is ModelModality {
  return (MODEL_MODALITIES as readonly string[]).includes(value);
}

function isEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function normalizeModel(raw: OpenRouterModel): ModelInfo {
  const name = raw.name?.trim() || raw.id;
  const provider = providerOf(raw.id);
  const parameters = raw.supported_parameters ?? [];
  const prompt = perMillion(raw.pricing?.prompt);
  const completion = perMillion(raw.pricing?.completion);
  const efforts = raw.reasoning?.supported_efforts?.filter(isEffort) ?? [];
  return {
    id: raw.id,
    name,
    provider,
    providerName: name.includes(":") ? name.split(":")[0].trim() : provider,
    pricePromptPerM: prompt,
    priceCompletionPerM: completion,
    contextLength: raw.context_length ?? raw.top_provider?.context_length ?? null,
    inputModalities: (raw.architecture?.input_modalities ?? ["text"]).filter(isModality),
    outputModalities: raw.architecture?.output_modalities ?? ["text"],
    supportsTools: parameters.includes("tools"),
    supportedEfforts: raw.reasoning && efforts.length > 0 ? efforts : null,
    reasoningMandatory: raw.reasoning?.mandatory === true,
    supportsTemperature: parameters.includes("temperature"),
    supportsDimensions: parameters.includes("dimensions"),
    maxCompletionTokens: raw.top_provider?.max_completion_tokens ?? null,
    expirationDate: raw.expiration_date ?? null,
    testOnly: raw.id.endsWith(":free") || (prompt === 0 && completion === 0),
  };
}

/** Why a model is never offered ([MOD-02], §2.5), or null. Expiring models are handled apart (they may be in use). */
export type ModelExclusion = "free" | "batch" | "alias" | "router";

export function modelExclusion(model: Pick<ModelInfo, "id" | "testOnly" | "pricePromptPerM" | "priceCompletionPerM">): ModelExclusion | null {
  if (model.testOnly) return "free";
  if (model.id.endsWith(":batch")) return "batch";
  if (model.id.startsWith("~")) return "alias";
  // Routers are priced "-1" (openrouter/auto…).
  if ((model.pricePromptPerM ?? 0) < 0 || (model.priceCompletionPerM ?? 0) < 0) return "router";
  return null;
}

/** Offered for new choices: not excluded and without a retirement date. */
function isOfferable(model: ModelInfo): boolean {
  return modelExclusion(model) === null && model.expirationDate === null;
}

const byName = (a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name, "es");

/** Chat models for agents: text output with tools ([MOD-02]). */
export function chatModels(models: readonly ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.outputModalities.includes("text") && m.supportsTools && isOfferable(m)).sort(byName);
}

/** Cheap vision models that describe images for agents whose model cannot see them ([MED-05]); tools not needed. */
export function visionModels(models: readonly ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.outputModalities.includes("text") && m.inputModalities.includes("image") && isOfferable(m)).sort(byName);
}

/** Speech-to-text models ([MED-01]). */
export function transcriptionModels(models: readonly ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.outputModalities.includes("transcription") && isOfferable(m)).sort(byName);
}

/**
 * Embedding models ([AJU-04]). The catalogue does not say their size: choosing one runs verifyEmbeddingModel(),
 * which asks for 1536 dimensions and rejects any other size (decision 0013).
 */
export function embeddingModels(models: readonly ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.outputModalities.includes("embeddings") && isOfferable(m)).sort(byName);
}

export function findModel(models: readonly ModelInfo[] | null | undefined, id: string): ModelInfo | null {
  return models?.find((model) => model.id === id) ?? null;
}

/** What chat() needs to know about the primary model. */
export function modelSupport(model: ModelInfo | null | undefined): ModelSupport | null {
  if (!model) return null;
  return {
    supportedEfforts: model.supportedEfforts,
    reasoningMandatory: model.reasoningMandatory,
    supportsTemperature: model.supportsTemperature,
    maxCompletionTokens: model.maxCompletionTokens,
    inputModalities: model.inputModalities,
  };
}

// ─── Catalogue cache ────────────────────────────────────────────────────────────────────────────────────

/** System: the cached catalogue whatever its age, or null. No network (for validations and the reply engine). */
export async function getCachedModelCatalog(): Promise<ModelCatalog | null> {
  const cached = await getKv<ModelCatalog>(MODEL_CATALOG_KV_KEY);
  return cached && cached.format === CATALOG_FORMAT && Array.isArray(cached.models) ? cached : null;
}

/**
 * System: the catalogue, from the 12 h cache or from OpenRouter (`refresh` = «Actualizar»). Needs the key: without
 * it, AiNotConfiguredError and nothing is loaded ([MOD-08]). If OpenRouter fails, an older cached copy is used.
 */
export async function getModelCatalog(options: OpenRouterDeps & { refresh?: boolean; now?: Date } = {}): Promise<ModelCatalog> {
  const client = await getOpenRouterClient(options);
  const now = options.now ?? new Date();
  const cached = await getCachedModelCatalog();
  if (!options.refresh && cached && now.getTime() - new Date(cached.fetchedAt).getTime() < MODEL_CATALOG_TTL_MS) return cached;
  if (!options.refresh) {
    // It failed a moment ago: not asked again on every call while OpenRouter is down or the key is wrong.
    const failure = await getKv<{ status: number; code: OpenRouterErrorCode }>(MODEL_CATALOG_RETRY_KV_KEY);
    if (failure) {
      if (cached) return cached;
      throw new OpenRouterError(failure.status, failure.code);
    }
  }
  let catalog: ModelCatalog;
  try {
    const { models, source } = await client.listModels();
    catalog = { format: CATALOG_FORMAT, fetchedAt: now.toISOString(), source, models: models.map(normalizeModel) };
    await setKv(MODEL_CATALOG_KV_KEY, catalog);
    await deleteKv(MODEL_CATALOG_RETRY_KV_KEY);
  } catch (error) {
    if (isOpenRouterError(error)) {
      const retryAt = new Date(Date.now() + MODEL_CATALOG_RETRY_AFTER_MS);
      await setKv(MODEL_CATALOG_RETRY_KV_KEY, { status: error.status, code: error.code }, { expiresAt: retryAt });
    }
    if (cached) return cached;
    throw error;
  }
  // `client` is a key only being tried, or one the caller already holds: only the installation's own key keeps the list
  // refreshed in the background.
  await afterDownload(catalog, { keepRefreshing: !options.client });
  return catalog;
}

/**
 * After each download: the team hears once about models in use that retire or left the list ([MOD-06], [AJU-08]) and,
 * with the installation's key, the list keeps being downloaded every 12 h. It never stops the list from loading.
 */
async function afterDownload(catalog: ModelCatalog, options: { keepRefreshing: boolean }): Promise<void> {
  try {
    await warnAboutModelsInUse(catalog.models);
    if (options.keepRefreshing) await ensureModelCatalogRefreshJob();
  } catch (error) {
    console.warn(`[modelos] No se han podido revisar los modelos en uso: ${safeErrorMessage(error)}`);
  }
}

/** System: the recurring job that downloads the list again 12 h after each run (idempotent) ([MOD-01], [MOD-06]). */
export async function ensureModelCatalogRefreshJob(): Promise<void> {
  const firstRunAt = new Date(Date.now() + MODEL_CATALOG_TTL_MS);
  await getJobQueue().ensureRecurring({ type: MODEL_CATALOG_REFRESH_JOB, key: MODEL_CATALOG_REFRESH_JOB, intervalMs: MODEL_CATALOG_TTL_MS, firstRunAt });
}

/**
 * System: the catalogue a model choice is checked against ([MOD-05]): the saved one whatever its age or, when none
 * was saved yet, the list of OpenRouter (then kept 12 h like any other). Null when it cannot be had (no key,
 * OpenRouter down): only the rules that need no list apply then. `deps.client` checks with a key not saved yet.
 */
export async function catalogForValidation(deps: OpenRouterDeps = {}): Promise<ModelCatalog | null> {
  const cached = await getCachedModelCatalog();
  if (cached) return cached;
  try {
    return await getModelCatalog(deps);
  } catch (error) {
    if (error instanceof AiNotConfiguredError || isOpenRouterError(error)) return null;
    throw error;
  }
}

/**
 * System: what chat() needs to know about a model, from the catalogue. Without it (no list, OpenRouter down),
 * null: reasoning and temperature are then simply not sent ([MOD-07]).
 */
export async function catalogSupport(client: OpenRouterClient, modelId: string): Promise<ModelSupport | null> {
  const catalog = await getModelCatalog({ client }).catch(() => null);
  return modelSupport(findModel(catalog?.models, modelId));
}

// ─── Choosing models ────────────────────────────────────────────────────────────────────────────────────

const CHOICE_MESSAGES = {
  primaryRequired: "Elige el modelo principal.",
  fallbackRequired: "Elige un modelo de respaldo de otro proveedor.",
  sameProvider: "El modelo de respaldo tiene que ser de otro proveedor.",
  missing: "Este modelo no está en la lista de OpenRouter de tu cuenta. Elige otro o pulsa «Actualizar lista».",
  noTools: "Este modelo no admite herramientas: elige otro.",
  free: "Los modelos gratuitos o de pruebas no se pueden usar en un agente.",
  batch: "Este modelo es solo para procesamiento por lotes: elige otro.",
  alias: "Este nombre es un alias que cambia de modelo: elige el modelo concreto.",
  router: "Los enrutadores automáticos no se pueden usar: elige un modelo concreto.",
} as const;

function catalogProblem(model: ModelInfo | null, timeZone: string): string | null {
  if (!model) return CHOICE_MESSAGES.missing;
  const exclusion = modelExclusion(model);
  if (exclusion) return CHOICE_MESSAGES[exclusion];
  if (!model.supportsTools) return CHOICE_MESSAGES.noTools;
  if (model.expirationDate) return `Este modelo se retira a partir del ${formatExpiration(model.expirationDate, timeZone)}: elige otro.`;
  return null;
}

export type ModelChoiceErrors = { model?: string[]; fallbackModel?: string[] };

/**
 * Checks the primary and fallback models of an agent ([MOD-05]): both written like OpenRouter ids and of different
 * providers; with a catalogue, each one exists, supports tools and is offerable. `checkCatalog` limits the catalogue
 * checks to the fields that change, so an agent keeps saving while its model is only flagged ([MOD-06]).
 * Returns the Spanish error of each field, or null when valid.
 */
export function validateModelChoice(
  primary: string | null | undefined,
  fallback: string | null | undefined,
  catalog: readonly ModelInfo[] | null,
  options: { checkCatalog?: { model: boolean; fallbackModel: boolean }; timeZone?: string } = {},
): ModelChoiceErrors | null {
  const errors: ModelChoiceErrors = {};
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
  const check = options.checkCatalog ?? { model: true, fallbackModel: true };
  const add = (field: keyof ModelChoiceErrors, message: string) => (errors[field] ??= []).push(message);

  if (!primary) add("model", CHOICE_MESSAGES.primaryRequired);
  else if (!MODEL_ID_PATTERN.test(primary)) add("model", MODEL_ID_HINT);
  if (!fallback) add("fallbackModel", CHOICE_MESSAGES.fallbackRequired);
  else if (!MODEL_ID_PATTERN.test(fallback)) add("fallbackModel", MODEL_ID_HINT);
  if (primary && fallback && !errors.model && !errors.fallbackModel && providerOf(primary) === providerOf(fallback)) {
    add("fallbackModel", CHOICE_MESSAGES.sameProvider);
  }
  if (catalog) {
    const primaryProblem = primary && !errors.model && check.model ? catalogProblem(findModel(catalog, primary), timeZone) : null;
    if (primaryProblem) add("model", primaryProblem);
    const fallbackProblem = fallback && !errors.fallbackModel && check.fallbackModel ? catalogProblem(findModel(catalog, fallback), timeZone) : null;
    if (fallbackProblem) add("fallbackModel", fallbackProblem);
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

// ─── Transcription privacy ([AJU-04], [CUM-10], docs/integracion-openrouter.md §9) ──────────────────────

/**
 * Transcription does not accept `data_collection` or `zdr` per request, so its privacy depends on the model: zdr =
 * every provider of the model is in OpenRouter's zero-retention list; not_zdr = some are not (their names);
 * unknown = it could not be checked (no key, OpenRouter down, a model without providers).
 */
export type TranscriptionPrivacy = { status: "zdr" } | { status: "not_zdr"; providers: string[] } | { status: "unknown" };

export const TRANSCRIPTION_PRIVACY_KV_KEY = "ai.transcription_privacy";
/** Checked results per model, kept like the catalogue ([MOD-01]). `providers` = those outside the ZDR list. */
type TranscriptionPrivacyCache = Record<string, { checkedAt: string; providers: string[] }>;
const PRIVACY_CHECK_TIMEOUT_MS = 10_000;

/** An endpoint is named by its `tag` («deepinfra/us»), or by its provider when it has none. */
function endpointKey(endpoint: ModelEndpoint): string | null {
  return endpoint.tag?.trim() || endpoint.provider_name?.trim() || null;
}

/**
 * Providers of `modelId` whose endpoint is not in the zero-retention list, or null when the model has no known
 * endpoint (nothing to judge). Pure.
 */
export function providersOutsideZdr(modelId: string, endpoints: readonly ModelEndpoint[], zdrEndpoints: readonly ModelEndpoint[]): string[] | null {
  const zdr = new Set(zdrEndpoints.filter((endpoint) => endpoint.model_id === modelId).flatMap((endpoint) => endpointKey(endpoint) ?? []));
  const known = endpoints.filter((endpoint) => endpointKey(endpoint) !== null);
  if (known.length === 0) return null;
  const outside = known.filter((endpoint) => !zdr.has(endpointKey(endpoint) ?? ""));
  return [...new Set(outside.map((endpoint) => endpoint.provider_name?.trim() || endpointKey(endpoint) || ""))].filter(Boolean);
}

/**
 * System: whether every provider of a transcription model is in OpenRouter's zero-retention list, asked with the
 * business key and kept 12 h per model. `beforeFetch` runs only when OpenRouter has to be asked (the callers' rate
 * limit, [SEG-07]). Never throws for OpenRouter failures or a missing key: the answer is then «unknown».
 */
export async function getTranscriptionPrivacy(
  modelId: string,
  options: OpenRouterDeps & { now?: Date; beforeFetch?: () => Promise<void> } = {},
): Promise<TranscriptionPrivacy> {
  const now = options.now ?? new Date();
  const fresh = (checkedAt: string) => now.getTime() - new Date(checkedAt).getTime() < MODEL_CATALOG_TTL_MS;
  const cache = (await getKv<TranscriptionPrivacyCache>(TRANSCRIPTION_PRIVACY_KV_KEY)) ?? {};
  const hit = cache[modelId];
  if (hit && fresh(hit.checkedAt)) return hit.providers.length > 0 ? { status: "not_zdr", providers: hit.providers } : { status: "zdr" };

  let client: OpenRouterClient;
  try {
    client = await getOpenRouterClient(options);
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return { status: "unknown" };
    throw error;
  }
  await options.beforeFetch?.();
  let providers: string[] | null;
  try {
    const call = { timeoutMs: PRIVACY_CHECK_TIMEOUT_MS };
    const [endpoints, zdrEndpoints] = await Promise.all([client.listModelEndpoints(modelId, call), client.listZdrEndpoints(call)]);
    providers = providersOutsideZdr(modelId, endpoints, zdrEndpoints);
  } catch (error) {
    if (isOpenRouterError(error)) return { status: "unknown" };
    throw error;
  }
  if (providers === null) return { status: "unknown" };
  const kept = Object.fromEntries(Object.entries(cache).filter(([, entry]) => fresh(entry.checkedAt)));
  await setKv(TRANSCRIPTION_PRIVACY_KV_KEY, { ...kept, [modelId]: { checkedAt: now.toISOString(), providers } });
  return providers.length > 0 ? { status: "not_zdr", providers } : { status: "zdr" };
}

// ─── Real checks (cost fractions of a cent, recorded in ai_runs) ────────────────────────────────────────

const PROBE_MAX_TOKENS = 16;
const PROBE_TEXT = "Responde solo: ok";

/**
 * A minimal real call with our provider rules (§2.6): a 404 means the privacy settings leave the model without
 * providers. Returns the Spanish problem, or null when it answers.
 */
export async function probeChatModel(client: OpenRouterClient, modelId: string, options: { zdr: boolean }): Promise<string | null> {
  const started = Date.now();
  try {
    const result = await client.chat({ model: modelId, messages: [{ role: "user", content: PROBE_TEXT }], maxTokens: PROBE_MAX_TOKENS, zdr: options.zdr });
    await recordAiRun({
      kind: "chat",
      mode: "live",
      modelRequested: modelId,
      modelUsed: result.model,
      provider: result.provider,
      generationId: result.id,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      costUsd: result.usage.cost,
      latencyMs: Date.now() - started,
    });
    return null;
  } catch (error) {
    if (!isOpenRouterError(error)) throw error;
    // An empty answer cut by our tiny max_tokens still proves the model is reachable.
    if (error.code === "empty_response") return null;
    await recordAiRun({ kind: "chat", mode: "live", modelRequested: modelId, latencyMs: Date.now() - started, error: error.userMessage });
    return error.userMessage;
  }
}

/** Checks that an embedding model gives vectors of the installation's size (decision 0013). Null when it does. */
export async function verifyEmbeddingModel(client: OpenRouterClient, modelId: string, options: { zdr: boolean }): Promise<string | null> {
  const started = Date.now();
  try {
    const result = await client.embeddings({ model: modelId, input: ["Prueba"], dimensions: EMBEDDING_DIMENSIONS, zdr: options.zdr });
    await recordAiRun({
      kind: "embedding",
      mode: "live",
      modelRequested: modelId,
      modelUsed: result.model,
      promptTokens: result.usage.promptTokens,
      costUsd: result.usage.cost,
      latencyMs: Date.now() - started,
    });
    return null;
  } catch (error) {
    if (!isOpenRouterError(error)) throw error;
    await recordAiRun({ kind: "embedding", mode: "live", modelRequested: modelId, latencyMs: Date.now() - started, error: error.userMessage });
    return error.userMessage;
  }
}
