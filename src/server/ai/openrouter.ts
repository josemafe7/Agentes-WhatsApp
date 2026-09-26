// The OpenRouter client of this installation: the key of Settings › IA (it wins) or OPENROUTER_API_KEY ([ARR-15]),
// decrypted only here, on the server. Without a key the AI is off: AiNotConfiguredError ([ARR-14]).
import "server-only";
import { loadIntegrationSettings, resolveOpenRouterKey } from "@/data/settings";
import { createOpenRouterClient, type OpenRouterClient } from "@/lib/openrouter/client";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { providerOf } from "@/lib/openrouter/model-id";
import { getAppUrl } from "@/server/app-url";
import { AiNotConfiguredError } from "./errors";

export type OpenRouterDeps = {
  /** Tests inject a fake fetch; never the real OpenRouter (docs/testing.md). */
  fetchImpl?: typeof fetch;
  /** A ready client (tests); skips the key lookup. */
  client?: OpenRouterClient;
};

/** Client with the installation's key, or AiNotConfiguredError. */
export async function getOpenRouterClient(deps: OpenRouterDeps = {}): Promise<OpenRouterClient> {
  if (deps.client) return deps.client;
  const resolved = await resolveOpenRouterKey();
  if (!resolved) throw new AiNotConfiguredError();
  return createOpenRouterClient({ apiKey: resolved.key, fetchImpl: deps.fetchImpl, appUrl: getAppUrl() });
}

export type ResolvedDefaultModels = { [K in keyof typeof DEFAULT_MODELS]: string };

/** Default models of Settings › IA, completed with docs/integracion-openrouter.md §10 ([AJU-04]). System use. */
export async function resolveDefaultModels(): Promise<ResolvedDefaultModels> {
  const { defaultModels } = await loadIntegrationSettings();
  return {
    chat: defaultModels.chat || DEFAULT_MODELS.chat,
    fallback: defaultModels.fallback || DEFAULT_MODELS.fallback,
    transcription: defaultModels.transcription || DEFAULT_MODELS.transcription,
    embeddings: defaultModels.embeddings || DEFAULT_MODELS.embeddings,
    imageDescription: defaultModels.imageDescription || DEFAULT_MODELS.imageDescription,
    rerank: defaultModels.rerank || DEFAULT_MODELS.rerank,
  };
}

/** The fallback sent with `model`, only when it is of another provider ([MOD-05]); otherwise none. */
export function fallbackOfOtherProvider(model: string, fallback: string | null | undefined): string | null {
  return fallback && providerOf(fallback) !== providerOf(model) ? fallback : null;
}

/** «Sin retención de datos» of Settings › IA (chat, embeddings and rerank only). System use. */
export async function isZdrEnabled(): Promise<boolean> {
  return (await loadIntegrationSettings()).zdr;
}
