// Form of Ajustes › IA, with Spanish messages next to each field ([AJU-15]). src/data/settings.ts validates again.
import { z } from "zod";

/** «proveedor/modelo» as OpenRouter writes it (openai/gpt-5.6-luna, mistralai/voxtral-mini-transcribe…). */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
export const MAX_RECOMMENDED_MODELS = 50;
const MODEL_HINT = "Escribe el modelo como aparece en OpenRouter, por ejemplo openai/gpt-5.6-luna.";

const modelId = z.string().trim().min(1, "Escribe el modelo.").max(200, MODEL_HINT).regex(MODEL_ID_PATTERN, MODEL_HINT);
/** A secret field: absent = keep (the «Cambiar» button was not pressed); "" also keeps ([AJU-16]). */
const secret = z.string().trim().max(2_000, "Valor demasiado largo.").optional();

export const aiSettingsFormSchema = z.object({
  openrouterKey: secret,
  mistralKey: secret,
  chat: modelId,
  transcription: modelId,
  embeddings: modelId,
  imageDescription: modelId,
  recommendedModels: z
    .string()
    .max(10_000, "Lista demasiado larga.")
    .transform((value) => [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))])
    .pipe(
      z
        .array(z.string().regex(MODEL_ID_PATTERN, `Hay un modelo mal escrito. ${MODEL_HINT}`))
        .max(MAX_RECOMMENDED_MODELS, `Como mucho ${MAX_RECOMMENDED_MODELS} modelos.`),
    ),
  zdr: z.boolean(),
});

export type AiSettingsForm = z.output<typeof aiSettingsFormSchema>;

const optionalText = (formData: FormData, name: string) => (formData.has(name) ? String(formData.get(name) ?? "") : undefined);

/** FormData → raw values for the schema. A switch sends "on" only when it is on. */
export function aiSettingsFromFormData(formData: FormData) {
  return {
    openrouterKey: optionalText(formData, "openrouterKey"),
    mistralKey: optionalText(formData, "mistralKey"),
    chat: String(formData.get("chat") ?? ""),
    transcription: String(formData.get("transcription") ?? ""),
    embeddings: String(formData.get("embeddings") ?? ""),
    imageDescription: String(formData.get("imageDescription") ?? ""),
    recommendedModels: String(formData.get("recommendedModels") ?? ""),
    zdr: formData.get("zdr") === "on",
  };
}
