"use server";
// Sign-in with email and password ([USU-01], [USU-02], [USU-11], [USU-13], [USU-14]). Better Auth checks the
// password; this action adds the rate limits, the activity log and where to go next.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fail, fromZodError, type ActionResult } from "@/lib/action-result";
import { sanitizeNextPath, twoFactorPathFor } from "@/lib/auth-paths";
import { auth } from "@/server/auth";
import { INVALID_CREDENTIALS_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE } from "../_lib/messages";
import { signInSchema } from "../_lib/schemas";
import { authErrorCode, completeSignIn, recordFailedSignIn } from "../_lib/sign-in";
import { clientIp, emailSubject, resetLimit, withinLimits } from "../_lib/throttle";

export async function signInAction(input: unknown): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { email, password } = parsed.data;
  const next = sanitizeNextPath(parsed.data.next);
  const requestHeaders = await headers();
  const emailKey = emailSubject(email);
  if (!(await withinLimits(["signInPerIp", clientIp(requestHeaders)], ["signInPerEmail", emailKey]))) {
    return fail(TOO_MANY_ATTEMPTS_MESSAGE);
  }

  let result: Awaited<ReturnType<typeof auth.api.signInEmail>>;
  try {
    result = await auth.api.signInEmail({ body: { email, password }, headers: requestHeaders });
  } catch (error) {
    if (authErrorCode(error) === null) throw error;
    // Same answer whether the email exists or the password is wrong ([USU-01]).
    await recordFailedSignIn("invalid_credentials", email);
    return fail(INVALID_CREDENTIALS_MESSAGE);
  }
  // The password was right: the «wrong passwords in a row» count for this email starts again.
  await resetLimit("signInPerEmail", emailKey);

  // With 2FA Better Auth opens no session yet: it leaves a short-lived cookie for /dos-pasos ([USU-11]).
  if ("twoFactorRedirect" in result && result.twoFactorRedirect) redirect(twoFactorPathFor(next));

  const outcome = await completeSignIn({ userId: result.user.id, next, twoFactor: false });
  if (!outcome.ok) return fail(outcome.error);
  redirect(outcome.destination);
}
