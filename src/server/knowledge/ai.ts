// The OpenRouter client for the knowledge work, or null without a key: then documents are only searchable by words
// and their embeddings wait for the key ([CON-12], [ARR-14]).
import "server-only";
import type { OpenRouterClient } from "@/lib/openrouter/client";
import { AiNotConfiguredError } from "@/server/ai/errors";
import { getOpenRouterClient, type OpenRouterDeps } from "@/server/ai/openrouter";

export async function knowledgeAiClient(deps: OpenRouterDeps = {}): Promise<OpenRouterClient | null> {
  try {
    return await getOpenRouterClient(deps);
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return null;
    throw error;
  }
}
