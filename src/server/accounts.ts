// Team accounts outside Better Auth's endpoints: public sign-up is closed (disableSignUp also blocks
// auth.api.signUpEmail), so the setup wizard, invitation acceptance and the seed create users here, with the
// same password hash Better Auth verifies ([USU-03], docs/decisions/0004).
import "server-only";
import { hashPassword } from "better-auth/crypto";
import { count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import {
  account,
  channelMembers,
  channels,
  conversations,
  notifications,
  pushSubscriptions,
  session,
  twoFactor,
  user,
  userRoles,
} from "@/db/schema";
import { ROLES, type Role } from "@/lib/enums";
import { emailSchema, passwordSchema, personNameSchema } from "@/lib/validation";
import { ConflictError, parseInput, ValidationError } from "./errors";

/** Better Auth's provider id for email + password accounts. */
export const CREDENTIAL_PROVIDER_ID = "credential";

export class EmailInUseError extends ConflictError {
  constructor() {
    super("Ese email ya tiene una cuenta.");
  }
}

export const newUserSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
  /** Agent role only: channels they are limited to; empty = all channels ([PER-02]). */
  channelIds: z.array(z.string().min(1)).max(500).default([]),
  isDemo: z.boolean().default(false),
});
export type NewUserInput = z.input<typeof newUserSchema>;

/** Hash of a new password (validated first). Do it before opening a transaction: it takes tens of ms of CPU. */
export async function hashNewPassword(password: string): Promise<string> {
  return hashPassword(parseInput(passwordSchema, password));
}

export type UserRecord = { name: string; email: string; passwordHash: string; role: Role; channelIds?: string[]; isDemo?: boolean };

/**
 * Inserts user + credential account + role (+ agent channels) with `executor`, normally inside the caller's
 * transaction. `email` must already be normalised (lower case). Throws EmailInUseError if it exists.
 */
export async function insertUserWithPassword(executor: Executor, record: UserRecord): Promise<{ userId: string }> {
  const [existing] = await executor.select({ id: user.id }).from(user).where(eq(user.email, record.email));
  if (existing) throw new EmailInUseError();
  const channelIds = record.role === "agent" ? [...new Set(record.channelIds ?? [])] : [];
  if (channelIds.length > 0) {
    const found = await executor.select({ id: channels.id }).from(channels).where(inArray(channels.id, channelIds));
    if (found.length !== channelIds.length) throw new ValidationError("Alguno de los canales elegidos no existe.");
  }
  const userId = crypto.randomUUID();
  const now = new Date();
  await executor.insert(user).values({
    id: userId,
    name: record.name,
    email: record.email,
    // The address is confirmed: the invitation reached it, or the owner typed it in the wizard.
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await executor.insert(account).values({
    userId,
    accountId: userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    password: record.passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  await executor.insert(userRoles).values({ userId, role: record.role, isDemo: record.isDemo ?? false });
  if (channelIds.length > 0) {
    await executor.insert(channelMembers).values(channelIds.map((channelId) => ({ userId, channelId })));
  }
  return { userId };
}

/** Creates a user with a password and a role (seed and server code). Validates everything first. */
export async function createUserWithPassword(input: NewUserInput): Promise<{ userId: string; email: string }> {
  const data = parseInput(newUserSchema, input);
  const passwordHash = await hashPassword(data.password);
  const { userId } = await db.transaction((tx) =>
    insertUserWithPassword(tx, { ...data, passwordHash }),
  );
  return { userId, email: data.email };
}

export const firstOwnerSchema = z.object({ name: personNameSchema, email: emailSchema, password: passwordSchema });

/**
 * Setup wizard step 1 ([ASI-02]): creates the owner only while the installation has no users. The check and
 * the insert run in one write transaction, so two people trying at once cannot both succeed.
 */
export async function createFirstOwner(input: z.input<typeof firstOwnerSchema>): Promise<{ userId: string; email: string }> {
  const data = parseInput(firstOwnerSchema, input);
  const passwordHash = await hashPassword(data.password);
  const { userId } = await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(user);
    if (n > 0) throw new ConflictError("Esta instalación ya tiene propietario. Entra con tu cuenta.");
    return insertUserWithPassword(tx, { ...data, role: "owner", passwordHash });
  });
  return { userId, email: data.email };
}

/**
 * Deletes a user and their own rows, children first (foreign keys are never relied on to cascade). Authorship
 * columns elsewhere keep the copied name ([USU-15]); their user id is cleared by the foreign key or left dangling.
 */
export async function deleteUserAccount(executor: Executor, userId: string): Promise<void> {
  await executor.update(conversations).set({ assignedUserId: null }).where(eq(conversations.assignedUserId, userId));
  await executor.delete(channelMembers).where(eq(channelMembers.userId, userId));
  await executor.delete(notifications).where(eq(notifications.userId, userId));
  await executor.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await executor.delete(userRoles).where(eq(userRoles.userId, userId));
  await executor.delete(twoFactor).where(eq(twoFactor.userId, userId));
  await executor.delete(session).where(eq(session.userId, userId));
  await executor.delete(account).where(eq(account.userId, userId));
  await executor.delete(user).where(eq(user.id, userId));
}

/** Signs a user out everywhere ([USU-14]): no session cookie cache, so the next request fails at once. */
export async function revokeUserSessions(executor: Executor, userId: string): Promise<void> {
  await executor.delete(session).where(eq(session.userId, userId));
}
