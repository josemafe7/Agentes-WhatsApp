import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { account, auditLog, channelMembers, conversations, invitations, messages, session, user, userRoles } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { hashToken, randomToken } from "@/server/crypto";
import { resolveActor } from "@/server/session";
import { AuthError, ForbiddenError, RateLimitError, ValidationError } from "@/server/errors";
import { actorFor, createBusiness, createChannel, createUser, TEST_PASSWORD } from "@/test/factories";
import { getInvitationForToken } from "./invitations";
import {
  changeRole,
  listUsers,
  removeUser,
  setAgentChannels,
  setRequireTwoFactor,
  setUserDisabled,
  transferOwnership,
} from "./users";

beforeAll(async () => {
  await createBusiness();
});

async function roleOf(userId: string) {
  const [row] = await db.select({ role: userRoles.role, disabledAt: userRoles.disabledAt }).from(userRoles).where(eq(userRoles.userId, userId));
  return row;
}

async function signedIn(userId: string) {
  const [row] = await db
    .insert(session)
    .values({ userId, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) })
    .returning();
  return { session: { id: row.id }, user: { id: userId } };
}

const notAllowed: Role[] = ["supervisor", "agent", "viewer"];

describe("listUsers [AJU-02]", () => {
  it("owner and admin see the team with roles and agent channels", async () => {
    const channel = await createChannel();
    const agent = await createUser("agent", { channelIds: [channel.id] });
    const owner = await createUser("owner");
    const list = await listUsers(owner.actor);
    expect(list.find((u) => u.id === agent.userId)).toMatchObject({ role: "agent", channelIds: [channel.id], disabledAt: null });
    expect(await listUsers(actorFor("admin"))).toHaveLength(list.length);
  });

  it.each(notAllowed)("%s cannot list users [PER-03] [PER-04]", async (role) => {
    await expect(listUsers(actorFor(role))).rejects.toBeInstanceOf(AuthError);
  });
});

describe("changeRole [USU-14] [PER-05] [PER-06]", () => {
  it("the owner changes a role and it applies from the next request", async () => {
    const owner = await createUser("owner");
    const member = await createUser("admin");
    const before = await resolveActor(await signedIn(member.userId));
    expect(before?.role).toBe("admin");
    await changeRole(owner.actor, { userId: member.userId, role: "viewer" });
    expect((await resolveActor(await signedIn(member.userId)))?.role).toBe("viewer");
    const log = await db.select().from(auditLog).where(eq(auditLog.targetId, member.userId));
    expect(log[0]).toMatchObject({ action: "user.role_changed", actorUserId: owner.userId });
  });

  it("gives an agent channels and clears them when the role changes", async () => {
    const owner = await createUser("owner");
    const channel = await createChannel();
    const member = await createUser("supervisor");
    await changeRole(owner.actor, { userId: member.userId, role: "agent", channelIds: [channel.id] });
    expect(await db.select().from(channelMembers).where(eq(channelMembers.userId, member.userId))).toHaveLength(1);
    await changeRole(owner.actor, { userId: member.userId, role: "supervisor" });
    expect(await db.select().from(channelMembers).where(eq(channelMembers.userId, member.userId))).toHaveLength(0);
  });

  it("an admin cannot change the owner's role or make anyone owner [PER-05]", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    const member = await createUser("agent");
    await expect(changeRole(admin.actor, { userId: owner.userId, role: "viewer" })).rejects.toBeInstanceOf(AuthError);
    await expect(changeRole(admin.actor, { userId: member.userId, role: "owner" })).rejects.toBeInstanceOf(AuthError);
    await expect(changeRole(owner.actor, { userId: member.userId, role: "owner" })).rejects.toBeInstanceOf(AuthError);
    expect((await roleOf(owner.userId)).role).toBe("owner");
    expect((await roleOf(member.userId)).role).toBe("agent");
  });

  it("nobody changes their own role, and the owner role only moves with the transfer [PER-06]", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    await expect(changeRole(admin.actor, { userId: admin.userId, role: "supervisor" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeRole(owner.actor, { userId: owner.userId, role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await roleOf(admin.userId)).role).toBe("admin");
  });

  it.each(notAllowed)("%s cannot change roles and nothing changes", async (role) => {
    const member = await createUser("viewer");
    await expect(changeRole(actorFor(role), { userId: member.userId, role: "admin" })).rejects.toBeInstanceOf(AuthError);
    expect((await roleOf(member.userId)).role).toBe("viewer");
  });

  it("rejects unknown roles and users", async () => {
    const owner = await createUser("owner");
    await expect(changeRole(owner.actor, { userId: owner.userId, role: "god" })).rejects.toBeInstanceOf(ValidationError);
    await expect(changeRole(owner.actor, { userId: crypto.randomUUID(), role: "admin" })).rejects.toThrow("no existe");
  });
});

describe("setAgentChannels [USU-17]", () => {
  it("sets the channels of an agent; only for agents and existing channels", async () => {
    const admin = await createUser("admin");
    const [c1, c2] = [await createChannel(), await createChannel()];
    const agent = await createUser("agent");
    await setAgentChannels(admin.actor, { userId: agent.userId, channelIds: [c1.id, c2.id] });
    expect((await resolveActor(await signedIn(agent.userId)))?.channelIds?.slice().sort()).toEqual([c1.id, c2.id].sort());
    await setAgentChannels(admin.actor, { userId: agent.userId, channelIds: [] });
    // No channels: all channels ([PER-02]).
    expect((await resolveActor(await signedIn(agent.userId)))?.channelIds).toBeNull();
    const supervisor = await createUser("supervisor");
    await expect(setAgentChannels(admin.actor, { userId: supervisor.userId, channelIds: [c1.id] })).rejects.toBeInstanceOf(ValidationError);
    await expect(setAgentChannels(admin.actor, { userId: agent.userId, channelIds: ["missing"] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("[PER-02] taking away an agent's last channel warns whoever did it that they now see every channel", async () => {
    const admin = await createUser("admin");
    const [c1, c2] = [await createChannel(), await createChannel()];
    const agent = await createUser("agent");
    expect(await setAgentChannels(admin.actor, { userId: agent.userId, channelIds: [c1.id, c2.id] })).toEqual({ warning: null });
    expect(await setAgentChannels(admin.actor, { userId: agent.userId, channelIds: [c1.id] })).toEqual({ warning: null });
    const { warning } = await setAgentChannels(admin.actor, { userId: agent.userId, channelIds: [] });
    expect(warning).toContain(`«${agent.name}»`);
    expect(warning).toContain("verá todos los canales");
    // Already without channels: nothing changes, nothing to warn about.
    expect(await setAgentChannels(admin.actor, { userId: agent.userId, channelIds: [] })).toEqual({ warning: null });
  });
});

describe("setUserDisabled [USU-14] [PER-05] [PER-06]", () => {
  it("a deactivated user loses access at once (sessions revoked) and can be reactivated", async () => {
    const admin = await createUser("admin");
    const member = await createUser("supervisor");
    const data = await signedIn(member.userId);
    await setUserDisabled(admin.actor, { userId: member.userId, disabled: true });
    expect(await resolveActor(data)).toBeNull();
    expect(await db.select().from(session).where(eq(session.userId, member.userId))).toHaveLength(0);
    await setUserDisabled(admin.actor, { userId: member.userId, disabled: false });
    expect((await roleOf(member.userId)).disabledAt).toBeNull();
  });

  it("the owner can be deactivated by nobody, and nobody deactivates themselves", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    await expect(setUserDisabled(admin.actor, { userId: owner.userId, disabled: true })).rejects.toBeInstanceOf(AuthError);
    await expect(setUserDisabled(owner.actor, { userId: owner.userId, disabled: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserDisabled(admin.actor, { userId: admin.userId, disabled: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await roleOf(owner.userId)).disabledAt).toBeNull();
  });

  it.each(notAllowed)("%s cannot deactivate anyone", async (role) => {
    const member = await createUser("agent");
    await expect(setUserDisabled(actorFor(role), { userId: member.userId, disabled: true })).rejects.toBeInstanceOf(AuthError);
    expect((await roleOf(member.userId)).disabledAt).toBeNull();
  });
});

describe("removeUser [USU-15] [ARR-20] [PER-05] [PER-06]", () => {
  it("deletes the account and its rows; messages keep the author's name", async () => {
    const owner = await createUser("owner");
    const channel = await createChannel();
    const member = await createUser("agent", { name: "Laura Gómez", channelIds: [channel.id], isDemo: true });
    await signedIn(member.userId);
    const [conversation] = await db.insert(conversations).values({ channelId: channel.id, assignedUserId: member.userId }).returning();
    const [message] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        channelId: channel.id,
        direction: "outbound",
        senderType: "human",
        senderUserId: member.userId,
        senderName: "Laura Gómez",
        status: "sent",
        text: "Hola",
      })
      .returning();
    await removeUser(owner.actor, { userId: member.userId });
    expect(await db.select().from(user).where(eq(user.id, member.userId))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, member.userId))).toHaveLength(0);
    expect(await db.select().from(channelMembers).where(eq(channelMembers.userId, member.userId))).toHaveLength(0);
    const [kept] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(kept).toMatchObject({ senderName: "Laura Gómez", senderUserId: null });
    const [unassigned] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(unassigned.assignedUserId).toBeNull();
  });

  it("the owner cannot be deleted; an admin cannot delete the owner; nobody deletes themselves", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    await expect(removeUser(owner.actor, { userId: owner.userId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeUser(admin.actor, { userId: owner.userId })).rejects.toBeInstanceOf(AuthError);
    await expect(removeUser(admin.actor, { userId: admin.userId })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await roleOf(owner.userId)).toBeDefined();
  });

  it.each(notAllowed)("%s cannot delete users", async (role) => {
    const member = await createUser("viewer");
    await expect(removeUser(actorFor(role), { userId: member.userId })).rejects.toBeInstanceOf(AuthError);
    expect(await roleOf(member.userId)).toBeDefined();
  });
});

describe("transferOwnership [USU-16] [PER-06]", () => {
  it("with the right password: the other becomes owner and the owner becomes admin", async () => {
    const owner = await createUser("owner");
    const channel = await createChannel();
    const agent = await createUser("agent", { channelIds: [channel.id] });
    await transferOwnership(owner.actor, { toUserId: agent.userId, password: TEST_PASSWORD });
    expect((await roleOf(agent.userId)).role).toBe("owner");
    expect((await roleOf(owner.userId)).role).toBe("admin");
    expect(await db.select().from(channelMembers).where(eq(channelMembers.userId, agent.userId))).toHaveLength(0);
  });

  it("a wrong password changes nothing", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    const error = await transferOwnership(owner.actor, { toUserId: admin.userId, password: "otra-cosa-123" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((await roleOf(admin.userId)).role).toBe("admin");
    expect((await roleOf(owner.userId)).role).toBe("owner");
  });

  it("only the owner can transfer", async () => {
    const admin = await createUser("admin");
    const other = await createUser("supervisor");
    for (const role of ["admin", "supervisor", "agent", "viewer"] as Role[]) {
      await expect(
        transferOwnership({ ...admin.actor, role }, { toUserId: other.userId, password: TEST_PASSWORD }),
      ).rejects.toBeInstanceOf(AuthError);
    }
    expect((await roleOf(other.userId)).role).toBe("supervisor");
  });

  it("slows down repeated password attempts", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    for (let i = 0; i < 5; i++) {
      await expect(transferOwnership(owner.actor, { toUserId: admin.userId, password: "mala-123456" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(transferOwnership(owner.actor, { toUserId: admin.userId, password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});

describe("require 2FA for owner and admins [USU-12]", () => {
  it("owner/admin without 2FA must set it up; other roles are not affected", async () => {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    const supervisor = await createUser("supervisor");
    await setRequireTwoFactor(owner.actor, { enabled: true });
    expect((await resolveActor(await signedIn(admin.userId)))?.twoFactorSetupRequired).toBe(true);
    expect((await resolveActor(await signedIn(supervisor.userId)))?.twoFactorSetupRequired).toBe(false);
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, admin.userId));
    expect((await resolveActor(await signedIn(admin.userId)))?.twoFactorSetupRequired).toBe(false);
    await setRequireTwoFactor(admin.actor, { enabled: false });
    expect((await resolveActor(await signedIn(owner.userId)))?.twoFactorSetupRequired).toBe(false);
  });

  it.each(notAllowed)("%s cannot change the requirement", async (role) => {
    await expect(setRequireTwoFactor(actorFor(role), { enabled: true })).rejects.toBeInstanceOf(AuthError);
  });
});

describe("pending invitations of someone who can no longer invite are revoked [USU-09] [USU-14] [SEG-04]", () => {
  /** A pending invitation sent by `invitedBy`, and the token of its link. */
  async function pendingInvitation(invitedBy: string, overrides: Partial<typeof invitations.$inferInsert> = {}) {
    const token = randomToken();
    const [row] = await db
      .insert(invitations)
      .values({
        email: `invitado-${crypto.randomUUID().slice(0, 8)}@example.com`,
        role: "agent",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedBy,
        invitedByName: "Quien invita",
        ...overrides,
      })
      .returning();
    return { id: row.id, token };
  }

  const linkStatus = async (token: string) => (await getInvitationForToken(token)).status;

  /** An admin with two pending invitations, one already accepted, and a pending one sent by somebody else. */
  async function adminWithInvitations() {
    const owner = await createUser("owner");
    const admin = await createUser("admin");
    const pending = [await pendingInvitation(admin.userId), await pendingInvitation(admin.userId, { role: "viewer" })];
    const accepted = await pendingInvitation(admin.userId, { acceptedAt: new Date() });
    const others = await pendingInvitation(owner.userId);
    return { owner, admin, pending, accepted, others };
  }

  it("when the admin who sent them is deactivated: their links stop working, anyone else's keep working", async () => {
    const { owner, admin, pending, accepted, others } = await adminWithInvitations();
    expect(await linkStatus(pending[0].token)).toBe("valid");
    await setUserDisabled(owner.actor, { userId: admin.userId, disabled: true });
    for (const invitation of pending) expect(await linkStatus(invitation.token)).toBe("revoked");
    expect(await linkStatus(accepted.token)).toBe("used");
    expect(await linkStatus(others.token)).toBe("valid");
    // Reactivating the admin does not bring them back.
    await setUserDisabled(owner.actor, { userId: admin.userId, disabled: false });
    expect(await linkStatus(pending[0].token)).toBe("revoked");
  });

  it("when the admin who sent them is deleted", async () => {
    const { owner, admin, pending, others } = await adminWithInvitations();
    await removeUser(owner.actor, { userId: admin.userId });
    for (const invitation of pending) expect(await linkStatus(invitation.token)).toBe("revoked");
    expect(await linkStatus(others.token)).toBe("valid");
  });

  it("when the admin who sent them gets a role that cannot invite", async () => {
    for (const role of ["supervisor", "agent", "viewer"] as Role[]) {
      const { owner, admin, pending, others } = await adminWithInvitations();
      await changeRole(owner.actor, { userId: admin.userId, role });
      for (const invitation of pending) expect(await linkStatus(invitation.token), role).toBe("revoked");
      expect(await linkStatus(others.token), role).toBe("valid");
    }
  });

  it("each revocation goes to the activity log, by whoever made the change [SEG-10]", async () => {
    const { owner, admin, pending } = await adminWithInvitations();
    await setUserDisabled(owner.actor, { userId: admin.userId, disabled: true });
    const logged = (await db.select().from(auditLog).where(eq(auditLog.action, "user.invitation_revoked"))).filter((row) =>
      pending.some((invitation) => invitation.id === row.targetId),
    );
    expect(logged).toHaveLength(2);
    for (const row of logged) expect(row).toMatchObject({ actorUserId: owner.userId, targetType: "invitation", metadata: { reason: "inviter_disabled" } });
  });

  it("an owner who hands over the ownership (and stays as admin) keeps them: an admin can still invite", async () => {
    const owner = await createUser("owner");
    const other = await createUser("admin");
    const invitation = await pendingInvitation(owner.userId);
    await transferOwnership(owner.actor, { toUserId: other.userId, password: TEST_PASSWORD });
    expect(await linkStatus(invitation.token)).toBe("valid");
  });

  it("nothing is revoked when the change is refused", async () => {
    const admin = await createUser("admin");
    const invitation = await pendingInvitation(admin.userId);
    await expect(setUserDisabled(actorFor("supervisor"), { userId: admin.userId, disabled: true })).rejects.toBeInstanceOf(AuthError);
    await expect(changeRole(actorFor("viewer"), { userId: admin.userId, role: "viewer" })).rejects.toBeInstanceOf(AuthError);
    expect(await linkStatus(invitation.token)).toBe("valid");
  });
});
