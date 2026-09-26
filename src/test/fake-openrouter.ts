// A fake OpenRouter for Vitest: an injectable fetch that records every call and answers with the documented
// shapes of docs/integracion-openrouter.md. Tests never call the real service (docs/testing.md).
import type { ToolCall } from "@/lib/openrouter/types";

export const FAKE_OPENROUTER_KEY = "sk-or-v1-test-0123456789abcdef-secret";

export type FakeCall = {
  url: string;
  /** Path after the base URL, without the query (e.g. "/chat/completions"). */
  path: string;
  query: URLSearchParams;
  method: string;
  headers: Headers;
  /** Parsed JSON body (undefined for GET). */
  body: unknown;
};

export type FakeHandler = (call: FakeCall) => Response | Promise<Response>;

export const FAKE_BASE_URL = "https://openrouter.test/api/v1";

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A fetch that records calls and answers with `handler`. */
export function fakeFetch(handler: FakeHandler) {
  const calls: FakeCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const base = new URL(FAKE_BASE_URL);
    const path = url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : url.pathname;
    const call: FakeCall = {
      url: url.toString(),
      path,
      query: url.searchParams,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

/** Routes by "METHOD /path"; anything else answers 501 so a missing stub is loud. */
export function routes(table: Record<string, FakeHandler>): FakeHandler {
  return (call) => {
    const handler = table[`${call.method} ${call.path}`];
    return handler ? handler(call) : jsonResponse({ error: { code: 501, message: `No simulado: ${call.method} ${call.path}` } }, 501);
  };
}

/** Answers each call with the next handler of the list (the last one repeats). */
export function sequence(...handlers: FakeHandler[]): FakeHandler {
  let index = 0;
  return (call) => {
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return handler(call);
  };
}

type ChatReplyInput = {
  content?: string | null;
  toolCalls?: { name: string; arguments: unknown; id?: string }[];
  model?: string;
  provider?: string;
  finishReason?: string;
  usage?: Partial<{ prompt: number; completion: number; cached: number; reasoning: number; cost: number }>;
  reasoningDetails?: unknown[];
};

let callNumber = 0;

/** Body of a chat completion (§3.8), with `openrouter_metadata` naming the selected provider. */
export function chatCompletion(input: ChatReplyInput = {}) {
  const toolCalls: ToolCall[] | undefined = input.toolCalls?.map((call) => ({
    id: call.id ?? `call_${++callNumber}`,
    type: "function",
    function: { name: call.name, arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments) },
  }));
  const prompt = input.usage?.prompt ?? 1200;
  const completion = input.usage?.completion ?? 40;
  return {
    id: `gen-test-${++callNumber}`,
    object: "chat.completion",
    created: 1_790_380_800,
    model: input.model ?? "openai/gpt-5.6-luna",
    choices: [
      {
        index: 0,
        finish_reason: input.finishReason ?? (toolCalls ? "tool_calls" : "stop"),
        native_finish_reason: "completed",
        message: {
          role: "assistant",
          content: input.content === undefined ? (toolCalls ? null : "¡Hola! ¿En qué te puedo ayudar?") : input.content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
          ...(input.reasoningDetails ? { reasoning_details: input.reasoningDetails } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      prompt_tokens_details: { cached_tokens: input.usage?.cached ?? 0, cache_write_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: input.usage?.reasoning ?? 0 },
      cost: input.usage?.cost ?? 0.00024,
      is_byok: false,
    },
    openrouter_metadata: {
      endpoints: { available: [{ provider: "Azure", selected: false }, { provider: input.provider ?? "OpenAI", selected: true }] },
    },
  };
}

/** One entry of GET /models as in the sample of §2.3, with overrides. */
export function modelEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "openai/gpt-5.6-luna",
    canonical_slug: "openai/gpt-5.6-luna-20260709",
    name: "OpenAI: GPT-5.6 Luna",
    created: 1_783_590_864,
    context_length: 1_050_000,
    architecture: {
      modality: "text+image+file->text",
      input_modalities: ["file", "image", "text"],
      output_modalities: ["text"],
      tokenizer: "GPT",
      instruct_type: null,
    },
    pricing: { prompt: "0.0000002", completion: "0.0000012", input_cache_read: "0.00000002" },
    top_provider: { context_length: 1_050_000, max_completion_tokens: 128_000, is_moderated: true },
    supported_parameters: ["max_tokens", "reasoning", "response_format", "tool_choice", "tools"],
    reasoning: { mandatory: false, default_enabled: true, default_effort: "medium", supported_efforts: ["max", "xhigh", "high", "medium", "low", "none"] },
    expiration_date: null,
    knowledge_cutoff: "2026-02-16",
    per_request_limits: null,
    ...overrides,
  };
}

/** A small catalogue with one example of every rule of §2.5 ([MOD-02]). */
export function sampleCatalog() {
  const text = { input_modalities: ["text"], output_modalities: ["text"], tokenizer: "Other" };
  return [
    modelEntry(),
    modelEntry({
      id: "google/gemini-3.1-flash-lite",
      name: "Google: Gemini 3.1 Flash Lite",
      architecture: { input_modalities: ["text", "image", "file", "audio", "video"], output_modalities: ["text"], tokenizer: "Gemini" },
      pricing: { prompt: "0.00000025", completion: "0.0000015" },
      supported_parameters: ["max_tokens", "reasoning", "temperature", "tool_choice", "tools"],
      reasoning: { mandatory: false, default_enabled: true, default_effort: "minimal", supported_efforts: ["high", "medium", "low", "minimal"] },
    }),
    modelEntry({ id: "anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5", reasoning: null, supported_parameters: ["max_tokens", "temperature", "tools"] }),
    modelEntry({ id: "meta/llama-no-tools", name: "Meta: Llama sin herramientas", supported_parameters: ["max_tokens", "temperature"], architecture: text }),
    modelEntry({ id: "qwen/qwen3.8-27b:free", name: "Qwen: Qwen3.8 27B (free)", pricing: { prompt: "0", completion: "0" } }),
    modelEntry({ id: "stealth/space-bunny-alpha", name: "Stealth: Space Bunny", pricing: { prompt: "0", completion: "0" } }),
    modelEntry({ id: "google/gemini-2.5-flash:batch", name: "Google: Gemini 2.5 Flash (batch)" }),
    modelEntry({ id: "~anthropic/claude-haiku-latest", name: "Anthropic: Claude Haiku Latest", alias_target: { slug: "anthropic/claude-haiku-4.5" } }),
    modelEntry({ id: "openrouter/auto", name: "Auto Router", pricing: { prompt: "-1", completion: "-1" }, reasoning: null, architecture: { ...text, tokenizer: "Router" } }),
    modelEntry({ id: "deepseek/deepseek-v3.2", name: "DeepSeek: V3.2", expiration_date: "2026-09-28", reasoning: null }),
    modelEntry({
      id: "openai/whisper-large-v3-turbo",
      name: "OpenAI: Whisper Large v3 Turbo",
      architecture: { input_modalities: ["audio"], output_modalities: ["transcription"], tokenizer: "Other" },
      pricing: { prompt: "0.00000333", completion: "0" },
      supported_parameters: [],
      reasoning: null,
    }),
    modelEntry({
      id: "openai/text-embedding-3-small",
      name: "OpenAI: Text Embedding 3 Small",
      architecture: { input_modalities: ["text"], output_modalities: ["embeddings"], tokenizer: "GPT" },
      pricing: { prompt: "0.00000002", completion: "0" },
      supported_parameters: ["dimensions"],
      reasoning: null,
    }),
    { id: "broken/entry", pricing: "not an object" },
  ];
}

/** One provider endpoint as GET /models/{id}/endpoints and GET /endpoints/zdr describe it (§2.6, §9). */
export function endpointEntry(modelId: string, providerName: string, tag: string) {
  return {
    name: `${providerName} | ${modelId}`,
    model_id: modelId,
    model_name: modelId,
    context_length: null,
    pricing: { prompt: "0.00000333", completion: "0" },
    provider_name: providerName,
    tag,
    quantization: null,
    max_completion_tokens: null,
    max_prompt_tokens: null,
    supported_parameters: [],
    status: 0,
    uptime_last_30m: 100,
    supports_implicit_caching: false,
  };
}

/** Body of GET /models/{author}/{slug}/endpoints. */
export function modelEndpointsBody(modelId: string, endpoints: ReturnType<typeof endpointEntry>[]) {
  return { data: { id: modelId, name: modelId, created: 1_777_642_266, description: "", architecture: {}, endpoints } };
}

/**
 * GET /endpoints/zdr of the transcription examples: Whisper Large v3 Turbo only through zero-retention providers
 * (DeepInfra and Groq, as on 2026-09-26); Voxtral Mini Transcribe has none there.
 */
export const WHISPER_ENDPOINTS = [
  endpointEntry("openai/whisper-large-v3-turbo", "DeepInfra", "deepinfra/us"),
  endpointEntry("openai/whisper-large-v3-turbo", "Groq", "groq"),
];
export const VOXTRAL_ENDPOINTS = [endpointEntry("mistralai/voxtral-mini-transcribe", "Mistral", "mistral")];
export function zdrEndpointsBody() {
  return { data: [...WHISPER_ENDPOINTS, endpointEntry("z-ai/glm-5.3", "Mistral", "mistral/zdr")] };
}
