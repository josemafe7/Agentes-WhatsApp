// Default OpenRouter models per task (docs/integracion-openrouter.md §10, checked 2026-09-26). The setup wizard
// saves them in Settings › IA, where they can be changed ([ASI-07], [AJU-04]). Prices are never stored here.

/** Same keys as `DefaultModels` in src/db/schema/settings.ts. */
export const DEFAULT_MODELS = {
  chat: "openai/gpt-5.6-luna",
  fallback: "google/gemini-3.1-flash-lite",
  transcription: "openai/whisper-large-v3-turbo",
  embeddings: "openai/text-embedding-3-small",
  imageDescription: "google/gemini-3.1-flash-lite",
  rerank: "cohere/rerank-v3.5",
} as const;

/** «Recomendados» offered first in the model pickers. */
export const RECOMMENDED_CHAT_MODELS: readonly string[] = [DEFAULT_MODELS.chat, DEFAULT_MODELS.fallback];
