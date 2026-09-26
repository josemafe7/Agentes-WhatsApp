"use server";
// «¿Has olvidado tu contraseña?» ([USU-10]): always the same answer, whether the email has an account or not.
// Better Auth queues the email with a one-time link that comes back to /restablecer.
import { headers } from "next/headers";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { RESET_PASSWORD_PATH } from "@/lib/auth-paths";
import { auth } from "@/server/auth";
import { RESET_REQUESTED_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE } from "../_lib/messages";
import { recoverPasswordSchema } from "../_lib/schemas";
import { authErrorCode } from "../_lib/sign-in";
import { clientIp, emailSubject, withinLimits } from "../_lib/throttle";

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  const parsed = recoverPasswordSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { email } = parsed.data;
  const requestHeaders = await headers();
  // The same limits apply to every email, so hitting them says nothing about whether it has an account.
  if (!(await withinLimits(["resetRequestPerIp", clientIp(requestHeaders)], ["resetRequestPerEmail", emailSubject(email)]))) {
    return fail(TOO_MANY_ATTEMPTS_MESSAGE);
  }
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: RESET_PASSWORD_PATH }, headers: requestHeaders });
  } catch (error) {
    // A refusal of Better Auth must not become a different answer ([USU-10]); unexpected errors go up.
    const code = authErrorCode(error);
    if (code === null) throw error;
    console.warn(`[auth] No se ha podido preparar el enlace de recuperación (${code}).`);
  }
  return ok(undefined, RESET_REQUESTED_MESSAGE);
}
