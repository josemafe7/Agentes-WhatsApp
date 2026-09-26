"use server";
// New password from the one-time link of the reset email ([USU-10]). Better Auth consumes the token and
// closes every session of the account; the person then signs in with the new password.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fail, fromZodError, type ActionResult } from "@/lib/action-result";
import { LOGIN_PATH } from "@/lib/auth-paths";
import { auth } from "@/server/auth";
import { RESET_LINK_INVALID_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE, type LoginNotice } from "../_lib/messages";
import { resetPasswordSchema } from "../_lib/schemas";
import { authErrorCode } from "../_lib/sign-in";
import { clientIp, withinLimits } from "../_lib/throttle";

const PASSWORD_CHANGED: LoginNotice = "contrasena-cambiada";

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { token, password } = parsed.data;
  const requestHeaders = await headers();
  if (!(await withinLimits(["resetPasswordPerIp", clientIp(requestHeaders)]))) return fail(TOO_MANY_ATTEMPTS_MESSAGE);
  try {
    await auth.api.resetPassword({ body: { token, newPassword: password }, headers: requestHeaders });
  } catch (error) {
    if (authErrorCode(error) === null) throw error;
    // Unknown, expired or already used: the page offers «Pedir otro».
    return fail(RESET_LINK_INVALID_MESSAGE);
  }
  redirect(`${LOGIN_PATH}?aviso=${PASSWORD_CHANGED}`);
}
