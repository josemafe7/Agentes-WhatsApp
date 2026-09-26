"use server";
// Server Actions of Ajustes › IA ([AJU-04]). Owner and admin only ([PER-04]); keys are encrypted by src/data and
// never come back to the browser ([SEG-02]). «Probar clave» asks OpenRouter from the server ([ASI-07]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getBusinessProfile, getIntegrationSettings, resolveOpenRouterKey, updateIntegrationSettings } from "@/data/settings";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import { checkOpenRouterKey } from "@/lib/openrouter/key";
import { PERMISSIONS } from "@/lib/permissions";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { aiSettingsFormSchema, aiSettingsFromFormData } from "./_lib/form";

const AI_PATH = "/ajustes/ia";
const KEY_TESTS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;

export async function saveAiSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.settings.integrations);
    const parsed = aiSettingsFormSchema.safeParse(aiSettingsFromFormData(formData));
    if (!parsed.success) return fromZodError(parsed.error);
    const form = parsed.data;
    const previousEmbeddings = (await getIntegrationSettings(actor)).defaultModels.embeddings ?? DEFAULT_MODELS.embeddings;
    await updateIntegrationSettings(actor, {
      openrouterKey: form.openrouterKey,
      mistralKey: form.mistralKey,
      defaultModels: { chat: form.chat, transcription: form.transcription, embeddings: form.embeddings, imageDescription: form.imageDescription },
      recommendedModels: form.recommendedModels,
      zdr: form.zdr,
    });
    revalidatePath(AI_PATH);
    const embeddingsChanged = previousEmbeddings !== form.embeddings;
    return ok(
      undefined,
      embeddingsChanged
        ? "Cambios guardados. Has cambiado el modelo de embeddings: habrá que volver a procesar las bases de conocimiento."
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
