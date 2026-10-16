// What a person of the team reads when an internal agent cannot answer ([INT-07], [MOT-12]). The messages of the AI
// layer are written for who configures the app («revísala en Ajustes › IA», «elige otro en el agente»): in
// «Asistentes» most people cannot do that, so they read what they can do themselves, or to tell an administrator.
// Pure: the Server Action decides who is asking.
import { manualRetryMessage } from "@/lib/openrouter/errors";

/** Something only who manages the AI can fix (the key, its credit, the model): the rest are told who to tell. */
export const ASK_AN_ADMIN = "El asistente no puede responder ahora mismo. Avisa a un administrador para que lo revise.";
export const CONVERSATION_TOO_LONG = "Esta conversación es demasiado larga para el asistente. Empieza una conversación nueva.";
export const COULD_NOT_FINISH = "El asistente no ha podido terminar la respuesta. Prueba a preguntarlo de otra forma.";
export const TRY_AGAIN = "El asistente no ha podido responder. Pulsa «Reintentar».";

export type AssistantRunFailure = { reason: string; userMessage: string; retryable: boolean };

/**
 * The message of a failed answer. `canFix`: the person can open Ajustes › IA, so the reason itself is useful to them.
 * In order: what the person can do on their own (start another conversation, write it another way, retry), and only
 * then what is left, which is the configuration.
 */
export function assistantFailureMessage(failure: AssistantRunFailure, canFix: boolean): string {
  if (failure.reason === "context_length") return CONVERSATION_TOO_LONG;
  if (failure.reason === "step_limit") return COULD_NOT_FINISH;
  const byHand = manualRetryMessage(failure.reason);
  if (byHand) return byHand;
  if (failure.retryable) return TRY_AGAIN;
  return canFix ? failure.userMessage : ASK_AN_ADMIN;
}
