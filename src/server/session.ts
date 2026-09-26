// Who is asking, checked on the server in every page, Server Action and route ([SEG-04]). The actor (role,
// agent channels, 2FA state) is read from the database on every request, so role changes, deactivation and
// deletion apply at once ([USU-14]). The proxy only redirects cheaply; this is the security boundary.
import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { channelMembers, user, userRoles } from "@/db/schema";
import { loginPathFor, PROFILE_PATH, TWO_FACTOR_REQUIRED_QUERY } from "@/lib/auth-paths";
import { can, isRole, type Action, type Actor, type PermissionScope } from "@/lib/permissions";
import { auth } from "./auth";
import { AuthError } from "./errors";

export { AuthError } from "./errors";

export type SessionActor = Actor & {
  email: string;
  sessionId: string;
  isDemo: boolean;
  twoFactorEnabled: boolean;
  /** Owner/admin without 2FA while «Exigir verificación en dos pasos» is on ([USU-12]): only Mi cuenta works. */
  twoFactorSetupRequired: boolean;
};

/** Where owners and admins set up 2FA when it is required ([USU-12], docs/pantallas.md «Mi cuenta»). */
export const TWO_FACTOR_SETUP_PATH = `${PROFILE_PATH}?${TWO_FACTOR_REQUIRED_QUERY}`;

type SessionData = { session: { id: string }; user: { id: string } } | null;

/** Builds the actor of a Better Auth session. Null when there is no session or the user is deactivated. */
export async function resolveActor(sessionData: SessionData): Promise<SessionActor | null> {
  if (!sessionData) return null;
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
      role: userRoles.role,
      disabledAt: userRoles.disabledAt,
      isDemo: userRoles.isDemo,
    })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.id, sessionData.user.id));
  // If anything is off (no role row, deactivated, unknown role) access is denied.
  if (!row || row.disabledAt || !isRole(row.role)) return null;
  let channelIds: string[] | null = null;
  if (row.role === "agent") {
    const rows = await db.select({ channelId: channelMembers.channelId }).from(channelMembers).where(eq(channelMembers.userId, row.id));
    // No channel rows: the agent sees every channel ([PER-02]).
    channelIds = rows.length > 0 ? rows.map((r) => r.channelId) : null;
  }
  const settings = await loadBusinessSettings();
  const twoFactorEnabled = row.twoFactorEnabled === true;
  return {
    userId: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    channelIds,
    sessionId: sessionData.session.id,
    isDemo: row.isDemo,
    twoFactorEnabled,
    twoFactorSetupRequired: settings.require2faAdmins && (row.role === "owner" || row.role === "admin") && !twoFactorEnabled,
  };
}

/** The signed-in actor of this request, or null. Deduplicated per request. */
export const getActor = cache(async (): Promise<SessionActor | null> => {
  const sessionData = await auth.api.getSession({ headers: await headers() });
  return resolveActor(sessionData);
});

/**
 * For pages: the actor, or a redirect to /login (coming back to `next` afterwards, [USU-02]); owners and admins
 * who must set up 2FA go to Mi cuenta unless the page allows it.
 */
export async function requirePageActor(options: { next?: string; allowTwoFactorSetup?: boolean } = {}): Promise<SessionActor> {
  const actor = await getActor();
  // Only a safe in-app path survives as the return target (sanitizeNextPath in src/lib/auth-paths.ts).
  if (!actor) redirect(loginPathFor(options.next));
  if (actor.twoFactorSetupRequired && !options.allowTwoFactorSetup) redirect(TWO_FACTOR_SETUP_PATH);
  return actor;
}

/** For Server Actions and route handlers: the actor, or AuthError (401 without session, 403 if 2FA is due). */
export async function requireActor(options: { allowTwoFactorSetup?: boolean } = {}): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) throw new AuthError("unauthenticated");
  if (actor.twoFactorSetupRequired && !options.allowTwoFactorSetup) throw new AuthError("two_factor_required");
  return actor;
}

/** requireActor() plus the permission check; AuthError("forbidden") (403) without it. */
export async function requirePermission(action: Action, scope?: PermissionScope): Promise<SessionActor> {
  const actor = await requireActor();
  if (!can(actor, action, scope)) throw new AuthError("forbidden");
  return actor;
}
