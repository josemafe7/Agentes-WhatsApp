// What a person of the team reads when an internal agent cannot answer ([INT-07], [MOT-12]).
import { describe, expect, it } from "vitest";
import { OPENROUTER_ERROR_CODES } from "@/lib/openrouter/errors";
import { ASK_AN_ADMIN, assistantFailureMessage, CONVERSATION_TOO_LONG, COULD_NOT_FINISH, TRY_AGAIN } from "./failures";

const failure = (reason: string, retryable = false, userMessage = "Mensaje de la capa de IA para quien la configura.") => ({ reason, retryable, userMessage });
/** Failures of the configuration: the key, its credit, the model and its options. */
const CONFIGURATION = ["invalid_key", "no_credits", "key_limit", "model_unavailable", "bad_request", "unprocessable", "payload_too_large", "wrong_dimensions"] as const;

describe("the message of a failed answer in «Asistentes»", () => {
  it("what only an administrator can fix is told as it is to who can open Ajustes › IA, and as «avisa a un administrador» to the rest", () => {
    for (const reason of CONFIGURATION) {
      expect(assistantFailureMessage(failure(reason), true)).toBe("Mensaje de la capa de IA para quien la configura.");
      expect(assistantFailureMessage(failure(reason), false)).toBe(ASK_AN_ADMIN);
    }
  });

  it("what the person can do on their own is said to everybody alike", () => {
    for (const canFix of [true, false]) {
      expect(assistantFailureMessage(failure("context_length"), canFix)).toBe(CONVERSATION_TOO_LONG);
      expect(assistantFailureMessage(failure("step_limit"), canFix)).toBe(COULD_NOT_FINISH);
      expect(assistantFailureMessage(failure("moderation"), canFix)).toMatch(/Prueba a escribirlo de otra forma/);
      expect(assistantFailureMessage(failure("timeout", true), canFix)).toMatch(/Pulsa «Reintentar»/);
      // The model answered nothing: worth another try, whatever the layer below called it.
      expect(assistantFailureMessage(failure("empty_response", true), canFix)).toBe(TRY_AGAIN);
    }
  });

  it("never offers a person to hand the conversation to, nor a setting the person cannot reach [INT-07]", () => {
    for (const reason of [...OPENROUTER_ERROR_CODES, "step_limit"]) {
      for (const retryable of [true, false]) {
        const text = assistantFailureMessage(failure(reason, retryable, "La conversación pasa a una persona. Revísala en Ajustes > IA."), false);
        expect(text).not.toMatch(/persona|Ajustes|6 pasos|longitud máxima|Elige otro/);
      }
    }
  });
});
