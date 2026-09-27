// OpenRouter default answers (docs/integracion-openrouter.md). OPENROUTER_BASE_URL points at
// <mock>/openrouter/api/v1, so paths here keep the real "/api/v1/…" shape.
//
// What the e2e specs can rely on (e2e/support/ai.ts names the same values):
//   GET  /api/v1/key               200 for the keys of test-keys.json (valid, free tier, management); 401 otherwise.
//   GET  /api/v1/models/user       the account's catalogue (needs one of those keys; 401 otherwise). It leaves out
//                                  PRIVACY_FILTERED, as an account with privacy settings would (§2.1).
//   GET  /api/v1/models            the public catalogue (§2.2): everything, no key needed.
//        Both honour ?output_modalities= (default "text"; "all" = every model) like the real API.
//   GET  /api/v1/models/:author/:slug/endpoints  the providers of a model (404 if it is not in the catalogue).
//   GET  /api/v1/endpoints/zdr     the zero-retention endpoints: Whisper's (DeepInfra, Groq) are in, Voxtral's
//                                  (Mistral) are not ([AJU-04], [CUM-10]).
//   POST /api/v1/chat/completions  valid key only (free tier → 402, others → 401). Deterministic answers, the same for
//        «Probar» and for the reply engine of the channels (`session_id` = the conversation, so specs count per conversation):
//        - the reply says which agent answered («Soy <nombre>», read from «Te llamas <nombre>.» of the system prompt),
//          the channel it was told to write for («Canal: …» or «simulando …») and the customer's last message;
//        - a last customer message asking for «una persona» (and the tool offered) → a transferir_a_humano call
//          (arguments in ../openrouter-scenarios.json); after a tool result → a short closing text;
//        - «Generar borrador con IA» (a system prompt asking for one JSON object with "instructions") → a draft whose
//          role repeats the first line of the business description or web text it was given;
//        - response_format json_schema → a JSON object that fills the schema;
//        - usage grows with the number of customer messages n: prompt 1400+50n, completion 24, cost (30+n)/100000 US$
//          (n=1 → 1450/24/1474 tokens and 0.00031; n=2 → 1500/24/1524 and 0.00032); a tool-call step costs (20+n)/100000.
//        Errors (401, 402, 429…) are per test with POST /__stub (see e2e/support/ai.ts).
//   POST /api/v1/embeddings        valid key only: one vector per input, `dimensions` long (1536 by default).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const KEYS = JSON.parse(readFileSync(new URL("../test-keys.json", import.meta.url), "utf8")).openrouter;

/** GET /api/v1/key body for a working key (docs/integracion-openrouter.md §1). */
function keyData(overrides = {}) {
  return {
    data: {
      label: "Pruebas e2e",
      limit: 100,
      limit_remaining: 74.5,
      limit_reset: "monthly",
      usage: 25.5,
      usage_daily: 25.5,
      usage_weekly: 25.5,
      usage_monthly: 25.5,
      byok_usage: 0,
      include_byok_in_limit: false,
      is_free_tier: false,
      is_management_key: false,
      expires_at: "2099-12-31T23:59:59Z",
      free_model_daily_requests: { used: 0, limit: 50, remaining: 50 },
      workspace_id: "00000000-0000-4000-8000-000000000e2e",
      organization_id: null,
      allowed_data_regions: ["global", "europe", "us"],
      rate_limit: { requests: 1000, interval: "1h", note: "This field is deprecated and safe to ignore." },
      ...overrides,
    },
  };
}

const KEY_ANSWERS = new Map([
  [KEYS.valid, () => keyData()],
  [KEYS.freeTier, () => keyData({ is_free_tier: true, limit: null, limit_remaining: null, limit_reset: null })],
  [KEYS.management, () => keyData({ is_management_key: true })],
]);

// ─── Catalogue (§2.3–§2.5) ────────────────────────────────────────────────────────────────────────────────

const TEXT_IMAGE_PDF = ["text", "image", "file"];
const TOOLS_ONLY = ["max_tokens", "tool_choice", "tools"];

/** One catalogue entry with the fields of docs/integracion-openrouter.md §2.3. */
function model(id, name, overrides = {}) {
  return {
    id,
    canonical_slug: `${id}-20260709`,
    name,
    created: 1783590864,
    context_length: 1050000,
    architecture: { modality: "text+image+file->text", input_modalities: TEXT_IMAGE_PDF, output_modalities: ["text"], tokenizer: "GPT", instruct_type: null },
    pricing: { prompt: "0.0000002", completion: "0.0000012" },
    top_provider: { context_length: 1050000, max_completion_tokens: 128000, is_moderated: false },
    per_request_limits: null,
    supported_parameters: ["max_tokens", "reasoning", "tool_choice", "tools"],
    default_parameters: null,
    reasoning: { mandatory: false, default_enabled: true, default_effort: "medium", supported_efforts: ["high", "medium", "low", "none"] },
    expiration_date: null,
    knowledge_cutoff: null,
    ...overrides,
  };
}

/**
 * Offered to agents (tools, priced, no retirement date), from four providers. Luna and GPT-6 Luna share a provider
 * (the fallback must be of another one, [MOD-05]); Gemini is the one with audio; Mistral Small is only in the public
 * list (the account's privacy settings leave it out of /models/user, [MOD-01]).
 */
const CHAT_MODELS = [
  model("openai/gpt-5.6-luna", "OpenAI: GPT-5.6 Luna", {
    reasoning: { mandatory: false, default_enabled: true, default_effort: "medium", supported_efforts: ["max", "xhigh", "high", "medium", "low", "none"] },
    supported_parameters: ["include_reasoning", "max_completion_tokens", "max_tokens", "reasoning", "reasoning_effort", "response_format", "seed", "structured_outputs", "tool_choice", "tools"],
    top_provider: { context_length: 1050000, max_completion_tokens: 128000, is_moderated: true },
  }),
  model("openai/gpt-6-luna", "OpenAI: GPT-6 Luna", {
    created: 1790035200,
    pricing: { prompt: "0.0000001", completion: "0.0000005" },
  }),
  model("google/gemini-3.1-flash-lite", "Google: Gemini 3.1 Flash Lite", {
    context_length: 1048576,
    architecture: { modality: "text+image+file+audio+video->text", input_modalities: ["text", "image", "file", "audio", "video"], output_modalities: ["text"], tokenizer: "Gemini", instruct_type: null },
    pricing: { prompt: "0.00000025", completion: "0.0000015", audio: "0.0000005" },
    top_provider: { context_length: 1048576, max_completion_tokens: 65536, is_moderated: false },
    supported_parameters: ["max_tokens", "reasoning", "response_format", "temperature", "tool_choice", "tools"],
    reasoning: { mandatory: false, default_enabled: true, default_effort: "minimal", supported_efforts: ["high", "medium", "low", "minimal"] },
  }),
  model("anthropic/claude-haiku-4.5", "Anthropic: Claude Haiku 4.5", {
    context_length: 200000,
    architecture: { modality: "text+image+file->text", input_modalities: TEXT_IMAGE_PDF, output_modalities: ["text"], tokenizer: "Claude", instruct_type: null },
    pricing: { prompt: "0.000001", completion: "0.000005" },
    top_provider: { context_length: 200000, max_completion_tokens: 64000, is_moderated: false },
    supported_parameters: ["max_tokens", "temperature", "tool_choice", "tools"],
    reasoning: null,
  }),
  model("mistralai/mistral-small-3.2-24b-instruct", "Mistral: Mistral Small 3.2 24B", {
    context_length: 131072,
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"], tokenizer: "Mistral", instruct_type: null },
    pricing: { prompt: "0.0000001", completion: "0.0000003" },
    top_provider: { context_length: 131072, max_completion_tokens: 32768, is_moderated: false },
    supported_parameters: ["max_tokens", "temperature", "tool_choice", "tools"],
    reasoning: null,
  }),
];

/** Never offered: one example of each rule of §2.5 (and [MOD-02]). */
const EXCLUDED_MODELS = [
  // No tools.
  model("meta-llama/llama-3.2-3b-instruct", "Meta: Llama 3.2 3B Instruct", {
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"], tokenizer: "Llama3", instruct_type: "llama3" },
    pricing: { prompt: "0.00000002", completion: "0.00000002" },
    supported_parameters: ["max_tokens", "temperature"],
    reasoning: null,
  }),
  // Free (":free") and other zero-priced ones («stealth»).
  model("qwen/qwen3.8-27b:free", "Qwen: Qwen3.8 27B (free)", { pricing: { prompt: "0", completion: "0" }, supported_parameters: TOOLS_ONLY }),
  model("stealth/space-bunny-alpha", "Stealth: Space Bunny Alpha", { pricing: { prompt: "0", completion: "0" }, supported_parameters: TOOLS_ONLY, reasoning: null }),
  // Batch API entries.
  model("google/gemini-2.5-flash:batch", "Google: Gemini 2.5 Flash (batch)", { pricing: { prompt: "0.00000015", completion: "0.00000125" } }),
  // Aliases that change model.
  model("~anthropic/claude-haiku-latest", "Anthropic: Claude Haiku Latest", {
    pricing: { prompt: "0.000001", completion: "0.000005" },
    alias_target: { slug: "anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5" },
  }),
  // Routers (negative prices).
  model("openrouter/auto", "Auto Router", {
    pricing: { prompt: "-1", completion: "-1" },
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"], tokenizer: "Router", instruct_type: null },
    reasoning: null,
  }),
  // With a retirement date.
  model("deepseek/deepseek-v3.2", "DeepSeek: DeepSeek V3.2", {
    pricing: { prompt: "0.00000026", completion: "0.00000038" },
    expiration_date: "2026-09-28",
    reasoning: null,
  }),
];

/** Other kinds of models (Ajustes › IA pickers): never chat models. */
const OTHER_MODELS = [
  model("openai/whisper-large-v3-turbo", "OpenAI: Whisper Large v3 Turbo", {
    context_length: null,
    architecture: { modality: "audio->transcription", input_modalities: ["audio"], output_modalities: ["transcription"], tokenizer: "Other", instruct_type: null },
    pricing: { prompt: "0.00000333", completion: "0" },
    top_provider: { context_length: null, max_completion_tokens: null, is_moderated: false },
    supported_parameters: [],
    reasoning: null,
  }),
  model("mistralai/voxtral-mini-transcribe", "Mistral: Voxtral Mini Transcribe", {
    context_length: null,
    architecture: { modality: "audio->transcription", input_modalities: ["audio"], output_modalities: ["transcription"], tokenizer: "Other", instruct_type: null },
    pricing: { prompt: "0.00005", completion: "0" },
    top_provider: { context_length: null, max_completion_tokens: null, is_moderated: false },
    supported_parameters: [],
    reasoning: null,
  }),
  model("openai/text-embedding-3-small", "OpenAI: Text Embedding 3 Small", {
    context_length: 8192,
    architecture: { modality: "text->embeddings", input_modalities: ["text"], output_modalities: ["embeddings"], tokenizer: "GPT", instruct_type: null },
    pricing: { prompt: "0.00000002", completion: "0" },
    top_provider: { context_length: 8192, max_completion_tokens: null, is_moderated: false },
    supported_parameters: ["dimensions"],
    reasoning: null,
  }),
];

/** The public list (§2.2). */
const PUBLIC_CATALOG = [...CHAT_MODELS, ...EXCLUDED_MODELS, ...OTHER_MODELS];
/** Left out of /models/user by the account's privacy settings (§2.1). */
const PRIVACY_FILTERED = new Set(["mistralai/mistral-small-3.2-24b-instruct"]);
const USER_CATALOG = PUBLIC_CATALOG.filter((entry) => !PRIVACY_FILTERED.has(entry.id));

/** ?output_modalities= as the real API reads it: default "text", "all" = everything, else a comma list. */
function byOutputModalities(catalog, query) {
  const wanted = String(query.output_modalities ?? "text")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (wanted.includes("all")) return catalog;
  return catalog.filter((entry) => entry.architecture.output_modalities.some((modality) => wanted.includes(modality)));
}

function catalogBody(catalog, query) {
  return { data: byOutputModalities(catalog, query), links: { next: null } };
}

// ─── Providers of a model and the zero-retention list (§2.6, §9) ──────────────────────────────────────────

/** One provider endpoint as GET /models/{id}/endpoints and GET /endpoints/zdr describe it. */
function endpoint(modelId, providerName, tag) {
  const entry = PUBLIC_CATALOG.find((candidate) => candidate.id === modelId);
  return {
    name: `${providerName} | ${modelId}`,
    model_id: modelId,
    model_name: entry?.name ?? modelId,
    context_length: entry?.context_length ?? null,
    pricing: entry?.pricing ?? { prompt: "0", completion: "0" },
    provider_name: providerName,
    tag,
    quantization: null,
    max_completion_tokens: null,
    max_prompt_tokens: null,
    supported_parameters: entry?.supported_parameters ?? [],
    status: 0,
    uptime_last_30m: 100,
    supports_implicit_caching: false,
  };
}

/**
 * Who serves the transcription models ([AJU-04], [CUM-10]): Whisper only through zero-retention providers (DeepInfra
 * and Groq, as on 2026-09-26); Voxtral through Mistral, which is not in the zero-retention list.
 */
const TRANSCRIPTION_ENDPOINTS = {
  "openai/whisper-large-v3-turbo": [endpoint("openai/whisper-large-v3-turbo", "DeepInfra", "deepinfra/us"), endpoint("openai/whisper-large-v3-turbo", "Groq", "groq")],
  "mistralai/voxtral-mini-transcribe": [endpoint("mistralai/voxtral-mini-transcribe", "Mistral", "mistral")],
};
/** GET /endpoints/zdr: the Whisper endpoints and the Google one of Gemini (§9). */
const ZDR_ENDPOINTS = [...TRANSCRIPTION_ENDPOINTS["openai/whisper-large-v3-turbo"], endpoint("google/gemini-3.1-flash-lite", "Google Vertex", "google-vertex")];

/** Endpoints of any model of the catalogue (one per model, named after its provider), or null when it does not exist. */
function endpointsOf(modelId) {
  if (TRANSCRIPTION_ENDPOINTS[modelId]) return TRANSCRIPTION_ENDPOINTS[modelId];
  if (!PUBLIC_CATALOG.some((entry) => entry.id === modelId)) return null;
  const prefix = modelId.split("/")[0];
  return [endpoint(modelId, prefix, prefix)];
}

// ─── Chat (§3) ────────────────────────────────────────────────────────────────────────────────────────────

const PROVIDER_NAMES = { openai: "OpenAI", google: "Google", anthropic: "Anthropic", mistralai: "Mistral", deepseek: "DeepSeek" };
const CHANNEL_NAMES = ["WhatsApp", "correo electrónico", "chat de la web", "Telegram"];

/** Arguments of the transferir_a_humano call the simulated model makes (shared with the specs through the JSON). */
const HANDOFF_ARGUMENTS = JSON.parse(readFileSync(new URL("../openrouter-scenarios.json", import.meta.url), "utf8")).handoffArguments;

let generation = 0;

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && part.type === "text" ? String(part.text ?? "") : "")).join("");
  return "";
}

function providerOf(modelId) {
  const prefix = String(modelId).split("/")[0].replace(/^~/, "").toLowerCase();
  return PROVIDER_NAMES[prefix] ?? prefix;
}

/** What the system prompt says about the agent and the channel (docs/integracion-openrouter.md §3.1). */
function promptFacts(messages) {
  const system = textOf(messages.find((message) => message?.role === "system")?.content);
  const agentName = /^Te llamas (.+)\.$/m.exec(system)?.[1]?.trim() ?? null;
  const channel = CHANNEL_NAMES.find((name) => new RegExp(`(simulando|Canal:) ${name}\\b`).test(system)) ?? null;
  return { agentName, channel };
}

function offersTool(body, name) {
  return Array.isArray(body?.tools) && body.tools.some((tool) => tool?.function?.name === name);
}

function usageFor(customerMessages, { toolStep }) {
  const promptTokens = (toolStep ? 1300 : 1400) + 50 * customerMessages;
  const completionTokens = toolStep ? 40 : 24;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
    cost: ((toolStep ? 20 : 30) + customerMessages) / 100000,
    is_byok: false,
  };
}

/** A JSON value that satisfies a (simple) JSON Schema, for response_format json_schema requests. */
function sampleFor(schema, key = "valor") {
  if (!schema || typeof schema !== "object") return `Borrador de prueba: ${key}`;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
  switch (type) {
    case "object": {
      const result = {};
      for (const [name, child] of Object.entries(schema.properties ?? {})) result[name] = sampleFor(child, name);
      return result;
    }
    case "array":
      return [sampleFor(schema.items, key)];
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 1;
    case "boolean":
      return false;
    default:
      return `Borrador de prueba: ${key}`;
  }
}

function completion(body, message, usage, finishReason) {
  const requested = Array.isArray(body?.models) && body.models.length > 0 ? body.models[0] : body?.model;
  const modelId = typeof requested === "string" && requested ? requested : "openai/gpt-5.6-luna";
  return {
    id: `gen-e2e-${++generation}`,
    object: "chat.completion",
    created: 1790380800,
    model: modelId,
    service_tier: "default",
    system_fingerprint: null,
    choices: [{ index: 0, finish_reason: finishReason, native_finish_reason: finishReason === "tool_calls" ? "tool_calls" : "completed", message }],
    usage,
    openrouter_metadata: { endpoints: { available: [{ provider: providerOf(modelId), selected: true }] } },
  };
}

/**
 * «Generar borrador con IA» ([AGE-05], [ASI-08]): the app asks for one JSON object (name, tone, instructions, faqs)
 * about the business named in «- Nombre: …», with the source text two lines after «Material de origen…». The draft
 * repeats the first line of that source in its role, so a test can tell it came from what it typed.
 */
function isDraftRequest(messages) {
  const system = textOf(messages.find((message) => message?.role === "system")?.content);
  return /objeto JSON/.test(system) && system.includes('"instructions"');
}

function draftAnswer(body, messages) {
  const request = textOf(messages.find((message) => message?.role === "user")?.content);
  const lines = request.split("\n");
  const business = /^- Nombre: (.+)$/m.exec(request)?.[1]?.trim() || "el negocio";
  const originAt = lines.findIndex((line) => line.startsWith("Material de origen"));
  const source = (originAt >= 0 ? (lines[originAt + 2] ?? "") : "").trim().slice(0, 120);
  const draft = {
    name: `Asistente de ${business}`.slice(0, 80),
    tone: "Cercano y profesional",
    instructions: {
      role: `Eres el asistente de IA de ${business}. Según el negocio: ${source}`,
      businessInfo: `${business}: ${source}`,
      can: "Resolver dudas sobre los servicios y ayudar a pedir cita.",
      cannot: "No inventes precios, horarios ni políticas, y no pidas datos de tarjetas ni documentos de identidad.",
      style: "Cercano, de tú, con mensajes breves.",
      handoff: "Pasa la conversación a una persona si lo piden, si hay una queja o si no sabes responder.",
    },
    faqs: [{ question: "¿Cómo pido cita?", answer: "Escríbenos por aquí y te ayudamos a encontrar un hueco." }],
  };
  const customerMessages = messages.filter((message) => message?.role === "user").length;
  return completion(body, { role: "assistant", content: JSON.stringify(draft) }, usageFor(customerMessages, { toolStep: false }), "stop");
}

/** The deterministic answer of the simulated model (see the header). */
function chatAnswer(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const customerMessages = messages.filter((message) => message?.role === "user").length;
  const last = messages.at(-1);

  if (isDraftRequest(messages)) return draftAnswer(body, messages);

  if (body?.response_format?.type === "json_schema") {
    const content = JSON.stringify(sampleFor(body.response_format.json_schema?.schema, "borrador"));
    return completion(body, { role: "assistant", content }, usageFor(customerMessages, { toolStep: false }), "stop");
  }

  if (last?.role === "tool") {
    const message = { role: "assistant", content: "He pasado tu conversación a una persona del equipo." };
    return completion(body, message, usageFor(customerMessages, { toolStep: false }), "stop");
  }

  const lastText = textOf(last?.content).trim();
  if (last?.role === "user" && /\bpersona\b/i.test(lastText) && offersTool(body, "transferir_a_humano")) {
    const message = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: `call_e2e_${generation + 1}`, type: "function", function: { name: "transferir_a_humano", arguments: JSON.stringify(HANDOFF_ARGUMENTS) } }],
    };
    return completion(body, message, usageFor(customerMessages, { toolStep: true }), "tool_calls");
  }

  const { agentName, channel } = promptFacts(messages);
  // A model check without an agent («Responde solo: ok», docs/integracion-openrouter.md §2.6).
  if (!agentName) return completion(body, { role: "assistant", content: "ok" }, usageFor(customerMessages, { toolStep: false }), "stop");
  const where = channel ? ` Te escribo por ${channel}.` : "";
  const content = `Soy ${agentName}, el asistente de IA de este negocio.${where} Me has escrito: «${lastText}».`;
  return completion(body, { role: "assistant", content }, usageFor(customerMessages, { toolStep: false }), "stop");
}

// ─── Embeddings (§6) ──────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_DIMENSIONS = 1536;

/** A stable unit vector per text. */
function vectorFor(text, dimensions) {
  const values = [];
  let seed = createHash("sha256").update(text).digest();
  while (values.length < dimensions) {
    for (let index = 0; index + 1 < seed.length && values.length < dimensions; index += 2) values.push(seed.readInt16BE(index) / 32768);
    seed = createHash("sha256").update(seed).digest();
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function embeddingsAnswer(body) {
  const input = Array.isArray(body?.input) ? body.input.map(String) : [String(body?.input ?? "")];
  const dimensions = Number.isInteger(body?.dimensions) && body.dimensions > 0 ? body.dimensions : DEFAULT_DIMENSIONS;
  const tokens = input.reduce((sum, text) => sum + Math.max(1, Math.ceil(text.length / 4)), 0);
  return {
    id: `embd-e2e-${++generation}`,
    object: "list",
    model: typeof body?.model === "string" ? body.model : "openai/text-embedding-3-small",
    data: input.map((text, index) => ({ object: "embedding", index, embedding: vectorFor(text, dimensions) })),
    usage: { prompt_tokens: tokens, total_tokens: tokens, cost: tokens * 0.00000002 },
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────────────────────────────────

const unauthorized = { status: 401, body: { error: { code: 401, message: "User not found." } } };
const noCredits = {
  status: 402,
  body: { error: { code: 402, message: "Insufficient credits. Add more using https://openrouter.ai/credits", metadata: { limit_source: "openrouter_credits" } } },
};

function bearer(headers) {
  const value = headers.authorization;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}

/** Inference needs the valid key: a free-tier account has no credits for paid models, anything else is refused. */
function inference(headers, answer) {
  const key = bearer(headers);
  if (key === KEYS.valid) return { status: 200, body: answer() };
  if (key === KEYS.freeTier) return noCredits;
  return unauthorized;
}

/** @type {import("../server.mjs").MockRoute[]} */
export const openrouterRoutes = [
  {
    method: "GET",
    path: "/api/v1/key",
    handle: ({ headers }) => {
      const key = bearer(headers);
      if (!key) return { status: 401, body: { error: { code: 401, message: "Missing Authentication header" } } };
      const answer = KEY_ANSWERS.get(key);
      if (!answer) return { status: 401, body: { error: { code: 401, message: "User not found." } } };
      return { status: 200, body: answer() };
    },
  },
  {
    // The catalogue filtered by the account (needs a working key, §2.1).
    method: "GET",
    path: "/api/v1/models/user",
    handle: ({ headers, query }) => (KEY_ANSWERS.has(bearer(headers)) ? { status: 200, body: catalogBody(USER_CATALOG, query) } : unauthorized),
  },
  {
    // The public catalogue (§2.2).
    method: "GET",
    path: "/api/v1/models",
    handle: ({ query }) => ({ status: 200, body: catalogBody(PUBLIC_CATALOG, query) }),
  },
  {
    // The providers of one model (§2.6); public, like the real one.
    method: "GET",
    path: "/api/v1/models/:author/:slug/endpoints",
    handle: ({ path }) => {
      const [author, slug] = path.split("/").slice(4, 6).map(decodeURIComponent);
      const modelId = `${author}/${slug}`;
      const endpoints = endpointsOf(modelId);
      if (!endpoints) return { status: 404, body: { error: { code: 404, message: "Model not found" } } };
      return { status: 200, body: { data: { id: modelId, name: modelId, created: 1783590864, description: "", architecture: {}, endpoints } } };
    },
  },
  {
    // The public zero-retention list (§9).
    method: "GET",
    path: "/api/v1/endpoints/zdr",
    handle: () => ({ status: 200, body: { data: ZDR_ENDPOINTS } }),
  },
  {
    method: "POST",
    path: "/api/v1/chat/completions",
    handle: ({ headers, body }) => inference(headers, () => chatAnswer(body)),
  },
  {
    method: "POST",
    path: "/api/v1/embeddings",
    handle: ({ headers, body }) => inference(headers, () => embeddingsAnswer(body)),
  },
  {
    // Voice notes (§5.1, [MED-01]): a fixed transcript that says which format arrived, with the usage OpenRouter
    // reports for audio (seconds and cost). The audio itself is never decoded.
    method: "POST",
    path: "/api/v1/audio/transcriptions",
    handle: ({ headers, body }) =>
      inference(headers, () => {
        const format = typeof body?.input_audio?.format === "string" ? body.input_audio.format : "desconocido";
        return { text: `Transcripción simulada de una nota de voz (${format}).`, usage: { seconds: 3, cost: 0.00005 } };
      }),
  },
];
