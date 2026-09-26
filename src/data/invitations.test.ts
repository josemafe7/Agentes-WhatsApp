import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { account, channelMembers, channels, invitations, userRoles } from "@/db/schema";
import { primaryCssVars } from "@/lib/color";
import type { Role } from "@/lib/enums";
import { EmailInUseError } from "@/server/accounts";
import { AuthError, LinkUnavailableError, RateLimitError, ValidationError } from "@/server/errors";
import type { SendSystemEmailResult, SystemEmail } from "@/server/mailer";
import { actorFor, createBusiness, createChannel, createUser, TEST_PASSWORD } from "@/test/factories";

const mail = vi.hoisted(() => ({
  sent: [] as SystemEmail[],
  result: { ok: true, via: "outbox", file: "x.eml", logId: "log" } as SendSystemEmailResult,
}));
vi.mock("@/server/mailer", () => ({
  sendSystemEmail: async (email: SystemEmail) => {
    mail.sent.push(email);
    return mail.result;
  },
}));

import {
  acceptInvitation,
  createInvitation,
  getInvitationForToken,
  INVITATION_TTL_MS,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "./invitations";

const tokenOf = (link: string) => link.split("/invitacion/")[1];
let owner: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await createBusiness({ name: "Clínica Sonrisa" });
  owner = await createUser("owner", { name: "Marta" });
});

beforeEach(() => {
  mail.sent.length = 0;
  mail.result = { ok: true, via: "outbox", file: "x.eml", logId: "log" };
});

describe("createInvitation [USU-05] [USU-06] [USU-09]", () => {
  it("stores only the token's hash, expires in 7 days and emails the link", async () => {
    const before = Date.now();
    const delivery = await createInvitation(owner.actor, { email: "Nueva@Example.com", role: "supervisor" });
    const token = tokenOf(delivery.link);
    expect(delivery.link).toBe(`http://localhost:3000/invitacion/${token}`);
    expect(delivery.email).toEqual({ sent: true, via: "outbox" });
    const [row] = await db.select().from(invitations).where(eq(invitations.id, delivery.invitation.id));
    expect(row.email).toBe("nueva@example.com");
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(INVITATION_TTL_MS - 1_000);
    expect(row.expiresAt.getTime() - before).toBeLessThanOrEqual(INVITATION_TTL_MS + 5_000);
    expect(mail.sent[0]).toMatchObject({ kind: "invitation", to: "nueva@example.com" });
    expect(mail.sent[0].text).toContain(delivery.link);
    expect(mail.sent[0].text).toContain("Clínica Sonrisa");
  });

  it("the email carries the business logo and colour [AJU-01]", async () => {
    const logoFileKey = "logos/2026/09/0b0f6c1e-7d7a-4d7c-9c55-2f1f7b0d9a11.png";
    await createBusiness({ name: "Clínica Sonrisa", color: "#0f766e", logoFileKey });
    try {
      await createInvitation(owner.actor, { email: "con-marca@example.com", role: "viewer" });
      const html = mail.sent[0].html ?? "";
      expect(html).toContain(`<img src="http://localhost:3000/api/files/${logoFileKey}"`);
      expect(html).toContain(`background:${primaryCssVars("#0f766e").light["--primary"]}`);
    } finally {
      await createBusiness({ name: "Clínica Sonrisa", color: "#3d6df2", logoFileKey: null });
    }
  });

  it("without system mail the invitation is still created and the link is returned to copy [USU-06]", async () => {
    mail.result = { ok: false, reason: "not_configured", message: "sin correo", logId: "log" };
    const delivery = await createInvitation(owner.actor, { email: "sin-correo@example.com", role: "viewer" });
    expect(delivery.email).toMatchObject({ sent: false, via: null });
    expect(delivery.link).toContain("/invitacion/");
    expect((await listInvitations(owner.actor)).map((i) => i.email)).toContain("sin-correo@example.com");
  });

  it("cannot invite an email that already has an account [USU-09]", async () => {
    const existing = await createUser("agent");
    await expect(createInvitation(owner.actor, { email: existing.email, role: "agent" })).rejects.toBeInstanceOf(EmailInUseError);
  });

  it("inviting the same email again replaces the pending invitation", async () => {
    const first = await createInvitation(owner.actor, { email: "doble@example.com", role: "agent" });
    const second = await createInvitation(owner.actor, { email: "doble@example.com", role: "viewer" });
    expect((await getInvitationForToken(tokenOf(first.link))).status).toBe("revoked");
    expect((await getInvitationForToken(tokenOf(second.link))).status).toBe("valid");
  });

  it("stores the channels of an agent and rejects unknown channels or the owner role", async () => {
    const channel = await createChannel();
    const delivery = await createInvitation(owner.actor, { email: "agente@example.com", role: "agent", channelIds: [channel.id] });
    expect(delivery.invitation.channelIds).toEqual([channel.id]);
    await expect(
      createInvitation(owner.actor, { email: "x1@example.com", role: "agent", channelIds: ["nope"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createInvitation(owner.actor, { email: "x2@example.com", role: "owner" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createInvitation(owner.actor, { email: "no-es-un-email", role: "agent" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("an admin can invite", async () => {
    const admin = await createUser("admin");
    await expect(createInvitation(admin.actor, { email: "via-admin@example.com", role: "agent" })).resolves.toBeDefined();
  });

  it.each(["supervisor", "agent", "viewer"] as Role[])("%s cannot invite, list, resend or revoke [PER-04]", async (role) => {
    const pending = await createInvitation(owner.actor, { email: `p-${role}@example.com`, role: "viewer" });
    const actor = actorFor(role);
    await expect(createInvitation(actor, { email: `z-${role}@example.com`, role: "viewer" })).rejects.toBeInstanceOf(AuthError);
    await expect(listInvitations(actor)).rejects.toBeInstanceOf(AuthError);
    await expect(resendInvitation(actor, { invitationId: pending.invitation.id })).rejects.toBeInstanceOf(AuthError);
    await expect(revokeInvitation(actor, { invitationId: pending.invitation.id })).rejects.toBeInstanceOf(AuthError);
    expect((await getInvitationForToken(tokenOf(pending.link))).status).toBe("valid");
  });

  it("limits how many invitations one person sends per hour [SEG-07]", async () => {
    const admin = await createUser("admin");
    for (let i = 0; i < 30; i++) await createInvitation(admin.actor, { email: `lote-${i}@example.com`, role: "viewer" });
    await expect(createInvitation(admin.actor, { email: "lote-31@example.com", role: "viewer" })).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("acceptInvitation [USU-07] [USU-08]", () => {
  it("creates the account with the invitation's role and channels, and a password Better Auth verifies", async () => {
    const channel = await createChannel();
    const delivery = await createInvitation(owner.actor, { email: "acepta@example.com", role: "agent", channelIds: [channel.id] });
    const token = tokenOf(delivery.link);
    expect(await getInvitationForToken(token)).toMatchObject({ status: "valid", email: "acepta@example.com", role: "agent" });
    const { userId, email } = await acceptInvitation({ token, name: "Ana Pérez", password: TEST_PASSWORD });
    expect(email).toBe("acepta@example.com");
    const [role] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    expect(role.role).toBe("agent");
    expect(await db.select().from(channelMembers).where(eq(channelMembers.userId, userId))).toHaveLength(1);
    const [credential] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
    expect(credential.accountId).toBe(userId);
    expect(await verifyPassword({ hash: credential.password ?? "", password: TEST_PASSWORD })).toBe(true);
  });

  it("a used, revoked, expired or unknown link creates nothing [USU-08]", async () => {
    const used = await createInvitation(owner.actor, { email: "usada@example.com", role: "viewer" });
    await acceptInvitation({ token: tokenOf(used.link), name: "Uno", password: TEST_PASSWORD });
    await expect(acceptInvitation({ token: tokenOf(used.link), name: "Dos", password: TEST_PASSWORD })).rejects.toMatchObject({
      reason: "used",
    });

    const revoked = await createInvitation(owner.actor, { email: "revocada@example.com", role: "viewer" });
    await revokeInvitation(owner.actor, { invitationId: revoked.invitation.id });
    await expect(acceptInvitation({ token: tokenOf(revoked.link), name: "X", password: TEST_PASSWORD })).rejects.toMatchObject({
      reason: "revoked",
    });

    const expired = await createInvitation(owner.actor, { email: "caducada@example.com", role: "viewer" });
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(invitations.id, expired.invitation.id));
    await expect(acceptInvitation({ token: tokenOf(expired.link), name: "X", password: TEST_PASSWORD })).rejects.toMatchObject({
      reason: "expired",
    });
    expect(await getInvitationForToken(tokenOf(expired.link))).toEqual({ status: "expired", businessName: "Clínica Sonrisa" });

    await expect(acceptInvitation({ token: "inventado", name: "X", password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      LinkUnavailableError,
    );
    expect((await getInvitationForToken("inventado")).status).toBe("not_found");
  });

  it("validates name and password", async () => {
    const delivery = await createInvitation(owner.actor, { email: "valida@example.com", role: "viewer" });
    await expect(acceptInvitation({ token: tokenOf(delivery.link), name: "", password: "corta" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await getInvitationForToken(tokenOf(delivery.link))).status).toBe("valid");
  });

  it("two tabs accepting the same link at once create one account", async () => {
    const delivery = await createInvitation(owner.actor, { email: "doble-tab@example.com", role: "viewer" });
    const token = tokenOf(delivery.link);
    const results = await Promise.allSettled([
      acceptInvitation({ token, name: "Uno", password: TEST_PASSWORD }),
      acceptInvitation({ token, name: "Dos", password: TEST_PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("does not grant all channels if the invitation's channels were deleted meanwhile", async () => {
    const channel = await createChannel();
    const delivery = await createInvitation(owner.actor, { email: "sin-canal@example.com", role: "agent", channelIds: [channel.id] });
    await db.delete(channels).where(eq(channels.id, channel.id));
    await expect(acceptInvitation({ token: tokenOf(delivery.link), name: "X", password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      LinkUnavailableError,
    );
  });
});

describe("resend and revoke [USU-09]", () => {
  it("resend issues a new link (the old one stops working) with a fresh expiry", async () => {
    const delivery = await createInvitation(owner.actor, { email: "reenvio@example.com", role: "viewer" });
    await db.update(invitations).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(invitations.id, delivery.invitation.id));
    const resent = await resendInvitation(owner.actor, { invitationId: delivery.invitation.id });
    expect(resent.link).not.toBe(delivery.link);
    expect((await getInvitationForToken(tokenOf(delivery.link))).status).toBe("not_found");
    expect((await getInvitationForToken(tokenOf(resent.link))).status).toBe("valid");
    expect(resent.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now() + INVITATION_TTL_MS - 60_000);
    expect(mail.sent).toHaveLength(2);
  });

  it("revoked invitations leave the pending list", async () => {
    const delivery = await createInvitation(owner.actor, { email: "fuera@example.com", role: "viewer" });
    await revokeInvitation(owner.actor, { invitationId: delivery.invitation.id });
    expect((await listInvitations(owner.actor)).map((i) => i.id)).not.toContain(delivery.invitation.id);
    await expect(revokeInvitation(owner.actor, { invitationId: delivery.invitation.id })).rejects.toThrow("pendiente");
  });
});
