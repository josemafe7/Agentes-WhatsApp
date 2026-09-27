// Expected errors of the server layers, each with a generic Spanish message that is safe to show ([SEG-14]).
// Server Actions turn them into an ActionResult (toActionFailure); route handlers into a JSON response.
import "server-only";
import { z } from "zod";
import { fail, type ActionFailure } from "@/lib/action-result";
import { safeErrorMessage } from "./redact";
import { storableJson } from "./storable-text";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Spanish, generic, safe for the user. */
    readonly userMessage: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(userMessage);
    this.name = new.target.name;
  }
}

/** 401 without a valid session; 403 without permission, when disabled, or when 2FA setup is required. */
export class AuthError extends AppError {
  constructor(code: "unauthenticated" | "forbidden" | "two_factor_required") {
    const messages = {
      unauthenticated: "Tu sesión ha caducado. Vuelve a entrar.",
      forbidden: "No tienes permiso para hacer esto.",
      two_factor_required: "Activa la verificación en dos pasos para seguir.",
    } as const;
    super(code === "unauthenticated" ? 401 : 403, code, messages[code]);
  }
}

/** 403 for a business rule with its own explanation (e.g. «El propietario no se puede borrar»). */
export class ForbiddenError extends AppError {
  constructor(message = "No tienes permiso para hacer esto.") {
    super(403, "forbidden", message);
  }
}

/** 410: a one-time link (invitation) that was used, revoked or has expired ([USU-08]). */
export class LinkUnavailableError extends AppError {
  constructor(
    readonly reason: "not_found" | "expired" | "used" | "revoked",
    message = "Esta invitación ya no es válida. Pide una nueva al propietario.",
  ) {
    super(410, "link_unavailable", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "No se ha encontrado.") {
    super(404, "not_found", message);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Revisa los campos marcados.", fieldErrors?: Record<string, string[]>) {
    super(400, "invalid", message, fieldErrors);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "conflict", message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Demasiados intentos. Espera unos minutos.") {
    super(429, "rate_limited", message);
  }
}

/**
 * Validates untrusted input with Zod or throws a ValidationError with the messages of each field ([SEG-05]). The input
 * is made storable first (src/server/storable-text.ts): a NUL character pasted into any form never makes the save fail.
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(storableJson(input));
  if (result.success) return result.data;
  const { fieldErrors, formErrors } = z.flattenError(result.error);
  const cleaned: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors as Record<string, string[] | undefined>)) {
    if (messages?.length) cleaned[field] = messages;
  }
  if (formErrors.length) cleaned._form = formErrors;
  throw new ValidationError(undefined, Object.keys(cleaned).length ? cleaned : undefined);
}

/** For Server Actions: expected errors become a failure result; unexpected ones are re-thrown (error.tsx). */
export function toActionFailure(error: unknown): ActionFailure {
  if (error instanceof AppError) return fail(error.userMessage, error.fieldErrors);
  throw error;
}

/** For route handlers: JSON error with the right status and never internal details. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.userMessage, code: error.code }, { status: error.status });
  }
  console.error(`[api] Error inesperado: ${safeErrorMessage(error)}`);
  return Response.json({ error: "Algo ha fallado. Inténtalo de nuevo." }, { status: 500 });
}
