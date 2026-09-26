import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditLog, businessSettings, channelMembers, invitations, user, userRoles } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import type { SendSystemEmailResult, SystemEmail } from "@/server/mailer";
import { createBusiness, createChannel, createUser, TEST_PASSWORD, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  sent: [] as SystemEmail[],
  mailResult: { ok: true, via: "outbox", file: "x.eml", logId: "log" } as SendSystemEmailResult,
}));
vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  return {
    requireActor: async () => {
      if (!state.actor) throw new AuthError("unauthenticated");
      return state.actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/mailer", () => ({
  sendSystemEmail: async (email: SystemEmail) => {
    state.sent.push(email);
    return state.mailResult;
  },
}));

import {
  changeRoleAction,
  inviteUserAction,
  removeUserAction,
  resendInvitationAction,
  revokeInvitationAction,
  setAgentChannelsAction,
  setRequireTwoFactorAction,
  setUserDisabledAction,
  transferOwnershipAction,
} from "./actions";
import { loadUsersView } from "./_lib/view";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

async function roleOf(userId: string) {
  const [row] = await db.select({ role: userRoles.role, disabledAt: userRoles.disabledAt }).from(userRoles).where(eq(userRoles.userId, userId));
  return row;
}

async function auditActions(): Promise<string[]> {
  return (await db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
}

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await createBusiness({ name: "Peluquería Aurora" });
  owner = await createUser("owner", { name: "Marta" });
  admin = await createUser("admin", { name: "Luis" });
});

beforeEach(async () => {
  state.actor = owner.actor;
  state.sent.length = 0;
  state.mailResult = { ok: true, via: "outbox", file: "x.eml", logId: "log" };
  await db.delete(auditLog);
  await db.update(businessSettings).set({ require2faAdmins: false });
});

describe("Ajustes › Usuarios: what the page receives [AJU-02] [SEG-02]", () => {
  it("lists the team with role, 2FA, last access, demo badge, agent channels and pending invitations", async () => {
    const channel = await createChannel({ name: "Recepción" });
    const agent = await createUser("agent", { name: "Ana", channelIds: [channel.id], isDemo: true });
    await inviteUserAction(null, form({ email: "nuevo@example.com", role: "viewer" }));

    const view = await loadUsersView(owner.actor);
    const row = view.users.find((u) => u.id === agent.userId);
    expect(row).toMatchObject({
      name: "Ana",
      email: agent.email,
      role: "agent",
      roleLabel: "Agente",
      isDemo: true,
      twoFactorEnabled: false,
      channelNames: ["Recepción"],
      lastSeen: null,
      canManage: true,
    });
    expect(view.users.find((u) => u.id === owner.userId)).toMatchObject({ isMe: true, canManage: false });
    expect(view.channels).toEqual([{ id: channel.id, name: "Recepción", type: "webchat" }]);
    expect(view.invitations.map((i) => i.email)).toContain("nuevo@example.com");
    expect(view).toMatchObject({ canTransferOwnership: true, requireTwoFactor: false });

    // Only what the screen shows: no password hashes, invitation tokens or sessions.
    const json = JSON.stringify(view);
    const [invitation] = await db.select().from(invitations).where(eq(invitations.email, "nuevo@example.com"));
    expect(json).not.toContain(invitation.tokenHash);
    expect(json).not.toContain(TEST_PASSWORD);
    expect(json).not.toMatch(/scrypt|\$2[aby]\$|:[0-9a-f]{64}/);
  });

  it("an admin cannot manage the owner nor transfer the ownership [PER-05] [PER-06]", async () => {
    const view = await loadUsersView(admin.actor);
    expect(view.users.find((u) => u.id === owner.userId)?.canManage).toBe(false);
    expect(view.canTransferOwnership).toBe(false);
  });
});

describe.each<Role>(["supervisor", "agent", "viewer"])("Ajustes › Usuarios as %s [PER-03] [PER-04] [SEG-04]", (role) => {
  it("gets no data and every action is refused without changing anything", async () => {
    const person = await createUser(role);
    const target = await createUser("agent");
    const [pending] = await db.select({ id: invitations.id }).from(invitations).where(isNull(invitations.revokedAt)).limit(1);
    state.actor = person.actor;

    await expect(loadUsersView(person.actor)).rejects.toMatchObject({ status: 403 });
    expect(await inviteUserAction(null, form({ email: `intruso-${role}@example.com`, role: "admin" }))).toEqual(FORBIDDEN);
    expect(await changeRoleAction(null, form({ userId: target.userId, role: "admin" }))).toEqual(FORBIDDEN);
    expect(await setAgentChannelsAction(null, form({ userId: target.userId, channelIds: [] }))).toEqual(FORBIDDEN);
    expect(await setUserDisabledAction({ userId: target.userId, disabled: true })).toEqual(FORBIDDEN);
    expect(await removeUserAction({ userId: target.userId })).toEqual(FORBIDDEN);
    expect(await transferOwnershipAction(null, form({ toUserId: person.userId, password: TEST_PASSWORD }))).toEqual(FORBIDDEN);
    expect(await setRequireTwoFactorAction({ enabled: true })).toEqual(FORBIDDEN);
    if (pending) {
      expect(await resendInvitationAction({ invitationId: pending.id })).toEqual(FORBIDDEN);
      expect(await revokeInvitationAction({ invitationId: pending.id })).toEqual(FORBIDDEN);
    }

    expect(await roleOf(target.userId)).toEqual({ role: "agent", disabledAt: null });
    expect(await roleOf(owner.userId)).toMatchObject({ role: "owner" });
    expect((await db.select().from(invitations).where(eq(invitations.email, `intruso-${role}@example.com`))).length).toBe(0);
    expect((await db.select().from(businessSettings))[0].require2faAdmins).toBe(false);
    expect(await auditActions()).toEqual([]);
  });
});

describe("Ajustes › Usuarios actions", () => {
  it("without a session every action says so and changes nothing [SEG-04]", async () => {
    state.actor = null;
    expect(await inviteUserAction(null, form({ email: "x@example.com", role: "viewer" }))).toEqual({
      ok: false,
      error: "Tu sesión ha caducado. Vuelve a entrar.",
    });
    expect(await auditActions()).toEqual([]);
  });

  it("invites without system mail: the link is shown to copy, and it is logged [USU-05] [USU-06]", async () => {
    const result = await inviteUserAction(null, form({ email: "Laura@Example.com", role: "supervisor" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ email: "laura@example.com", sent: false });
    expect(result.data?.link).toMatch(/^http:\/\/localhost:3000\/invitacion\/.+/);
    expect(state.sent[0]).toMatchObject({ kind: "invitation", to: "laura@example.com" });
    expect(await auditActions()).toEqual(["user.invited"]);
  });

  it("invites with SMTP: the email goes out and the link is not shown", async () => {
    state.mailResult = { ok: true, via: "smtp", logId: "log" };
    const result = await inviteUserAction(null, form({ email: "pablo@example.com", role: "viewer" }));
    expect(result).toMatchObject({ ok: true, data: { sent: true, link: null } });
  });

  it("invites an agent with their channels [USU-05] [USU-17]", async () => {
    const channel = await createChannel({ name: "WhatsApp tienda" });
    await inviteUserAction(null, form({ email: "agente-nuevo@example.com", role: "agent", channelIds: [channel.id] }));
    const [row] = await db.select().from(invitations).where(eq(invitations.email, "agente-nuevo@example.com"));
    expect(row.channelIds).toEqual([channel.id]);
  });

  it("explains invalid or repeated emails next to the field [USU-09] [AJU-15]", async () => {
    const invalid = await inviteUserAction(null, form({ email: "no-es-un-email", role: "viewer" }));
    expect(invalid).toMatchObject({ ok: false, fieldErrors: { email: ["Escribe un email válido."] } });
    const taken = await inviteUserAction(null, form({ email: admin.email, role: "viewer" }));
    expect(taken).toEqual({ ok: false, error: "Ese email ya tiene una cuenta." });
    const ownerRole = await inviteUserAction(null, form({ email: "jefe@example.com", role: "owner" }));
    expect(ownerRole.ok).toBe(false);
  });

  it("resends and revokes pending invitations, logging both [USU-09]", async () => {
    const invited = await inviteUserAction(null, form({ email: "reenvio@example.com", role: "viewer" }));
    const [row] = await db.select().from(invitations).where(eq(invitations.email, "reenvio@example.com"));
    const resent = await resendInvitationAction({ invitationId: row.id });
    expect(resent).toMatchObject({ ok: true, data: { email: "reenvio@example.com" } });
    if (resent.ok && invited.ok) expect(resent.data?.link).not.toBe(invited.data?.link);
    expect(await revokeInvitationAction({ invitationId: row.id })).toMatchObject({ ok: true });
    const [after] = await db.select().from(invitations).where(eq(invitations.id, row.id));
    expect(after.revokedAt).toBeInstanceOf(Date);
    expect(await auditActions()).toEqual(expect.arrayContaining(["user.invitation_resent", "user.invitation_revoked"]));
  });

  it("changes a role, the channels of an agent, deactivates and deletes, logging each one [USU-14] [USU-17] [ARR-20]", async () => {
    const channel = await createChannel({ name: "Correo" });
    const person = await createUser("viewer", { isDemo: true });
    expect(await changeRoleAction(null, form({ userId: person.userId, role: "agent", channelIds: [channel.id] }))).toMatchObject({ ok: true });
    expect(await roleOf(person.userId)).toMatchObject({ role: "agent" });
    expect(await setAgentChannelsAction(null, form({ userId: person.userId }))).toMatchObject({ ok: true });
    expect(await db.select().from(channelMembers).where(eq(channelMembers.userId, person.userId))).toHaveLength(0);
    expect(await setUserDisabledAction({ userId: person.userId, disabled: true })).toMatchObject({ ok: true });
    expect((await roleOf(person.userId)).disabledAt).toBeInstanceOf(Date);
    expect(await removeUserAction({ userId: person.userId })).toMatchObject({ ok: true });
    expect(await db.select().from(user).where(eq(user.id, person.userId))).toHaveLength(0);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(["user.role_changed", "user.channels_changed", "user.disabled", "user.removed"]),
    );
  });

  it("an admin cannot change, deactivate or delete the owner, nor make anyone owner [PER-05]", async () => {
    state.actor = admin.actor;
    expect(await changeRoleAction(null, form({ userId: owner.userId, role: "viewer" }))).toEqual(FORBIDDEN);
    expect(await setUserDisabledAction({ userId: owner.userId, disabled: true })).toEqual(FORBIDDEN);
    expect(await removeUserAction({ userId: owner.userId })).toEqual(FORBIDDEN);
    const person = await createUser("viewer");
    expect(await changeRoleAction(null, form({ userId: person.userId, role: "owner" }))).toEqual(FORBIDDEN);
    expect(await roleOf(owner.userId)).toEqual({ role: "owner", disabledAt: null });
  });

  it("nobody changes their own role, and the owner cannot be deleted [PER-06]", async () => {
    expect(await changeRoleAction(null, form({ userId: owner.userId, role: "admin" }))).toMatchObject({ ok: false });
    expect(await removeUserAction({ userId: owner.userId })).toMatchObject({ ok: false });
    expect(await roleOf(owner.userId)).toMatchObject({ role: "owner" });
  });

  it("only the owner transfers the ownership, confirming with the password [USU-16] [PER-06]", async () => {
    const localOwner = await createUser("owner", { name: "Dueña" });
    const heir = await createUser("admin", { name: "Heredero" });
    state.actor = heir.actor;
    expect(await transferOwnershipAction(null, form({ toUserId: heir.userId, password: TEST_PASSWORD }))).toEqual(FORBIDDEN);

    state.actor = localOwner.actor;
    const wrong = await transferOwnershipAction(null, form({ toUserId: heir.userId, password: "otra-contraseña" }));
    expect(wrong).toMatchObject({ ok: false, fieldErrors: { password: ["La contraseña no es correcta."] } });
    expect(await roleOf(localOwner.userId)).toMatchObject({ role: "owner" });

    expect(await transferOwnershipAction(null, form({ toUserId: heir.userId, password: TEST_PASSWORD }))).toMatchObject({ ok: true });
    expect(await roleOf(heir.userId)).toMatchObject({ role: "owner" });
    expect(await roleOf(localOwner.userId)).toMatchObject({ role: "admin" });
    expect(await auditActions()).toContain("user.ownership_transferred");
    // Back to one owner for the other tests.
    await db.update(userRoles).set({ role: "admin" }).where(and(eq(userRoles.userId, heir.userId)));
  });

  it("turns on «Exigir verificación en dos pasos» and logs it [USU-12]", async () => {
    state.actor = admin.actor;
    expect(await setRequireTwoFactorAction({ enabled: true })).toMatchObject({ ok: true });
    expect((await db.select().from(businessSettings))[0].require2faAdmins).toBe(true);
    expect(await auditActions()).toEqual(["settings.require_2fa_changed"]);
  });
});
