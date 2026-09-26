// Result returned by Server Actions: expected errors are returned (never thrown) with a generic Spanish message.
import { z } from "zod";

/** Successful action, with optional data and a message for the user. */
export type ActionSuccess<T = void> = { ok: true; data?: T; message?: string };
/** Failed action: generic error for the user plus per-field messages for forms. */
export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string[]> };
/** What every Server Action returns. */
export type ActionResult<T = void> = ActionSuccess<T> | ActionFailure;

const INVALID_FIELDS_MESSAGE = "Revisa los campos marcados.";

/** Success result: ok(data?, message?). */
export function ok<T = void>(data?: T, message?: string): ActionSuccess<T> {
  return {
    ok: true,
    ...(data !== undefined ? { data } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}

/** Failure result with a user-facing (generic, Spanish) message; never pass error.message or stack traces. */
export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionFailure {
  return { ok: false, error, ...(fieldErrors ? { fieldErrors } : {}) };
}

/** Failure result from a Zod validation error, with the messages of each invalid field. */
export function fromZodError(error: z.ZodError, message: string = INVALID_FIELDS_MESSAGE): ActionFailure {
  const { fieldErrors } = z.flattenError(error);
  const cleaned: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors as Record<string, string[] | undefined>)) {
    if (messages && messages.length > 0) cleaned[field] = messages;
  }
  return fail(message, Object.keys(cleaned).length > 0 ? cleaned : undefined);
}
