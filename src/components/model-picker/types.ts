// What the model picker receives from the server ([MOD-01]–[MOD-04], [MOD-08]). Pure: shared by the client
// component, its Server Actions and Ajustes › IA. Built from src/server/ai/models.ts, never from OpenRouter directly.

/** What the model is for: agents (chat), audio transcription, knowledge embeddings, image descriptions. */
export const MODEL_PICKER_KINDS = ["chat", "transcription", "embedding", "vision"] as const;
export type ModelPickerKind = (typeof MODEL_PICKER_KINDS)[number];

/** One option of the picker ([MOD-03]). Prices in USD, orientative: the real cost is `usage.cost` of each call. */
export type ModelOption = {
  id: string;
  /** Name without the provider prefix («GPT-5.6 Luna»). */
  name: string;
  /** «OpenAI», for display. */
  providerName: string;
  /** Id prefix («openai»): the fallback must have another one ([MOD-05]). */
  provider: string;
  /** Input price: per million tokens, or per second of audio when `priceUnit` is "second" (docs §2.4). */
  pricePrompt: number | null;
  /** Output price per million tokens; null when the model has none (embeddings, transcription by time). */
  priceCompletion: number | null;
  priceUnit: "million" | "second";
  contextLength: number | null;
  /** Accepts pictures, PDF and audio (the icons of [MOD-03]). */
  image: boolean;
  pdf: boolean;
  audio: boolean;
  /** Free or zero-price model: only offered with `allowTestOnly`, never saved in an agent. */
  testOnly: boolean;
  /** «28 sep 2026» when OpenRouter announces its retirement; such models are only shown when already in use. */
  expiresOn: string | null;
};

/** Answer of the picker's Server Actions. */
export type ModelOptionsResult =
  | {
      status: "ready";
      options: ModelOption[];
      /** Ids of Ajustes › IA «Modelos recomendados», shown first when they are options ([MOD-04]). */
      recommended: string[];
      /** ISO date of the list kept by the server (12 h cache, [MOD-01]). */
      fetchedAt: string;
      /** user = the list of the business's account; public = the general list, used when that one failed. */
      source: "user" | "public";
      /** May press «Actualizar lista». */
      canRefresh: boolean;
    }
  /** No OpenRouter key: the list is not loaded ([MOD-08], [ARR-14]). */
  | { status: "no_key"; canManageKey: boolean }
  | { status: "error"; message: string };
