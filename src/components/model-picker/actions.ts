"use server";
// Server Actions of <ModelPicker>: the list of models of one kind ([MOD-01]–[MOD-04], [MOD-08]) and «Actualizar
// lista». Session and permission are checked here on every call ([SEG-04]); the key never leaves the server.
import { z } from "zod";
import { enforceAiRateLimit } from "@/server/ai/limits";
import { AppError, AuthError } from "@/server/errors";
import { requireActor } from "@/server/session";
import { canRefreshModels, canViewModels, loadModelOptions } from "./catalog";
import { MODEL_PICKER_KINDS, type ModelOptionsResult } from "./types";

const inputSchema = z
  .object({
    kind: z.enum(MODEL_PICKER_KINDS),
    allowTestOnly: z.boolean().default(false),
  })
  .strict();

const INVALID_INPUT: ModelOptionsResult = { status: "error", message: "No se ha podido cargar la lista de modelos." };

/** Expected errors (session, permission, rate limit) become a message for the picker; the rest reach error.tsx. */
function failure(error: unknown): ModelOptionsResult {
  if (error instanceof AppError) return { status: "error", message: error.userMessage };
  throw error;
}

/**
 * The options of a kind, from the 12 h cache (or OpenRouter when it is older). Who only looks (supervisor, viewer)
 * gets the saved list and never makes the server call OpenRouter with the business key ([PER-03], [SEG-07]).
 */
export async function loadModelOptionsAction(input: unknown): Promise<ModelOptionsResult> {
  try {
    const actor = await requireActor();
    if (!canViewModels(actor)) throw new AuthError("forbidden");
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return INVALID_INPUT;
    return await loadModelOptions(actor, { ...parsed.data, refresh: false, cacheOnly: !canRefreshModels(actor) });
  } catch (error) {
    return failure(error);
  }
}

/** «Actualizar lista»: asks OpenRouter again and keeps the new list 12 h ([MOD-01]). Limited per person ([SEG-07]). */
export async function refreshModelOptionsAction(input: unknown): Promise<ModelOptionsResult> {
  try {
    const actor = await requireActor();
    if (!canRefreshModels(actor)) throw new AuthError("forbidden");
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return INVALID_INPUT;
    await enforceAiRateLimit("models", actor.userId);
    return await loadModelOptions(actor, { ...parsed.data, refresh: true });
  } catch (error) {
    return failure(error);
  }
}
