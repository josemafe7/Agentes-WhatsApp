// What every sign-in path does once Better Auth has checked the password (and the code, with 2FA): keep
// deactivated users out, write the «entrada» to the activity log and choose where to go next.
import "server-only";
import { isAPIError } from "better-auth/api";
import { writeAudit } from "@/data/audit";
import { getSetupStatus } from "@/data/setup";
import { HOME_PATH, sanitizeNextPath, SETUP_PATH } from "@/lib/auth-paths";
import { auth } from "@/server/auth";
import { resolveActor, TWO_FACTOR_SETUP_PATH, type SessionActor } from "@/server/session";
import { ACCOUNT_DISABLED_MESSAGE } from "./messages";

export type FailedSignInReason = "invalid_credentials" | "two_factor_invalid";
export type SignInOutcome = { ok: true; destination: string } | { ok: false; error: string };

/** Better Auth's error code of a failed auth.api.* call; null when the error is not Better Auth's (re-throw it). */
export function authErrorCode(error: unknown): string | null {
  if (!isAPIError(error)) return null;
  const code = error.body?.code;
  return typeof code === "string" ? code : "UNKNOWN";
}

/** Role, deactivation and 2FA state of someone who has just proved who they are (no session id needed). */
async function actorOf(userId: string): Promise<SessionActor | null> {
  return resolveActor({ session: { id: "" }, user: { id: userId } });
}

/**
 * After Better Auth created the session: a deactivated user (or one without a role) is signed out again
 * ([USU-14]); anyone else is logged in the activity log ([SEG-10]) and goes to `next`, or to Mi cuenta when
 * their role must set up 2FA first ([USU-12]), or, for the owner of an unfinished installation, back to the
 * first pending step of the setup wizard ([ASI-11]).
 */
export async function completeSignIn(params: { userId: string; next?: string | null; twoFactor: boolean }): Promise<SignInOutcome> {
  const actor = await actorOf(params.userId);
  if (!actor) {
    // Every session of a deactivated user goes, not only the one just opened.
    const context = await auth.$context;
    await context.internalAdapter.deleteUserSessions(params.userId);
    await writeAudit({ actor: "system", action: "auth.login_blocked", targetType: "user", targetId: params.userId, metadata: { reason: "disabled" } });
    return { ok: false, error: ACCOUNT_DISABLED_MESSAGE };
  }
  await writeAudit({ actor, action: "auth.login", targetType: "user", targetId: actor.userId, metadata: { twoFactor: params.twoFactor } });
  if (actor.twoFactorSetupRequired) return { ok: true, destination: TWO_FACTOR_SETUP_PATH };
  if (actor.role === "owner" && !(await getSetupStatus()).completed) return { ok: true, destination: SETUP_PATH };
  return { ok: true, destination: sanitizeNextPath(params.next) ?? HOME_PATH };
}

/** False on an empty installation: then every page leads to the setup wizard ([ASI-01]). */
export async function hasAnyAccount(): Promise<boolean> {
  const context = await auth.$context;
  return (await context.internalAdapter.countTotalUsers()) > 0;
}

/**
 * Failed sign-in in the activity log ([SEG-10]): the account it was for when the email has one, and why.
 * Never the password, and not the typed email (personal data of whoever typed it).
 */
export async function recordFailedSignIn(reason: FailedSignInReason, email?: string): Promise<void> {
  let userId: string | null = null;
  if (email) {
    const context = await auth.$context;
    userId = (await context.internalAdapter.findUserByEmail(email))?.user.id ?? null;
  }
  await writeAudit({
    actor: "system",
    action: "auth.login_failed",
    ...(userId ? { targetType: "user", targetId: userId } : {}),
    metadata: { reason },
  });
}
