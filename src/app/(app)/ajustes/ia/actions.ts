"use server";
// Server Actions of Ajustes › IA ([AJU-04]). Owner and admin only ([PER-04]); keys are encrypted by src/data and
// never come back to the browser ([SEG-02]). «Probar clave» asks OpenRouter from the server ([ASI-07]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reindexAllKnowledgeBases } from "@/data/knowledge";
import { getBusinessProfile, getIntegrationSettings, resolveOpenRouterKey, updateIntegrationSettings } from "@/data/settings";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { checkOpenRouterKey } from "@/lib/openrouter/key";
import { MODEL_ID_PATTERN } from "@/lib/openrouter/model-id";
import { PERMISSIONS } from "@/lib/permissions";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { enforceAiRateLimit } from "@/server/ai/limits";
import { getCachedModelCatalog, getTranscriptionPrivacy, type TranscriptionPrivacy } from "@/server/ai/models";
import { toActionFailure, ValidationError } from "@/server/errors";
import { scheduleEmbeddingsBackfill } from "@/server/knowledge/queue";
import { requirePermission } from "@/server/session";
import { aiSettingsFormSchema, aiSettingsFromFormData, effectiveDefaultModels, type AiModels } from "./_lib/form";
import { defaultModelProblems, embeddingModelProblem } from "./_lib/models";

const AI_PATH = "/ajustes/ia";
const KEY_TESTS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;

/**
 * Saves keys, default models, recommended list, ZDR and «Reordenar resultados» with its model (one of the list,
 * [AJU-04]; with ZDR and a model that keeps data it is saved but not used, and the page says so). The default models
 * are checked first ([MOD-05], [MOD-02])
 * and a new embeddings model is tried for real (decision 0013); if anything fails, nothing is saved ([AJU-15]).
 * Then the knowledge catches up in the background: a new embeddings model (confirmed on screen) processes every base
 * again, searching the old index until the new one is complete ([AJU-05], [CON-13]); a new OpenRouter key starts at
 * once the embeddings left pending without one ([CON-12]).
 */
export async function saveAiSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    const parsed = aiSettingsFormSchema.safeParse(aiSettingsFromFormData(formData));
    if (!parsed.success) return fromZodError(parsed.error);
    const form = parsed.data;
    const current = effectiveDefaultModels((await getIntegrationSettings(actor)).defaultModels);
    const next: AiModels = {
      chat: form.chat,
      fallback: form.fallback,
      transcription: form.transcription,
      embeddings: form.embeddings,
      imageDescription: form.imageDescription,
    };
    const { timezone } = await getBusinessProfile(actor);
    const catalog = await getCachedModelCatalog();
    const problems = defaultModelProblems(next, current, catalog?.models ?? null, timezone);
    if (problems) throw new ValidationError(undefined, problems);
    const embeddingsChanged = current.embeddings !== next.embeddings;
    if (embeddingsChanged) {
      const problem = await embeddingModelProblem(actor, next.embeddings, { zdr: form.zdr, typedKey: form.openrouterKey });
      if (problem) throw new ValidationError(undefined, { embeddings: [problem] });
    }
    await updateIntegrationSettings(actor, {
      openrouterKey: form.openrouterKey,
      mistralKey: form.mistralKey,
      defaultModels: { ...next, ...(form.rerank ? { rerank: form.rerank } : {}) },
      recommendedModels: form.recommendedModels,
      zdr: form.zdr,
      rerankEnabled: form.rerankEnabled,
    });
    if (embeddingsChanged) await reindexAllKnowledgeBases(actor, { model: next.embeddings });
    if (form.openrouterKey) await scheduleEmbeddingsBackfill({ now: true });
    revalidatePath(AI_PATH);
    if (embeddingsChanged) revalidatePath("/conocimiento", "layout");
    return ok(
      undefined,
      embeddingsChanged
        ? "Cambios guardados. Has cambiado el modelo de embeddings: las bases de conocimiento se van a volver a procesar con él. Mientras tanto, se sigue buscando con el anterior."
        : "Cambios guardados.",
    );
  } catch (error) {
    return toActionFailure(error);
  }
}

const secretName = z.object({ secret: z.enum(["openrouterKey", "mistralKey"]) });

/** «Quitar clave»: the stored key is deleted (OPENROUTER_API_KEY, if any, is used again). */
export async function removeAiSecretAction(input: { secret: "openrouterKey" | "mistralKey" }): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    const parsed = secretName.safeParse(input);
    if (!parsed.success) return fail("No se ha podido quitar la clave.");
    await updateIntegrationSettings(actor, { [parsed.data.secret]: null });
    revalidatePath(AI_PATH);
    return ok(undefined, "Clave quitada.");
  } catch (error) {
    return toActionFailure(error);
  }
}

export type { TranscriptionPrivacy } from "@/server/ai/models";

const transcriptionModelInput = z.object({ modelId: z.string().trim().max(200).regex(MODEL_ID_PATTERN) }).strict();

/**
 * Whether every provider of a transcription model is in OpenRouter's zero-retention list, for the warning next to
 * the field ([AJU-04], [CUM-10]). Kept 12 h per model; asking OpenRouter counts against the person's limit ([SEG-07]).
 */
export async function checkTranscriptionPrivacyAction(input: unknown): Promise<ActionResult<TranscriptionPrivacy>> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    const parsed = transcriptionModelInput.safeParse(input);
    if (!parsed.success) return ok({ status: "unknown" });
    return ok(await getTranscriptionPrivacy(parsed.data.modelId, { beforeFetch: () => enforceAiRateLimit("models", actor.userId) }));
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Result of «Probar clave» for the screen: never the key itself. */
export type KeyTestResult =
  | { valid: true; summary: string; details: string[]; warnings: string[] }
  | { valid: false; message: string };

/** Tests the key being typed in the form or, if none, the one in use (Ajustes or OPENROUTER_API_KEY). */
export async function testOpenRouterKeyAction(_prev: ActionResult<KeyTestResult> | null, formData: FormData): Promise<ActionResult<KeyTestResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    const limit = await getRateLimiter().hit(`openrouter-key-test:${actor.userId}`, KEY_TESTS_PER_MINUTE, MINUTE_MS);
    if (!limit.allowed) return fail("Demasiados intentos. Espera un minuto y vuelve a probar.");
    const typed = String(formData.get("openrouterKey") ?? "").trim().slice(0, 2_000);
    const key = typed || (await resolveOpenRouterKey())?.key;
    if (!key) return fail("Todavía no hay ninguna clave: escríbela y pruébala.");
    const { timezone } = await getBusinessProfile(actor);
    const check = await checkOpenRouterKey(key, { timeZone: timezone });
    return ok(
      check.valid
        ? { valid: true, summary: check.summary, details: check.details, warnings: check.warnings }
        : { valid: false, message: check.message },
    );
  } catch (error) {
    return toActionFailure(error);
  }
}
