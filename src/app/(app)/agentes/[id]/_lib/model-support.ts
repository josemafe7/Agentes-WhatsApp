// What the Modelo tab needs to know about the chosen model ([MOD-07]): temperature only if the model accepts it, and
// the reasoning levels it offers. Pure type plus the choices of the reasoning select.
import { REASONING_EFFORTS, type ReasoningEffort } from "@/lib/openrouter/types";

export type ModelSettingsSupport = {
  supportsTemperature: boolean;
  /** Levels the model accepts; null = no reasoning control (nothing is sent). */
  supportedEfforts: ReasoningEffort[] | null;
  /** The model always reasons: «Sin razonamiento» is not offered. */
  reasoningMandatory: boolean;
  maxCompletionTokens: number | null;
};

/**
 * Levels offered in the select, lowest first. Without catalogue data every level is offered (the server sends only
 * what the model accepts); a mandatory-reasoning model never offers «none».
 */
export function reasoningChoices(support: ModelSettingsSupport | null): ReasoningEffort[] {
  const allowed = support?.supportedEfforts ?? [...REASONING_EFFORTS];
  return REASONING_EFFORTS.filter((effort) => allowed.includes(effort) && !(effort === "none" && support?.reasoningMandatory));
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}
