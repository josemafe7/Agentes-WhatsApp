// The active people of the team as actors (role and, for agents, their channels), for system decisions such as who
// receives a notice or a hand-off ([TRA-04], [TRA-05], [PWA-08]). Deactivated users are never included ([USU-14]).
import "server-only";
import { asc, eq, isNull } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { channelMembers, user, userRoles, type NotificationPreferences } from "@/db/schema";
import { isRole, type Actor } from "@/lib/permissions";

export type TeamMember = Actor & { email: string; notificationPreferences: NotificationPreferences; since: Date };

/** Every active user, oldest first (a stable order for round robin). Small teams: one query each. */
export async function listActiveTeam(executor: Executor = db): Promise<TeamMember[]> {
  const rows = await executor
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: userRoles.role,
      notificationPreferences: userRoles.notificationPreferences,
      since: userRoles.createdAt,
    })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(isNull(userRoles.disabledAt))
    .orderBy(asc(userRoles.createdAt), asc(user.id));
  const members = await executor.select({ userId: channelMembers.userId, channelId: channelMembers.channelId }).from(channelMembers);
  const channelsByUser = new Map<string, string[]>();
  for (const row of members) channelsByUser.set(row.userId, [...(channelsByUser.get(row.userId) ?? []), row.channelId]);
  return rows
    .filter((row) => isRole(row.role))
    .map((row) => ({
      ...row,
      // An agent without channel rows sees every channel ([PER-02]).
      channelIds: row.role === "agent" ? (channelsByUser.get(row.userId) ?? null) : null,
    }));
}
