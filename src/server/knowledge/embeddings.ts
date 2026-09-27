// Embeddings of chunks and queries ([CON-11], decision 0013): OpenRouter embeddings() in batches, always asking for
// 1536 dimensions and rejecting any other size with a clear error. Each call is recorded in ai_runs with its cost.
// Also the demo fixtures' format (docs/busqueda-hibrida.md §7): SHA-256 key of model + dims + text, and the vector
// as little-endian float32 in base64 (kb_chunks stores it as halfvec: Postgres rounds it to half precision).
import "server-only";
import { createHash } from "node:crypto";
import { recordAiRun } from "@/data/ai-runs";
import { EMBEDDING_DIMENSIONS } from "@/db/schema/columns";
import type { OpenRouterClient } from "@/lib/openrouter/client";
import { isOpenRouterError } from "@/lib/openrouter/errors";
import { EMBEDDING_BATCH_SIZE } from "./constants";
import { KNOWLEDGE_MESSAGES, KnowledgeProcessingError } from "./errors";

/** Who the embeddings were for, in ai_runs. */
export type EmbeddingRunContext = { mode?: "test" | "live"; agentId?: string | null; conversationId?: string | null };

/** The model gave vectors of another size: nothing is stored ([CON-11]). */
export class EmbeddingDimensionsError extends KnowledgeProcessingError {
  constructor(model: string) {
    super(KNOWLEDGE_MESSAGES.wrongDimensions(model, EMBEDDING_DIMENSIONS));
    this.name = "EmbeddingDimensionsError";
  }
}

function isValidVector(vector: readonly number[]): boolean {
  return vector.length === EMBEDDING_DIMENSIONS && vector.every(Number.isFinite);
}

/**
 * Vectors of `texts`, in order, in batches of EMBEDDING_BATCH_SIZE. Throws EmbeddingDimensionsError for a model
 * that is not 1536, and the OpenRouterError of any other failure (the caller decides whether to retry).
 */
export async function embedTexts(
  client: OpenRouterClient,
  texts: readonly string[],
  options: { model: string; zdr: boolean; dims?: number; run?: EmbeddingRunContext },
): Promise<number[][]> {
  if (options.dims !== undefined && options.dims !== EMBEDDING_DIMENSIONS) throw new EmbeddingDimensionsError(options.model);
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const started = Date.now();
    try {
      const result = await client.embeddings({ model: options.model, input: batch, dimensions: EMBEDDING_DIMENSIONS, zdr: options.zdr });
      if (!result.embeddings.every(isValidVector)) throw new EmbeddingDimensionsError(options.model);
      await recordAiRun({
        kind: "embedding",
        mode: options.run?.mode ?? "live",
        agentId: options.run?.agentId ?? null,
        conversationId: options.run?.conversationId ?? null,
        modelRequested: options.model,
        modelUsed: result.model,
        promptTokens: result.usage.promptTokens,
        totalTokens: result.usage.promptTokens,
        costUsd: result.usage.cost,
        latencyMs: Date.now() - started,
      });
      vectors.push(...result.embeddings);
    } catch (error) {
      const wrongSize = error instanceof EmbeddingDimensionsError || (isOpenRouterError(error) && error.code === "wrong_dimensions");
      await recordAiRun({
        kind: "embedding",
        mode: options.run?.mode ?? "live",
        agentId: options.run?.agentId ?? null,
        conversationId: options.run?.conversationId ?? null,
        modelRequested: options.model,
        latencyMs: Date.now() - started,
        error: wrongSize ? KNOWLEDGE_MESSAGES.wrongDimensions(options.model, EMBEDDING_DIMENSIONS) : isOpenRouterError(error) ? error.userMessage : KNOWLEDGE_MESSAGES.unexpected,
      });
      if (wrongSize) throw new EmbeddingDimensionsError(options.model);
      throw error;
    }
  }
  return vectors;
}

// ─── Fixtures of the demo (docs/busqueda-hibrida.md §7) ────────────────────────────────────────────────

/** SHA-256 of «model \n dims \n text»: also stored as kb_chunks.content_hash. */
export function embeddingKey(model: string, dims: number, text: string): string {
  return createHash("sha256").update(`${model}\n${dims}\n${text}`).digest("hex");
}

/** A vector as little-endian float32 bytes in base64 (8,192 characters for 1536 dimensions). */
export function encodeEmbedding(vector: readonly number[]): string {
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString("base64");
}

export function decodeEmbedding(base64: string): number[] {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength % 4 !== 0) throw new Error("Embedding con un tamaño que no es de float32.");
  return Array.from({ length: bytes.byteLength / 4 }, (_, index) => bytes.readFloatLE(index * 4));
}

export type EmbeddingFixtures = {
  version: 1;
  model: string;
  dimensions: number;
  encoding: "f32le-base64";
  generatedAt: string;
  items: Record<string, string>;
};
