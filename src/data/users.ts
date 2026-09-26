// Settings › Usuarios: list, roles, agent channels, deactivate, delete, 2FA requirement and ownership
// transfer ([AJU-02], [USU-12], [USU-14], [USU-16], [USU-17], [PER-05], [PER-06]).
import "server-only";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { account, businessSettings, channelMembers, channels, session, user, userRoles } from "@/db/schema";
import { ROLES, type ChannelType, type Role } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { CREDENTIAL_PROVIDER_ID, deleteUserAccount, revokeUserSessions } from "@/server/accounts";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { ForbiddenError, NotFoundError, parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabledAt: Date | null;
  isDemo: boolean;
  twoFactorEnabled: boolean;
  /** Agent channels; empty = all channels. */
  channelIds: string[];
  lastSeenAt: Date | null;
  createdAt: Date;
};

const TRANSFER_ATTEMPTS = 5;
const TRANSFER_WINDOW_MS = 15 * 60_000;

const userIdInput = z.string().trim().min(1, "Falta el usuario.").max(100);
const channelIdsInput = z.array(z.string().trim().min(1).max(100)).max(500);

type Target = { id: string; role: Role; disabledAt: Date | null };

async function loadTarget(userId: string, executor: Executor = db): Promise<Target> {
  const [row] = await executor
    .select({ id: user.id, role: userRoles.role, disabledAt: userRoles.disabledAt })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.id, userId));
  if (!row) throw new NotFoundError("Ese usuario no existe.");
  return row;
}

/** Permission on a concrete user: admins never act on the owner ([PER-05]). */
function assertCanManage(actor: Actor, target: Target, newRole?: Role): void {
  assertCan(actor, PERMISSIONS.settings.users, { targetUserId: target.id, targetRole: target.role, newRole });
}

async function assertChannelsExist(executor: Executor, channelIds: string[]): Promise<void> {
  if (channelIds.length === 0) return;
  const found = await executor.select({ id: channels.id }).from(channels).where(inArray(channels.id, channelIds));
  if (found.length !== new Set(channelIds).size) throw new ValidationError("Alguno de los canales elegidos no existe.");
}

async function replaceChannels(executor: Executor, userId: string, channelIds: string[]): Promise<void> {
  await executor.delete(channelMembers).where(eq(channelMembers.userId, userId));
  const unique = [...new Set(channelIds)];
  if (unique.length > 0) await executor.insert(channelMembers).values(unique.map((channelId) => ({ userId, channelId })));
}

/** Team list for Settings › Usuarios (owner and admin). */
export async function listUsers(actor: Actor): Promise<TeamMember[]> {
  assertCan(actor, PERMISSIONS.settings.users);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      role: userRoles.role,
      disabledAt: userRoles.disabledAt,
      isDemo: userRoles.isDemo,
    })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .orderBy(user.name);
  const memberships = await db.select({ userId: channelMembers.userId, channelId: channelMembers.channelId }).from(channelMembers);
  const lastSeen = await db.select({ userId: session.userId, at: max(session.updatedAt) }).from(session).groupBy(session.userId);
  return rows.map((row) => ({
    ...row,
    twoFactorEnabled: row.twoFactorEnabled === true,
    channelIds: memberships.filter((m) => m.userId === row.id).map((m) => m.channelId),
    lastSeenAt: lastSeen.find((s) => s.userId === row.id)?.at ?? null,
  }));
}

export type ChannelOption = { id: string; name: string; type: ChannelType };

/** Channels to choose from when inviting an Agent or editing their channels ([USU-05], [USU-17]). */
export async function listChannelOptions(actor: Actor): Promise<ChannelOption[]> {
  assertCan(actor, PERMISSIONS.settings.users);
  return db.select({ id: channels.id, name: channels.name, type: channels.type }).from(channels).orderBy(channels.name);
}

export const changeRoleSchema = z.object({
  userId: userIdInput,
  role: z.enum(ROLES, { error: "Elige un rol de la lista." }),
  /** Only for the Agent role; omitted = keep the current channels. */
  channelIds: channelIdsInput.optional(),
});

/** Changes someone's role; applies from their next request ([USU-14]). Never the own role or the owner's. */
export async function changeRole(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(changeRoleSchema, input);
  const target = await loadTarget(data.userId);
  assertCanManage(actor, target, data.role);
  if (target.id === actor.userId) throw new ForbiddenError("No puedes cambiar tu propio rol.");
  // There is always exactly one owner: that role only changes hands with the transfer ([USU-16]).
  if (target.role === "owner") throw new ForbiddenError("El rol del propietario solo cambia al traspasar la propiedad.");
  await db.transaction(async (tx) => {
    if (data.role === "agent" && data.channelIds) await assertChannelsExist(tx, data.channelIds);
    await tx.update(userRoles).set({ role: data.role }).where(eq(userRoles.userId, target.id));
    if (data.role !== "agent") await replaceChannels(tx, target.id, []);
    else if (data.channelIds) await replaceChannels(tx, target.id, data.channelIds);
    await writeAudit(
      { actor, action: "user.role_changed", targetType: "user", targetId: target.id, metadata: { from: target.role, to: data.role } },
      tx,
    );
  });
}

export const setAgentChannelsSchema = z.object({ userId: userIdInput, channelIds: channelIdsInput });

/** Channels of a user with the Agent role; empty = all channels ([USU-17], [PER-02]). */
export async function setAgentChannels(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(setAgentChannelsSchema, input);
  const target = await loadTarget(data.userId);
  assertCanManage(actor, target);
  if (target.role !== "agent") throw new ValidationError("Solo se eligen canales para el rol Agente.");
  await db.transaction(async (tx) => {
    await assertChannelsExist(tx, data.channelIds);
    await replaceChannels(tx, target.id, data.channelIds);
    await writeAudit(
      { actor, action: "user.channels_changed", targetType: "user", targetId: target.id, metadata: { channels: data.channelIds.length } },
      tx,
    );
  });
}

export const setUserDisabledSchema = z.object({ userId: userIdInput, disabled: z.boolean() });

/** Deactivates (signing them out everywhere at once) or reactivates a user ([USU-14]). */
export async function setUserDisabled(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(setUserDisabledSchema, input);
  const target = await loadTarget(data.userId);
  assertCanManage(actor, target);
  if (target.role === "owner") throw new ForbiddenError("El propietario no se puede desactivar.");
  if (target.id === actor.userId) throw new ForbiddenError("No puedes desactivar tu propia cuenta.");
  await db.transaction(async (tx) => {
    await tx.update(userRoles).set({ disabledAt: data.disabled ? new Date() : null }).where(eq(userRoles.userId, target.id));
    if (data.disabled) await revokeUserSessions(tx, target.id);
    await writeAudit(
      { actor, action: data.disabled ? "user.disabled" : "user.enabled", targetType: "user", targetId: target.id },
      tx,
    );
  });
}

/** Deletes a user (test users too, [ARR-20]); their messages, notes and bookings keep the name ([USU-15]). */
export async function removeUser(actor: Actor, input: unknown): Promise<void> {
  const { userId } = parseInput(z.object({ userId: userIdInput }), input);
  const target = await loadTarget(userId);
  assertCanManage(actor, target);
  if (target.role === "owner") throw new ForbiddenError("El propietario no se puede borrar.");
  if (target.id === actor.userId) throw new ForbiddenError("No puedes borrar tu propia cuenta.");
  await db.transaction(async (tx) => {
    await deleteUserAccount(tx, target.id);
    // Without personal data: the id only.
    await writeAudit({ actor, action: "user.removed", targetType: "user", targetId: target.id, metadata: { role: target.role } }, tx);
  });
}

export const transferOwnershipSchema = z.object({
  toUserId: userIdInput,
  password: z.string().min(1, "Escribe tu contraseña.").max(128),
});

/**
 * Owner only, confirming with their password: the other user becomes owner and the current owner becomes
 * admin, in one transaction so there is always exactly one owner ([USU-16], [PER-06]).
 */
export async function transferOwnership(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.transferOwnership);
  const data = parseInput(transferOwnershipSchema, input);
  const limit = await getRateLimiter().hit(`transfer-ownership:${actor.userId}`, TRANSFER_ATTEMPTS, TRANSFER_WINDOW_MS);
  if (!limit.allowed) throw new RateLimitError();
  const [credential] = await db
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, actor.userId), eq(account.providerId, CREDENTIAL_PROVIDER_ID)));
  if (!credential?.hash || !(await verifyPassword({ hash: credential.hash, password: data.password }))) {
    throw new ValidationError("La contraseña no es correcta.", { password: ["La contraseña no es correcta."] });
  }
  if (data.toUserId === actor.userId) throw new ValidationError("Elige a otra persona del equipo.");
  const target = await loadTarget(data.toUserId);
  if (target.disabledAt) throw new ValidationError("Esa persona está desactivada: reactívala antes.");
  await db.transaction(async (tx) => {
    await tx.update(userRoles).set({ role: "owner" }).where(eq(userRoles.userId, target.id));
    await replaceChannels(tx, target.id, []);
    await tx.update(userRoles).set({ role: "admin" }).where(eq(userRoles.userId, actor.userId));
    await writeAudit(
      { actor, action: "user.ownership_transferred", targetType: "user", targetId: target.id, metadata: { from: target.role } },
      tx,
    );
  });
}

/** «Exigir verificación en dos pasos a propietario y administradores» ([USU-12]); off by default. */
export async function setRequireTwoFactor(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.settings.users);
  const { enabled } = parseInput(z.object({ enabled: z.boolean() }), input);
  const settings = await loadBusinessSettings();
  await db.update(businessSettings).set({ require2faAdmins: enabled }).where(eq(businessSettings.id, settings.id));
  await writeAudit({ actor, action: "settings.require_2fa_changed", targetType: "business_settings", targetId: settings.id, metadata: { enabled } });
}
