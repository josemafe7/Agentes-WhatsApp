// «Exigir verificación en dos pasos a propietario y administradores» ([USU-12]). While it is on, an owner or
// admin without 2FA can only use Mi cuenta (/perfil) until they set it up. Pages and actions already refuse
// through requirePageActor/requireActor (src/server/session.ts); this adds the check for the (app) layout,
// which does not know the page it wraps: the proxy forwards the requested path in a request header.
import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadBusinessSettings } from "@/data/settings";
import { loginPathFor, pathnameOf, PROFILE_PATH, REQUEST_PATH_HEADER } from "@/lib/auth-paths";
import type { Actor } from "@/lib/permissions";
import { getActor, TWO_FACTOR_SETUP_PATH, type SessionActor } from "./session";

/** Roles that must use 2FA when the business requires it. */
const ROLES_WITH_REQUIRED_TWO_FACTOR: ReadonlySet<Actor["role"]> = new Set(["owner", "admin"]);

/** Whether the business currently requires 2FA for this person's role (so it cannot be turned off). */
export async function isTwoFactorRequiredFor(actor: Actor): Promise<boolean> {
  if (!ROLES_WITH_REQUIRED_TWO_FACTOR.has(actor.role)) return false;
  return (await loadBusinessSettings()).require2faAdmins;
}

/**
 * For the (app) layout, instead of requireActor(): the signed-in actor, or a redirect to /login (coming back
 * afterwards, [USU-02]); owners and admins who must set up 2FA go to Mi cuenta from any other page
 * ([USU-12]). If the path header is missing the check fails closed and redirects.
 */
export async function requireTwoFactorCompliance(): Promise<SessionActor> {
  const requestedPath = (await headers()).get(REQUEST_PATH_HEADER);
  const actor = await getActor();
  if (!actor) redirect(loginPathFor(requestedPath));
  if (actor.twoFactorSetupRequired && pathnameOf(requestedPath) !== PROFILE_PATH) redirect(TWO_FACTOR_SETUP_PATH);
  return actor;
}
