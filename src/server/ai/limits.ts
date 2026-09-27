// Limits on what spends AI from the panel ([SEG-07], docs/security.md «Límites y errores»). Every Server Action or
// route that calls OpenRouter for a person checks its bucket first; the reply engine has its own per-customer caps.
import "server-only";
import { getRateLimiter, type RateLimiter } from "@/server/adapters/rate-limiter";
import { RateLimitError } from "@/server/errors";

const MINUTE_MS = 60_000;

/** Per person and minute. */
export const AI_RATE_LIMITS = {
  /** A message in «Probar agente». */
  test: { limit: 20, windowMs: MINUTE_MS },
  /** «Generar borrador con IA» / «Generar desde la web del negocio». */
  generate: { limit: 5, windowMs: MINUTE_MS },
  /** «Actualizar lista» of models and the real checks of a model choice. */
  models: { limit: 10, windowMs: MINUTE_MS },
  /** A message of the channel simulator, which the AI answers (Ajustes › Diagnóstico). */
  simulator: { limit: 20, windowMs: MINUTE_MS },
} as const;
export type AiRateLimitKind = keyof typeof AI_RATE_LIMITS;

const MESSAGE = "Has hecho muchas peticiones a la IA seguidas. Espera un minuto y vuelve a intentarlo.";

/** Counts one use of `kind` by `subject` (the user id) or throws RateLimitError. */
export async function enforceAiRateLimit(kind: AiRateLimitKind, subject: string, limiter: RateLimiter = getRateLimiter()): Promise<void> {
  const { limit, windowMs } = AI_RATE_LIMITS[kind];
  const result = await limiter.hit(`ai:${kind}:${subject}`, limit, windowMs);
  if (!result.allowed) throw new RateLimitError(MESSAGE);
}
