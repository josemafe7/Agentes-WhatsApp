"use server";
// Accepting an invitation ([USU-07], [USU-08]): creates the account with the invitation's role (src/data/
// invitations.ts) and signs the new user in with the password just chosen.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvitation } from "@/data/invitations";
import { fail, fromZodError, type ActionResult } from "@/lib/action-result";
import { LOGIN_PATH } from "@/lib/auth-paths";
import { auth } from "@/server/auth";
import { toActionFailure } from "@/server/errors";
import { TOO_MANY_ATTEMPTS_MESSAGE } from "../../_lib/messages";
import { acceptInvitationFormSchema } from "../../_lib/schemas";
import { authErrorCode, completeSignIn } from "../../_lib/sign-in";
import { clientIp, withinLimits } from "../../_lib/throttle";

export async function acceptInvitationAction(input: unknown): Promise<ActionResult> {
  const parsed = acceptInvitationFormSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { token, name, password } = parsed.data;
  const requestHeaders = await headers();
  if (!(await withinLimits(["invitationPerIp", clientIp(requestHeaders)]))) return fail(TOO_MANY_ATTEMPTS_MESSAGE);

  let account: { userId: string; email: string };
  try {
    account = await acceptInvitation({ token, name, password });
  } catch (error) {
    // Used, revoked or expired link, email already in use or invalid data: explained; anything else goes up.
    return toActionFailure(error);
  }

  try {
    await auth.api.signInEmail({ body: { email: account.email, password }, headers: requestHeaders });
  } catch (error) {
    if (authErrorCode(error) === null) throw error;
    // The account exists already: the person can sign in by hand.
    redirect(LOGIN_PATH);
  }
  // A brand-new account has no 2FA yet; if the role must set it up, completeSignIn sends to Mi cuenta ([USU-12]).
  const outcome = await completeSignIn({ userId: account.userId, twoFactor: false });
  if (!outcome.ok) return fail(outcome.error);
  redirect(outcome.destination);
}
