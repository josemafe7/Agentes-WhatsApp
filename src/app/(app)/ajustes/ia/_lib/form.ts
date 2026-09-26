// Form of Ajustes › IA, with Spanish messages next to each field ([AJU-15]). src/data/settings.ts validates again.
import { z } from "zod";
import type { DefaultModels } from "@/db/schema/settings";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { MODEL_ID_HINT as MODEL_HINT, MODEL_ID_PATTERN } from "@/lib/openrouter/model-id";

export const MAX_RECOMMENDED_MODELS = 50;

/** Default models edited on this page ([AJU-04]); rerank arrives with the knowledge search (phase 4). */
export const DEFAULT_MODEL_FIELDS = ["chat", "fallback", "transcription", "embeddings", "imageDescription"] as const;
export type DefaultModelField = (typeof DEFAULT_MODEL_FIELDS)[number];
export type AiModels = Record<DefaultModelField, string>;

/** How each default is named in warnings. */
export const DEFAULT_MODEL_LABELS: Record<DefaultModelField, string> = {
  chat: "Chat por defecto",
  fallback: "Respaldo por defecto",
  transcription: "Transcripción de audios",
  embeddings: "Embeddings",
  imageDescription: "Descripción de imágenes",
};

/** The defaults in use: the saved ones, or those of docs/integracion-openrouter.md §10 until they are changed. */
export function effectiveDefaultModels(stored: DefaultModels): AiModels {
  return {
    chat: stored.chat || DEFAULT_MODELS.chat,
    fallback: stored.fallback || DEFAULT_MODELS.fallback,
    transcription: stored.transcription || DEFAULT_MODELS.transcription,
    embeddings: stored.embeddings || DEFAULT_MODELS.embeddings,
    imageDescription: stored.imageDescription || DEFAULT_MODELS.imageDescription,
  };
}

const modelId = z.string().trim().min(1, "Escribe el modelo.").max(200, MODEL_HINT).regex(MODEL_ID_PATTERN, MODEL_HINT);
/** A secret field: absent = keep (the «Cambiar» button was not pressed); "" also keeps ([AJU-16]). */
const secret = z.string().trim().max(2_000, "Valor demasiado largo.").optional();

export const aiSettingsFormSchema = z.object({
  openrouterKey: secret,
  mistralKey: secret,
  chat: modelId,
  /** From another provider than `chat` ([MOD-05]); checked by the Server Action with the model list. */
  fallback: modelId,
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
    fallback: String(formData.get("fallback") ?? ""),
    transcription: String(formData.get("transcription") ?? ""),
    embeddings: String(formData.get("embeddings") ?? ""),
    imageDescription: String(formData.get("imageDescription") ?? ""),
    recommendedModels: String(formData.get("recommendedModels") ?? ""),
    zdr: formData.get("zdr") === "on",
  };
}
