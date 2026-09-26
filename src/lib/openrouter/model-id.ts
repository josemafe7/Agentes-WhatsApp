// OpenRouter model ids («proveedor/modelo»). Pure: used by forms, the data layer and the AI layer.

/** «proveedor/modelo» as OpenRouter writes it (openai/gpt-5.6-luna, qwen/qwen3.8-27b:free…). Aliases (~…) do not match. */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
export const MODEL_ID_HINT = "Escribe el modelo como aparece en OpenRouter, por ejemplo openai/gpt-5.6-luna.";

/** Provider prefix of a model id («openai» in openai/gpt-5.6-luna): the fallback must have another one ([MOD-05]). */
export function providerOf(modelId: string): string {
  return modelId.split("/")[0].replace(/^~/, "").toLowerCase();
}
