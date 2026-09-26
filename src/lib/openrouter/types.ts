// Request and result shapes of our OpenRouter client (docs/integracion-openrouter.md §3–§7). Messages keep the
// wire format (snake_case) so they go to OpenRouter as they are and an assistant turn can be sent back unchanged.

/** Values of `reasoning.effort`, lowest first (§3.6). */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Engines of the `file-parser` plugin we allow: never the default, which may be the paid `mistral-ocr` (§4). */
export const PDF_ENGINES = ["native", "cloudflare-ai"] as const;
export type PdfEngine = (typeof PDF_ENGINES)[number];

export type TextPart = { type: "text"; text: string };
/** Our files are private: images always travel as `data:` URLs, never public links (§3.2). */
export type ImagePart = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type FilePart = { type: "file"; file: { filename: string; file_data: string } };
/** Base64 without the `data:` prefix (§3.2, §5.2). */
export type AudioPart = { type: "input_audio"; input_audio: { data: string; format: string } };
export type ContentPart = TextPart | ImagePart | FilePart | AudioPart;

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type SystemMessage = { role: "system"; content: string };
export type UserMessage = { role: "user"; content: string | ContentPart[] };
/**
 * An assistant turn. `reasoning`/`reasoning_details` must go back unchanged within the same turn of the tools loop
 * (§3.3); they are never stored or shown.
 */
export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
  reasoning?: string | null;
  reasoning_details?: unknown[];
};
export type ToolMessage = { role: "tool"; tool_call_id: string; content: string };
export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** A function tool as the model sees it: `parameters` is a JSON Schema object (§3.3). */
export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
export type ToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

/** What the catalog says about the primary model; chat() only sends what it supports (§3.6). */
export type ModelSupport = {
  /** `reasoning.supported_efforts`; null when the model has no reasoning control (nothing is sent). */
  supportedEfforts: readonly string[] | null;
  /** Reasoning cannot be turned off: never send "none". */
  reasoningMandatory: boolean;
  supportsTemperature: boolean;
  /** `top_provider.max_completion_tokens`: max_tokens is never above it. */
  maxCompletionTokens: number | null;
  /** `architecture.input_modalities` (text, image, file, audio, video). */
  inputModalities: readonly string[];
};

export type ChatRequest = {
  /** Primary model id. */
  model: string;
  /** Fallback of another provider: sent as `models: [model, fallbackModel]` (§3.4). */
  fallbackModel?: string | null;
  messages: ChatMessage[];
  /** Sent in every request of the loop, not only the first (§3.3). */
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  /** «Sin retención de datos» of Settings › IA. `data_collection: "deny"` is always sent (§3.5, [CUM-10]). */
  zdr?: boolean;
  /** Wanted effort; checked against `support.supportedEfforts` (default «low» when allowed, [MOD-07]). */
  reasoningEffort?: ReasoningEffort | null;
  /** Capabilities of the primary model from the catalog. Without them, reasoning and temperature are not sent. */
  support?: ModelSupport | null;
  maxTokens?: number | null;
  /** Only sent when the model supports it. */
  temperature?: number | null;
  /** Sticky provider routing for the prompt cache: the conversation id, ≤ 256 characters (§3.7). */
  sessionId?: string | null;
  /** Stable pseudonym of the end customer (never a phone or an email). */
  user?: string | null;
  /** Engine of the PDF parser when a message carries a `file` part (§4). */
  pdfEngine?: PdfEngine;
};

export type ChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** USD from `usage.cost`; never computed from stored prices. Null if OpenRouter did not send it. */
  cost: number | null;
};

export type ChatResult = {
  /** Generation id (`gen-…`), for support and `/generation`. */
  id: string;
  /** The model that answered and was billed (the fallback when the primary failed). */
  model: string;
  /** Provider actually used, from `openrouter_metadata` (X-OpenRouter-Metadata: enabled). */
  provider: string | null;
  finishReason: string | null;
  content: string | null;
  toolCalls: ToolCall[];
  /** A refusal inside a valid answer (`finish_reason: "content_filter"`): not an error (§3.8). */
  refusal: string | null;
  /** The assistant turn exactly as it must be sent back in the next request of the tools loop. */
  assistantMessage: AssistantMessage;
  usage: ChatUsage;
};

export type EmbeddingsRequest = {
  model: string;
  input: string[];
  /** Asked when the model supports it; the result length is always checked ([decision 0013]). */
  dimensions?: number;
  zdr?: boolean;
  sessionId?: string | null;
};
export type EmbeddingsResult = {
  model: string;
  /** In the order of `input` (sorted by `index`, §6). */
  embeddings: number[][];
  usage: { promptTokens: number; cost: number | null };
};

export type TranscriptionRequest = {
  model: string;
  /** Base64 without the `data:` prefix. */
  audioBase64: string;
  /** wav, mp3, flac, m4a, ogg, webm, aac… */
  format: string;
  /** ISO-639-1; Spanish by default ([MED-01]). */
  language?: string;
  sessionId?: string | null;
};
export type TranscriptionResult = {
  text: string;
  /** From the X-Generation-Id header. */
  generationId: string | null;
  usage: { seconds: number | null; inputTokens: number | null; outputTokens: number | null; cost: number | null };
};

export type RerankRequest = {
  model: string;
  query: string;
  documents: string[];
  topN?: number;
  zdr?: boolean;
  sessionId?: string | null;
};
export type RerankResult = {
  model: string;
  provider: string | null;
  /** Most relevant first; `index` points into `documents`. */
  results: { index: number; relevanceScore: number }[];
  usage: { cost: number | null };
};

/** Per-call options. */
export type CallOptions = { signal?: AbortSignal; timeoutMs?: number };
