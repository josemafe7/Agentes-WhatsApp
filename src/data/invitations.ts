// Invitations: the only way into an installation after the first owner ([USU-04]–[USU-09]). The link carries a
// random token; only its SHA-256 is stored. Single use, 7-day expiry, one pending invitation per email.
import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { channels, invitations, user } from "@/db/schema";
import { INVITABLE_ROLES, type InvitableRole } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { emailSchema, passwordSchema, personNameSchema } from "@/lib/validation";
import { EmailInUseError, insertUserWithPassword } from "@/server/accounts";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { appUrl } from "@/server/app-url";
import { hashToken, randomToken } from "@/server/crypto";
import { invitationEmail } from "@/server/email-templates";
import { LinkUnavailableError, NotFoundError, parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { sendSystemEmail } from "@/server/mailer";
import { writeAudit } from "./audit";
import { getEmailBrand } from "./business";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;
/** Invitations (created or resent) per person and hour ([SEG-07]). */
const INVITES_PER_HOUR = 30;
const HOUR_MS = 60 * 60_000;
const TOKEN_MAX_LENGTH = 200;

export type InvitationSummary = {
  id: string;
  email: string;
  role: InvitableRole;
  channelIds: string[];
  expiresAt: Date;
  expired: boolean;
  invitedByName: string | null;
  lastSentAt: Date | null;
  sendCount: number;
  createdAt: Date;
};

/** The link to share, and whether the email went out. Without system mail the UI shows the link to copy ([USU-06]). */
export type InvitationDelivery = {
  invitation: InvitationSummary;
  link: string;
  email: { sent: boolean; via: "smtp" | "outbox" | null; message?: string };
};

type InvitationRow = typeof invitations.$inferSelect;

function summary(row: InvitationRow, now = new Date()): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    channelIds: row.channelIds,
    expiresAt: row.expiresAt,
    expired: row.expiresAt.getTime() <= now.getTime(),
    invitedByName: row.invitedByName,
    lastSentAt: row.lastSentAt,
    sendCount: row.sendCount,
    createdAt: row.createdAt,
  };
}

export function invitationPath(token: string): string {
  return `/invitacion/${token}`;
}

async function assertWithinInviteLimit(actor: Actor): Promise<void> {
  const result = await getRateLimiter().hit(`invite:${actor.userId}`, INVITES_PER_HOUR, HOUR_MS);
  if (!result.allowed) throw new RateLimitError("Has enviado muchas invitaciones seguidas. Espera un rato.");
}

async function sendInvitationEmail(row: InvitationRow, token: string, inviterName: string | null): Promise<InvitationDelivery> {
  const [settings, brand] = await Promise.all([loadBusinessSettings(), getEmailBrand()]);
  const link = appUrl(invitationPath(token));
  const content = invitationEmail({
    brand,
    inviterName,
    role: row.role,
    link,
    expiresAt: row.expiresAt,
    timezone: settings.timezone,
  });
  const result = await sendSystemEmail({ kind: "invitation", to: row.email, ...content });
  let current = row;
  if (result.ok) {
    [current] = await db
      .update(invitations)
      .set({ lastSentAt: new Date(), sendCount: row.sendCount + 1 })
      .where(eq(invitations.id, row.id))
      .returning();
  }
  return {
    invitation: summary(current),
    link,
    email: result.ok ? { sent: true, via: result.via } : { sent: false, via: null, message: result.message },
  };
}

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(INVITABLE_ROLES, { error: "Elige un rol de la lista." }),
  /** Agent role only: their channels; empty = all channels. */
  channelIds: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
});

/** Invites someone by email with a role (and channels if Agent) ([USU-05], [USU-09]). */
export async function createInvitation(actor: Actor, input: unknown): Promise<InvitationDelivery> {
  const data = parseInput(createInvitationSchema, input);
  assertCan(actor, PERMISSIONS.settings.users, { newRole: data.role });
  await assertWithinInviteLimit(actor);
  const token = randomToken();
  const channelIds = data.role === "agent" ? [...new Set(data.channelIds)] : [];
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, data.email));
    if (existing) throw new EmailInUseError();
    if (channelIds.length > 0) {
      const found = await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, channelIds));
      if (found.length !== channelIds.length) throw new ValidationError("Alguno de los canales elegidos no existe.");
    }
    const now = new Date();
    // One pending invitation per email: the new link replaces any earlier one.
    await tx
      .update(invitations)
      .set({ revokedAt: now })
      .where(and(eq(invitations.email, data.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    const [created] = await tx
      .insert(invitations)
      .values({
        email: data.email,
        role: data.role,
        channelIds,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        invitedBy: actor.userId,
        invitedByName: actor.name,
      })
      .returning();
    // No email in the log: personal data. The id identifies the invitation.
    await writeAudit({ actor, action: "user.invited", targetType: "invitation", targetId: created.id, metadata: { role: data.role } }, tx);
    return created;
  });
  return sendInvitationEmail(row, token, actor.name);
}

/** Pending invitations (not accepted or revoked), expired ones flagged ([USU-09]). */
export async function listInvitations(actor: Actor): Promise<InvitationSummary[]> {
  assertCan(actor, PERMISSIONS.settings.users);
  const rows = await db
    .select()
    .from(invitations)
    .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(invitations.createdAt);
  const now = new Date();
  return rows.map((row) => summary(row, now));
}

async function loadPending(invitationId: string): Promise<InvitationRow> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  if (!row) throw new NotFoundError("Esa invitación ya no está pendiente.");
  return row;
}

const invitationIdInput = z.object({ invitationId: z.string().trim().min(1).max(100) });

/** Sends a new link (the old one stops working) with a fresh 7-day expiry ([USU-09]). */
export async function resendInvitation(actor: Actor, input: unknown): Promise<InvitationDelivery> {
  const { invitationId } = parseInput(invitationIdInput, input);
  assertCan(actor, PERMISSIONS.settings.users);
  const pending = await loadPending(invitationId);
  assertCan(actor, PERMISSIONS.settings.users, { newRole: pending.role });
  await assertWithinInviteLimit(actor);
  const token = randomToken();
  const [row] = await db
    .update(invitations)
    .set({ tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) })
    .where(eq(invitations.id, pending.id))
    .returning();
  await writeAudit({ actor, action: "user.invitation_resent", targetType: "invitation", targetId: row.id });
  return sendInvitationEmail(row, token, actor.name);
}

/** Revokes a pending invitation: its link stops working ([USU-08], [USU-09]). */
export async function revokeInvitation(actor: Actor, input: unknown): Promise<void> {
  const { invitationId } = parseInput(invitationIdInput, input);
  assertCan(actor, PERMISSIONS.settings.users);
  const pending = await loadPending(invitationId);
  await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, pending.id));
  await writeAudit({ actor, action: "user.invitation_revoked", targetType: "invitation", targetId: pending.id });
}

/** Why the invitations someone sent stopped working: they can no longer invite. */
export type InviterChange = "inviter_disabled" | "inviter_removed" | "inviter_role_changed";

/**
 * Revokes the pending invitations `inviterId` sent, when that person is deactivated, deleted or given a role that
 * cannot invite: nobody joins on the word of someone who no longer could invite them ([USU-09], [USU-14]). Only
 * for src/data/users.ts, inside the transaction of that change and after its permission checks; each revocation
 * goes to the activity log by whoever made the change ([SEG-10]).
 */
export async function revokeInvitationsSentBy(executor: Executor, actor: Actor, inviterId: string, reason: InviterChange): Promise<number> {
  const revoked = await executor
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.invitedBy, inviterId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning({ id: invitations.id });
  for (const { id } of revoked) {
    await writeAudit({ actor, action: "user.invitation_revoked", targetType: "invitation", targetId: id, metadata: { reason } }, executor);
  }
  return revoked.length;
}

type TokenLookup = { row: InvitationRow | null; reason: LinkUnavailableError["reason"] | null };

async function lookupToken(token: string): Promise<TokenLookup> {
  if (!token || token.length > TOKEN_MAX_LENGTH) return { row: null, reason: "not_found" };
  const [row] = await db.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token)));
  if (!row) return { row: null, reason: "not_found" };
  if (row.acceptedAt) return { row, reason: "used" };
  if (row.revokedAt) return { row, reason: "revoked" };
  if (row.expiresAt.getTime() <= Date.now()) return { row, reason: "expired" };
  return { row, reason: null };
}

/**
 * Public (no session): what /invitacion/[token] shows. Email and role only for a valid link; otherwise just
 * why it is not valid ([USU-08]).
 */
export async function getInvitationForToken(token: string) {
  const { row, reason } = await lookupToken(token);
  const { name: businessName } = await loadBusinessSettings();
  if (!row || reason) return { status: reason ?? "not_found", businessName } as const;
  return { status: "valid", businessName, email: row.email, role: row.role, expiresAt: row.expiresAt } as const;
}

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(TOKEN_MAX_LENGTH),
  name: personNameSchema,
  password: passwordSchema,
});

/**
 * Public: creates the account with the invitation's role and channels ([USU-07]). Used, revoked or expired
 * links create nothing ([USU-08]). The caller signs the new user in afterwards (auth.api.signInEmail).
 */
export async function acceptInvitation(input: unknown): Promise<{ userId: string; email: string }> {
  const data = parseInput(acceptInvitationSchema, input);
  const first = await lookupToken(data.token);
  if (!first.row || first.reason) throw new LinkUnavailableError(first.reason ?? "not_found");
  const passwordHash = await hashPassword(data.password);
  const tokenHash = hashToken(data.token);
  return db.transaction(async (tx) => {
    // Checked again inside the write transaction: two tabs accepting at once create one account.
    const [row] = await tx
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      );
    if (!row) throw new LinkUnavailableError("used");
    // Channels deleted since the invitation are dropped. If none is left, stop: an agent without channel rows
    // would see every channel, more than the invitation granted.
    const existingChannels =
      row.channelIds.length > 0
        ? (await tx.select({ id: channels.id }).from(channels).where(inArray(channels.id, row.channelIds))).map((c) => c.id)
        : [];
    if (row.channelIds.length > 0 && existingChannels.length === 0) {
      throw new LinkUnavailableError("revoked", "Los canales de esta invitación ya no existen. Pide una nueva invitación.");
    }
    const { userId } = await insertUserWithPassword(tx, {
      name: data.name,
      email: row.email,
      passwordHash,
      role: row.role,
      channelIds: existingChannels,
    });
    await tx.update(invitations).set({ acceptedAt: new Date(), acceptedUserId: userId }).where(eq(invitations.id, row.id));
    await writeAudit(
      {
        actor: { userId, role: row.role, name: data.name, channelIds: null },
        action: "user.invitation_accepted",
        targetType: "invitation",
        targetId: row.id,
      },
      tx,
    );
    return { userId, email: row.email };
  });
}
