// Our own OpenRouter client, plain fetch and no AI SDK (docs/decisions/0005, docs/integracion-openrouter.md).
// Base URL from OPENROUTER_BASE_URL (with /api/v1; the e2e mock server in tests) and an injectable fetch, so tests
// never call OpenRouter. Every response is parsed with Zod; failures become OpenRouterError with a Spanish message.
// The key only travels in the Authorization header: it is never logged, stored in errors or returned.
import "server-only";
import { OpenRouterError, openRouterErrorFrom, type OpenRouterErrorBody } from "./errors";
import { checkOpenRouterKey, openRouterBaseUrl, type OpenRouterKeyCheck } from "./key";
import {
  chatResponseSchema,
  embeddingsResponseSchema,
  errorBodySchema,
  modelEndpointSchema,
  modelEndpointsResponseSchema,
  modelListSchema,
  openRouterModelSchema,
  rerankResponseSchema,
  transcriptionResponseSchema,
  usageSchema,
  type ModelEndpoint,
  type OpenRouterModel,
} from "./schemas";
import { MODEL_ID_PATTERN } from "./model-id";
import {
  REASONING_EFFORTS,
  type AssistantMessage,
  type CallOptions,
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type ChatUsage,
  type EmbeddingsRequest,
  type EmbeddingsResult,
  type ModelSupport,
  type PdfEngine,
  type ReasoningEffort,
  type RerankRequest,
  type RerankResult,
  type ToolCall,
  type TranscriptionRequest,
  type TranscriptionResult,
} from "./types";
import type { z } from "zod";

/** Attribution header value (§«Conexión y cabeceras»). */
export const OPENROUTER_APP_TITLE = "DominIA Agentes";
/** «Razonamiento bajo por defecto» ([MOD-07]): many models reason by default and take long. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";
/** Some providers require at least 16 output tokens (§3.6). */
export const MIN_MAX_TOKENS = 16;
/** `session_id` limit (§3.7). */
const MAX_SESSION_ID_LENGTH = 256;
/** Providers cut transcriptions at 60 s; ours is the same ([MED-01], §5.1). */
export const TRANSCRIPTION_TIMEOUT_MS = 60_000;

const DEFAULT_TIMEOUT_MS = {
  models: 20_000,
  chat: 60_000,
  embeddings: 30_000,
  transcription: TRANSCRIPTION_TIMEOUT_MS,
  rerank: 15_000,
} as const;

export type OpenRouterClientOptions = {
  apiKey: string;
  /** Defaults to OPENROUTER_BASE_URL or https://openrouter.ai/api/v1 (see key.ts). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Overrides the default time-out of every call (each call can still pass its own). */
  timeoutMs?: number;
  /** Public URL of the installation: sent as HTTP-Referer with a hidden app listing (§«Conexión y cabeceras»). */
  appUrl?: string | null;
};

export type ModelListResult = {
  models: OpenRouterModel[];
  /** user = /models/user (the account's privacy and provider preferences); public = the general list ([MOD-01]). */
  source: "user" | "public";
};

export type OpenRouterClient = {
  /** «Probar clave»: GET /key. Never throws. */
  getKey(options?: CallOptions): Promise<OpenRouterKeyCheck>;
  /** GET /models/user, falling back to the public /models ([MOD-01]). `outputModalities` defaults to "all". */
  listModels(options?: CallOptions & { outputModalities?: string }): Promise<ModelListResult>;
  /** GET /models/{author}/{slug}/endpoints: the providers that serve a model (§2.6). */
  listModelEndpoints(modelId: string, options?: CallOptions): Promise<ModelEndpoint[]>;
  /** GET /endpoints/zdr: every endpoint with zero data retention (§9). */
  listZdrEndpoints(options?: CallOptions): Promise<ModelEndpoint[]>;
  chat(request: ChatRequest, options?: CallOptions): Promise<ChatResult>;
  embeddings(request: EmbeddingsRequest, options?: CallOptions): Promise<EmbeddingsResult>;
  transcribe(request: TranscriptionRequest, options?: CallOptions): Promise<TranscriptionResult>;
  rerank(request: RerankRequest, options?: CallOptions): Promise<RerankResult>;
};

type RequestInput = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
};

// ─── Pure helpers ────────────────────────────────────────────────────────────────────────────────────────

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * The effort to send, or null to send none (§3.6): the wanted one if the model lists it; otherwise «low» when
 * allowed, else the lowest listed effort that is not "none". Never "none" when reasoning is mandatory, and nothing
 * for models without reasoning control.
 */
export function resolveReasoningEffort(
  wanted: ReasoningEffort | null | undefined,
  support: Pick<ModelSupport, "supportedEfforts" | "reasoningMandatory"> | null | undefined,
): ReasoningEffort | null {
  const listed = (support?.supportedEfforts ?? []).filter(isReasoningEffort);
  const allowed = support?.reasoningMandatory ? listed.filter((effort) => effort !== "none") : listed;
  if (allowed.length === 0) return null;
  const target = wanted ?? DEFAULT_REASONING_EFFORT;
  if (allowed.includes(target)) return target;
  if (allowed.includes(DEFAULT_REASONING_EFFORT)) return DEFAULT_REASONING_EFFORT;
  return REASONING_EFFORTS.find((effort) => effort !== "none" && allowed.includes(effort)) ?? null;
}

/** max_tokens between 16 and the model's own output limit (§3.6). */
export function clampMaxTokens(wanted: number, modelLimit: number | null | undefined): number {
  const capped = modelLimit && modelLimit > 0 ? Math.min(wanted, modelLimit) : wanted;
  return Math.max(MIN_MAX_TOKENS, Math.floor(capped));
}

function hasPart(messages: readonly ChatMessage[], type: "file" | "image_url"): boolean {
  return messages.some((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((part) => part.type === type));
}

/** Our images are private: they may only travel inside the request as data: URLs (§3.2). */
function assertPrivateImages(messages: readonly ChatMessage[]): void {
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "image_url" && !part.image_url.url.startsWith("data:")) {
        throw new OpenRouterError(400, "bad_request");
      }
    }
  }
}

function pdfEngineFor(request: ChatRequest): PdfEngine {
  if (request.pdfEngine) return request.pdfEngine;
  return request.support?.inputModalities.includes("file") ? "native" : "cloudflare-ai";
}

/** The JSON body of POST /chat/completions (§3.1). Exported for tests. */
export function buildChatBody(request: ChatRequest): Record<string, unknown> {
  assertPrivateImages(request.messages);
  const fallback = request.fallbackModel && request.fallbackModel !== request.model ? request.fallbackModel : null;
  const body: Record<string, unknown> = {
    ...(fallback ? { models: [request.model, fallback] } : { model: request.model }),
    messages: request.messages,
    stream: false,
    // Always deny data collection; zdr only adds (it can never relax the account setting). Never require_parameters.
    provider: { data_collection: "deny", ...(request.zdr ? { zdr: true } : {}) },
  };
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    body.tool_choice = request.toolChoice ?? "auto";
  }
  const effort = resolveReasoningEffort(request.reasoningEffort, request.support);
  if (effort) body.reasoning = { effort };
  if (request.maxTokens) body.max_tokens = clampMaxTokens(request.maxTokens, request.support?.maxCompletionTokens);
  if (request.temperature !== null && request.temperature !== undefined && request.support?.supportsTemperature) {
    body.temperature = request.temperature;
  }
  if (request.sessionId) body.session_id = request.sessionId.slice(0, MAX_SESSION_ID_LENGTH);
  if (request.user) body.user = request.user;
  // Without an explicit engine OpenRouter may use the paid mistral-ocr (§4).
  if (hasPart(request.messages, "file")) body.plugins = [{ id: "file-parser", pdf: { engine: pdfEngineFor(request) } }];
  return body;
}

function toUsage(raw: z.infer<typeof usageSchema> | null | undefined): ChatUsage {
  return {
    promptTokens: raw?.prompt_tokens ?? 0,
    completionTokens: raw?.completion_tokens ?? 0,
    totalTokens: raw?.total_tokens ?? (raw?.prompt_tokens ?? 0) + (raw?.completion_tokens ?? 0),
    cachedTokens: raw?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: raw?.prompt_tokens_details?.cache_write_tokens ?? 0,
    reasoningTokens: raw?.completion_tokens_details?.reasoning_tokens ?? 0,
    cost: raw?.cost ?? null,
  };
}

type RawContent = string | { type: string; text?: string | null }[] | null | undefined;

function contentText(content: RawContent): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
    return text || null;
  }
  return null;
}

function numericStatus(code: number | string | null | undefined, fallback: number): number {
  const value = typeof code === "string" ? Number(code) : code;
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : fallback;
}

function errorFromBody(error: z.infer<typeof errorBodySchema>["error"], fallbackStatus: number): OpenRouterError {
  const details: OpenRouterErrorBody = { code: error.code ?? undefined, metadata: error.metadata ?? undefined };
  return openRouterErrorFrom(numericStatus(error.code, fallbackStatus), details);
}

/** Parses a chat completion; an error inside a 200 (no choices, or finish_reason "error") throws (§«Forma de los errores»). */
export function parseChatResponse(raw: unknown): ChatResult {
  const parsed = chatResponseSchema.safeParse(raw);
  if (!parsed.success) throw new OpenRouterError(502, "invalid_response");
  const data = parsed.data;
  const choice = data.choices[0];
  if (choice.finish_reason === "error" || choice.error) {
    throw errorFromBody(choice.error ?? {}, 502);
  }
  const message = choice.message ?? {};
  const rawContent = message.content as RawContent;
  const content = contentText(rawContent);
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.function.name, arguments: call.function.arguments ?? "{}" },
  }));
  const refusal = message.refusal ?? null;
  // The reasoning ate the whole max_tokens: billed, but nothing to send (§3.6).
  if (!content?.trim() && toolCalls.length === 0 && !refusal && choice.finish_reason === "length") {
    throw new OpenRouterError(200, "empty_response");
  }
  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content: typeof rawContent === "string" ? rawContent : content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.reasoning_details && message.reasoning_details.length > 0 ? { reasoning_details: message.reasoning_details } : {}),
  };
  const selected = data.openrouter_metadata?.endpoints?.available?.find((endpoint) => endpoint.selected)?.provider;
  return {
    id: data.id,
    model: data.model,
    provider: selected ?? data.provider ?? null,
    finishReason: choice.finish_reason ?? null,
    content,
    toolCalls,
    refusal,
    assistantMessage,
    usage: toUsage(data.usage),
  };
}

function parseModelList(raw: unknown): OpenRouterModel[] {
  const parsed = modelListSchema.safeParse(raw);
  if (!parsed.success) throw new OpenRouterError(502, "invalid_response");
  // One odd entry must not hide the whole catalogue: invalid entries are skipped.
  return parsed.data.data.flatMap((entry) => {
    const model = openRouterModelSchema.safeParse(entry);
    return model.success ? [model.data] : [];
  });
}

/** Endpoint entries; an odd one is skipped instead of hiding the rest. */
function parseEndpoints(entries: readonly unknown[]): ModelEndpoint[] {
  return entries.flatMap((entry) => {
    const endpoint = modelEndpointSchema.safeParse(entry);
    return endpoint.success ? [endpoint.data] : [];
  });
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function stripDataUrlPrefix(base64: string): string {
  const comma = base64.startsWith("data:") ? base64.indexOf(",") : -1;
  return comma >= 0 ? base64.slice(comma + 1) : base64;
}

// ─── Client ──────────────────────────────────────────────────────────────────────────────────────────────

export function createOpenRouterClient(options: OpenRouterClientOptions): OpenRouterClient {
  const apiKey = options.apiKey.trim();
  const baseUrl = (options.baseUrl ?? openRouterBaseUrl()).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const appUrl = options.appUrl?.trim() || null;

  const timeoutFor = (kind: keyof typeof DEFAULT_TIMEOUT_MS, call?: CallOptions) =>
    call?.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS[kind];

  function baseHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "X-OpenRouter-Title": OPENROUTER_APP_TITLE,
      // Without «hidden», a Referer creates a public listing of the installation in OpenRouter's rankings.
      ...(appUrl ? { "HTTP-Referer": appUrl, "X-OpenRouter-App-Visibility": "hidden" } : {}),
    };
  }

  async function send(input: RequestInput): Promise<{ body: unknown; headers: Headers }> {
    if (!apiKey) throw new OpenRouterError(401, "invalid_key");
    const timeout = AbortSignal.timeout(input.timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(`${baseUrl}${input.path}`, {
        method: input.method,
        headers: {
          ...baseHeaders(),
          ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...input.headers,
        },
        ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
        signal,
        cache: "no-store",
      });
      // Read inside the try: a time-out while the body arrives is still a time-out.
      body = parseJson(await response.text());
    } catch (error) {
      // The caller cancelled: let them see their own abort.
      if (input.signal?.aborted) throw error;
      if (timeout.aborted) throw new OpenRouterError(408, "timeout");
      // Network errors may carry the URL or headers in their text: not kept.
      throw new OpenRouterError(0, "network");
    }
    const errorBody = errorBodySchema.safeParse(body);
    if (!response.ok) {
      throw openRouterErrorFrom(
        response.status,
        errorBody.success ? { code: errorBody.data.error.code ?? undefined, metadata: errorBody.data.error.metadata ?? undefined } : undefined,
        response.headers.get("retry-after"),
      );
    }
    if (body === undefined) throw new OpenRouterError(502, "invalid_response");
    // HTTP 200 carrying only an error (the provider failed after accepting the request).
    const hasResult = typeof body === "object" && body !== null && ("choices" in body || "data" in body || "text" in body || "results" in body);
    if (errorBody.success && !hasResult) throw errorFromBody(errorBody.data.error, 502);
    return { body, headers: response.headers };
  }

  return {
    getKey(call) {
      return checkOpenRouterKey(apiKey, { fetch: fetchImpl, baseUrl, timeoutMs: call?.timeoutMs ?? options.timeoutMs });
    },

    async listModels(call) {
      const query = `?output_modalities=${encodeURIComponent(call?.outputModalities ?? "all")}`;
      const timeoutMs = timeoutFor("models", call);
      // Never ?supported_parameters=tools: that list carries the cheaper «flex» prices (§2.2). Tools are filtered here.
      try {
        const { body } = await send({ method: "GET", path: `/models/user${query}`, timeoutMs, signal: call?.signal });
        return { models: parseModelList(body), source: "user" };
      } catch (error) {
        if (call?.signal?.aborted) throw error;
        const { body } = await send({ method: "GET", path: `/models${query}`, timeoutMs, signal: call?.signal });
        return { models: parseModelList(body), source: "public" };
      }
    },

    async listModelEndpoints(modelId, call) {
      // Only a real «author/slug» id reaches the path: nothing else can be smuggled into the URL.
      if (!MODEL_ID_PATTERN.test(modelId)) throw new OpenRouterError(400, "bad_request");
      const path = `/models/${modelId.split("/").map(encodeURIComponent).join("/")}/endpoints`;
      const { body } = await send({ method: "GET", path, timeoutMs: timeoutFor("models", call), signal: call?.signal });
      const parsed = modelEndpointsResponseSchema.safeParse(body);
      if (!parsed.success) throw new OpenRouterError(502, "invalid_response");
      return parseEndpoints(parsed.data.data.endpoints);
    },

    async listZdrEndpoints(call) {
      const { body } = await send({ method: "GET", path: "/endpoints/zdr", timeoutMs: timeoutFor("models", call), signal: call?.signal });
      const parsed = modelListSchema.safeParse(body);
      if (!parsed.success) throw new OpenRouterError(502, "invalid_response");
      return parseEndpoints(parsed.data.data);
    },

    async chat(request, call) {
      const body = buildChatBody(request);
      const { body: raw } = await send({
        method: "POST",
        path: "/chat/completions",
        body,
        // Adds openrouter_metadata: the provider actually used (§3.8).
        headers: { "X-OpenRouter-Metadata": "enabled" },
        timeoutMs: timeoutFor("chat", call),
        signal: call?.signal,
      });
      return parseChatResponse(raw);
    },

    async embeddings(request, call) {
      if (request.input.length === 0 || request.input.some((text) => !text.trim())) throw new OpenRouterError(400, "bad_request");
      const { body: raw } = await send({
        method: "POST",
        path: "/embeddings",
        body: {
          model: request.model,
          input: request.input,
          encoding_format: "float",
          ...(request.dimensions ? { dimensions: request.dimensions } : {}),
          provider: { data_collection: "deny", ...(request.zdr ? { zdr: true } : {}) },
        },
        headers: request.sessionId ? { "x-session-id": request.sessionId.slice(0, MAX_SESSION_ID_LENGTH) } : undefined,
        timeoutMs: timeoutFor("embeddings", call),
        signal: call?.signal,
      });
      const parsed = embeddingsResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.data.length !== request.input.length) throw new OpenRouterError(502, "invalid_response");
      const embeddings = [...parsed.data.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      if (request.dimensions && embeddings.some((vector) => vector.length !== request.dimensions)) {
        throw new OpenRouterError(200, "wrong_dimensions", {
          userMessage: `Este modelo de embeddings no da vectores de ${request.dimensions} dimensiones. Elige otro en Ajustes > IA.`,
        });
      }
      return {
        model: parsed.data.model ?? request.model,
        embeddings,
        usage: { promptTokens: parsed.data.usage?.prompt_tokens ?? 0, cost: parsed.data.usage?.cost ?? null },
      };
    },

    async transcribe(request, call) {
      // No provider preferences here: transcription does not accept data_collection or zdr (§5.1, §9).
      const { body: raw, headers } = await send({
        method: "POST",
        path: "/audio/transcriptions",
        body: {
          model: request.model,
          input_audio: { data: stripDataUrlPrefix(request.audioBase64), format: request.format },
          language: request.language ?? "es",
        },
        // In transcription only the header groups the logs (§5.1).
        headers: request.sessionId ? { "x-session-id": request.sessionId.slice(0, MAX_SESSION_ID_LENGTH) } : undefined,
        timeoutMs: timeoutFor("transcription", call),
        signal: call?.signal,
      });
      const parsed = transcriptionResponseSchema.safeParse(raw);
      if (!parsed.success) throw new OpenRouterError(502, "invalid_response");
      const usage = parsed.data.usage;
      return {
        text: parsed.data.text,
        generationId: headers.get("x-generation-id"),
        usage: {
          seconds: usage?.seconds ?? null,
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
          cost: usage?.cost ?? null,
        },
      };
    },

    async rerank(request, call) {
      const { body: raw } = await send({
        method: "POST",
        path: "/rerank",
        body: {
          model: request.model,
          query: request.query,
          documents: request.documents,
          ...(request.topN ? { top_n: request.topN } : {}),
          provider: { data_collection: "deny", ...(request.zdr ? { zdr: true } : {}) },
          ...(request.sessionId ? { session_id: request.sessionId.slice(0, MAX_SESSION_ID_LENGTH) } : {}),
        },
        timeoutMs: timeoutFor("rerank", call),
        signal: call?.signal,
      });
      const parsed = rerankResponseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.results.some((result) => result.index >= request.documents.length)) {
        throw new OpenRouterError(502, "invalid_response");
      }
      return {
        model: parsed.data.model ?? request.model,
        provider: parsed.data.provider ?? null,
        results: parsed.data.results.map((result) => ({ index: result.index, relevanceScore: result.relevance_score })),
        usage: { cost: parsed.data.usage?.cost ?? null },
      };
    },
  };
}

/** Content part helpers: images and PDFs from bytes, always as base64 data (§3.2, §4). */
export function imagePart(bytes: Uint8Array, mimeType: string) {
  return { type: "image_url" as const, image_url: { url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` } };
}

export function pdfPart(bytes: Uint8Array, filename: string) {
  return { type: "file" as const, file: { filename, file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}` } };
}

export function audioPart(bytes: Uint8Array, format: string) {
  return { type: "input_audio" as const, input_audio: { data: Buffer.from(bytes).toString("base64"), format } };
}
