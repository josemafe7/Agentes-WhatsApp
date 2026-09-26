// Expected failures of the AI layer, with generic Spanish messages for the panel (never for the end customer).
import "server-only";
import type { OpenRouterErrorCode } from "@/lib/openrouter/errors";
import { AppError } from "@/server/errors";

/** No OpenRouter key (Settings › IA or OPENROUTER_API_KEY): the AI is off ([ARR-14], [MOD-08], [PRU-07]). */
export class AiNotConfiguredError extends AppError {
  constructor() {
    super(409, "ai_not_configured", "Añade tu clave de OpenRouter en Ajustes › IA para usar la IA.");
  }
}

export type AgentRunErrorCode = OpenRouterErrorCode | "step_limit";

/**
 * A reply could not be produced. The run is already recorded in ai_runs (`runId`); nothing is sent to the customer
 * and the engine hands the conversation to a person ([MOT-09], [MOT-12]). `retryable` = worth one more try.
 */
export class AgentRunError extends AppError {
  constructor(
    readonly reason: AgentRunErrorCode,
    userMessage: string,
    readonly retryable: boolean,
    readonly runId: string | null,
  ) {
    super(502, "agent_run_failed", userMessage);
  }
}
