"use server";
// Second step of the sign-in: the code of the authenticator app or a backup code ([USU-11]). Better Auth
// checks it against the short-lived cookie left by the password step; this action adds the IP limit, the
// activity log and where to go next.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fail, fromZodError, type ActionResult } from "@/lib/action-result";
import { sanitizeNextPath } from "@/lib/auth-paths";
import { auth } from "@/server/auth";
import {
  TOO_MANY_ATTEMPTS_MESSAGE,
  TWO_FACTOR_EXPIRED_MESSAGE,
  TWO_FACTOR_INVALID_BACKUP_MESSAGE,
  TWO_FACTOR_INVALID_CODE_MESSAGE,
} from "../_lib/messages";
import { twoFactorVerifySchema } from "../_lib/schemas";
import { authErrorCode, completeSignIn, recordFailedSignIn } from "../_lib/sign-in";
import { clientIp, withinLimits } from "../_lib/throttle";

/** Better Auth's error codes of a wrong code; anything else means the challenge is gone. */
const WRONG_CODE_MESSAGES: Record<string, string> = {
  INVALID_CODE: TWO_FACTOR_INVALID_CODE_MESSAGE,
  INVALID_BACKUP_CODE: TWO_FACTOR_INVALID_BACKUP_MESSAGE,
};

export async function verifyTwoFactorAction(input: unknown): Promise<ActionResult> {
  const parsed = twoFactorVerifySchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { method, code } = parsed.data;
  const next = sanitizeNextPath(parsed.data.next);
  const requestHeaders = await headers();
  if (!(await withinLimits(["twoFactorPerIp", clientIp(requestHeaders)]))) return fail(TOO_MANY_ATTEMPTS_MESSAGE);

  let result: { user: { id: string } };
  try {
    result =
      method === "totp"
        ? await auth.api.verifyTOTP({ body: { code }, headers: requestHeaders })
        : await auth.api.verifyBackupCode({ body: { code }, headers: requestHeaders });
  } catch (error) {
    const errorCode = authErrorCode(error);
    if (errorCode === null) throw error;
    const wrongCode = WRONG_CODE_MESSAGES[errorCode];
    if (wrongCode) {
      await recordFailedSignIn("two_factor_invalid");
      return fail(wrongCode);
    }
    // Better Auth locks the account for a while after 10 wrong codes in a row.
    if (errorCode === "ACCOUNT_TEMPORARILY_LOCKED") return fail(TOO_MANY_ATTEMPTS_MESSAGE);
    // No cookie, expired challenge (10 min) or more than 5 codes for this sign-in.
    return fail(TWO_FACTOR_EXPIRED_MESSAGE);
  }

  const outcome = await completeSignIn({ userId: result.user.id, next, twoFactor: true });
  if (!outcome.ok) return fail(outcome.error);
  redirect(outcome.destination);
}
