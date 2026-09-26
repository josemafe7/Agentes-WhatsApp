// Zod schemas of every OpenRouter response we read (docs/integracion-openrouter.md). Lenient on purpose: optional
// fields may be missing or null, and unknown fields are dropped. What we rely on is required.
import { z } from "zod";

const count = z.number().finite().nullish();

export const errorBodySchema = z.object({
  error: z.object({
    code: z.union([z.number(), z.string()]).nullish(),
    message: z.string().nullish(),
    metadata: z.object({ error_type: z.unknown(), limit_source: z.unknown() }).partial().nullish(),
  }),
});

// ─── Models (§2) ─────────────────────────────────────────────────────────────────────────────────────────

/** Prices are text in USD per unit ("0.0000002"); a number is tolerated. */
const price = z.union([z.string(), z.number()]).nullish();

export const openRouterModelSchema = z.object({
  id: z.string().min(1),
  canonical_slug: z.string().nullish(),
  name: z.string().nullish(),
  created: z.number().nullish(),
  context_length: z.number().nullish(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).nullish(),
      output_modalities: z.array(z.string()).nullish(),
      tokenizer: z.string().nullish(),
    })
    .nullish(),
  pricing: z.object({ prompt: price, completion: price }).nullish(),
  top_provider: z
    .object({ context_length: z.number().nullish(), max_completion_tokens: z.number().nullish(), is_moderated: z.boolean().nullish() })
    .nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  reasoning: z
    .object({
      supported_efforts: z.array(z.string()).nullish(),
      default_effort: z.string().nullish(),
      mandatory: z.boolean().nullish(),
      default_enabled: z.boolean().nullish(),
    })
    .nullish(),
  expiration_date: z.string().nullish(),
});
export type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

export const modelListSchema = z.object({ data: z.array(z.unknown()) });

/**
 * One provider endpoint of a model, in GET /models/{author}/{slug}/endpoints (`data.endpoints[]`) and in the
 * zero-retention list GET /endpoints/zdr (`data[]`) (§2.6, §9). `tag` («deepinfra/us») names the endpoint.
 */
export const modelEndpointSchema = z.object({
  model_id: z.string().nullish(),
  provider_name: z.string().nullish(),
  tag: z.string().nullish(),
});
export type ModelEndpoint = z.infer<typeof modelEndpointSchema>;

export const modelEndpointsResponseSchema = z.object({ data: z.object({ endpoints: z.array(z.unknown()) }) });

// ─── Chat (§3) ───────────────────────────────────────────────────────────────────────────────────────────

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.string().nullish(),
  function: z.object({ name: z.string().min(1), arguments: z.string().nullish() }),
});

/** Some providers return content as a list of text parts. */
const contentSchema = z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().nullish() })), z.null()]);

const choiceSchema = z.object({
  finish_reason: z.string().nullish(),
  native_finish_reason: z.string().nullish(),
  message: z
    .object({
      content: contentSchema.optional(),
      tool_calls: z.array(toolCallSchema).nullish(),
      refusal: z.string().nullish(),
      reasoning: z.string().nullish(),
      reasoning_details: z.array(z.unknown()).nullish(),
    })
    .nullish(),
  error: errorBodySchema.shape.error.nullish(),
});

export const usageSchema = z.object({
  prompt_tokens: count,
  completion_tokens: count,
  total_tokens: count,
  prompt_tokens_details: z.object({ cached_tokens: count, cache_write_tokens: count }).nullish(),
  completion_tokens_details: z.object({ reasoning_tokens: count }).nullish(),
  cost: count,
});

/** `X-OpenRouter-Metadata: enabled`: the selected endpoint tells the provider (§3.8). Only what we read. */
const routerMetadataSchema = z.object({
  endpoints: z
    .object({ available: z.array(z.object({ provider: z.string().nullish(), selected: z.boolean().nullish() })).nullish() })
    .nullish(),
});

export const chatResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  provider: z.string().nullish(),
  choices: z.array(choiceSchema).min(1),
  usage: usageSchema.nullish(),
  openrouter_metadata: routerMetadataSchema.nullish(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

// ─── Embeddings (§6), transcription (§5.1) and rerank (§7) ──────────────────────────────────────────────

export const embeddingsResponseSchema = z.object({
  model: z.string().nullish(),
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number()) })),
  usage: z.object({ prompt_tokens: count, total_tokens: count, cost: count }).nullish(),
});

export const transcriptionResponseSchema = z.object({
  text: z.string(),
  usage: z.object({ seconds: count, input_tokens: count, output_tokens: count, total_tokens: count, cost: count }).nullish(),
});

export const rerankResponseSchema = z.object({
  model: z.string().nullish(),
  provider: z.string().nullish(),
  results: z.array(z.object({ index: z.number().int().nonnegative(), relevance_score: z.number() })),
  usage: z.object({ cost: count }).nullish(),
});
