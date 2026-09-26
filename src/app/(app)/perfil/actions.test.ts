// Mi cuenta Server Actions with real Better Auth sessions on this file's own database.
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { TOO_MANY_ATTEMPTS_MESSAGE } from "@/app/(auth)/_lib/messages";
import {
  currentTotp,
  enableTwoFactorFor,
  serverSignIn,
  serverSignInWithTwoFactor,
  nextTestIp,
  sessionCount,
  totpSecretFromUri,
} from "@/app/(auth)/_lib/test-helpers";
import { db } from "@/db";
import { auditLog, businessSettings, user, userRoles } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createBusiness, createUser, type TestUser } from "@/test/factories";
import {
  changePasswordAction,
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  signOutAction,
  signOutOtherSessionsAction,
  startTwoFactorSetupAction,
  updateNameAction,
} from "./actions";

const NEW_PASSWORD = "otra-clave-segura-7";
const SESSION_EXPIRED = "Tu sesión ha caducado. Vuelve a entrar.";

/** Uses the session cookie of a real sign-in for the next action calls. */
function sendCookie(cookie: string): void {
  request.headers = new Headers({ cookie, "x-forwarded-for": nextTestIp() });
}

async function signedIn(role: Role = "agent"): Promise<TestUser> {
  const member = await createUser(role);
  const { cookie } = await serverSignIn(member.email, member.password);
  sendCookie(cookie);
  return member;
}

async function twoFactorEnabled(userId: string): Promise<boolean> {
  const [row] = await db.select({ enabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId));
  return row?.enabled === true;
}

async function audited(action: string, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.targetId, userId)));
  return rows.length;
}

beforeAll(async () => {
  await createBusiness();
});

beforeEach(async () => {
  request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
  await db.update(businessSettings).set({ require2faAdmins: false });
});

describe("Mi cuenta: name and password [USU-18]", () => {
  it("changes the name", async () => {
    const member = await signedIn("viewer");
    expect(await updateNameAction({ name: "  Nombre Nuevo " })).toMatchObject({ ok: true });
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, member.userId));
    expect(row.name).toBe("Nombre Nuevo");
    expect(await audited("account.name_changed", member.userId)).toBe(1);
  });

  it("changes the password with the current one and closes the other sessions [USU-10]", async () => {
    const member = await createUser("supervisor");
    await serverSignIn(member.email, member.password);
    const { cookie } = await serverSignIn(member.email, member.password);
    sendCookie(cookie);
    expect(await sessionCount(member.userId)).toBe(2);
    expect(await changePasswordAction({ currentPassword: member.password, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toMatchObject({
      ok: true,
    });
    // Better Auth closes every session and opens a new one for this device.
    expect(await sessionCount(member.userId)).toBe(1);
    expect((await serverSignIn(member.email, member.password)).status).toBe(401);
    expect((await serverSignIn(member.email, NEW_PASSWORD)).status).toBe(200);
    expect(await audited("account.password_changed", member.userId)).toBe(1);
  });

  it("a wrong current password changes nothing and marks that field", async () => {
    const member = await signedIn();
    const result = await changePasswordAction({ currentPassword: "no-es-la-actual", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.currentPassword).toBeDefined();
    expect((await serverSignIn(member.email, member.password)).status).toBe(200);
  });

  it("invalid data is refused [SEG-05]", async () => {
    await signedIn();
    expect((await updateNameAction({ name: "   " })).ok).toBe(false);
    expect((await updateNameAction(null)).ok).toBe(false);
    const mismatch = await changePasswordAction({ currentPassword: "algo-123456", password: NEW_PASSWORD, confirmPassword: "distinta-123" });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.fieldErrors?.confirmPassword).toBeDefined();
    const same = await changePasswordAction({ currentPassword: NEW_PASSWORD, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(same.ok).toBe(false);
  });

  it("password checks are limited per person [SEG-07]", async () => {
    const member = await signedIn();
    for (let attempt = 0; attempt < 5; attempt++) {
      await changePasswordAction({ currentPassword: `mala-${attempt}-1234`, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    }
    expect(await changePasswordAction({ currentPassword: member.password, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({
      ok: false,
      error: TOO_MANY_ATTEMPTS_MESSAGE,
    });
  });
});

describe("Mi cuenta: sessions [USU-18]", () => {
  it("signs out and goes to /login", async () => {
    const member = await signedIn();
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/login");
    expect(await sessionCount(member.userId)).toBe(0);
    expect(await audited("auth.logout", member.userId)).toBe(1);
  });

  it("closes the sessions on the other devices and keeps this one", async () => {
    const member = await createUser("agent");
    await serverSignIn(member.email, member.password);
    await serverSignIn(member.email, member.password);
    const { cookie } = await serverSignIn(member.email, member.password);
    sendCookie(cookie);
    expect(await sessionCount(member.userId)).toBe(3);
    expect(await signOutOtherSessionsAction()).toMatchObject({ ok: true });
    expect(await sessionCount(member.userId)).toBe(1);
    expect(await updateNameAction({ name: "Sigo dentro" })).toMatchObject({ ok: true });
  });
});

describe("Mi cuenta: two-step verification [USU-11]", () => {
  it("asks for the password, gives a QR code and backup codes, and turns on only after a valid code", async () => {
    const member = await signedIn("supervisor");
    const started = await startTwoFactorSetupAction({ password: member.password });
    expect(started.ok).toBe(true);
    if (!started.ok || !started.data) throw new Error("no ha empezado");
    expect(started.data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(started.data.secret).toMatch(/^[A-Z2-7]+$/);
    expect(started.data.backupCodes).toHaveLength(10);
    expect(await twoFactorEnabled(member.userId)).toBe(false);

    const secret = totpSecretFromUri(`otpauth://totp/x?secret=${started.data.secret}`);
    const wrong = String((Number(await currentTotp(secret)) + 500_000) % 1_000_000).padStart(6, "0");
    const refused = await confirmTwoFactorSetupAction({ code: wrong });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.fieldErrors?.code).toBeDefined();
    expect(await twoFactorEnabled(member.userId)).toBe(false);

    expect(await confirmTwoFactorSetupAction({ code: await currentTotp(secret) })).toMatchObject({ ok: true });
    expect(await twoFactorEnabled(member.userId)).toBe(true);
    expect(await audited("account.two_factor_enabled", member.userId)).toBe(1);
  });

  it("a wrong password does not start the setup", async () => {
    await signedIn();
    const result = await startTwoFactorSetupAction({ password: "no-es-la-mia-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.password).toBeDefined();
  });

  it("turns off with the password", async () => {
    const member = await createUser("agent");
    const { secret } = await enableTwoFactorFor(member);
    sendCookie(await serverSignInWithTwoFactor(member.email, member.password, secret));
    const wrong = await disableTwoFactorAction({ password: "no-es-la-mia-1" });
    expect(wrong.ok).toBe(false);
    expect(await twoFactorEnabled(member.userId)).toBe(true);
    expect(await disableTwoFactorAction({ password: member.password })).toMatchObject({ ok: true });
    expect(await twoFactorEnabled(member.userId)).toBe(false);
    expect(await audited("account.two_factor_disabled", member.userId)).toBe(1);
  });
});

describe("«Exigir verificación en dos pasos» [USU-12]", () => {
  it("an owner who must set it up can still use Mi cuenta to do it", async () => {
    const owner = await signedIn("owner");
    await db.update(businessSettings).set({ require2faAdmins: true });
    const started = await startTwoFactorSetupAction({ password: owner.password });
    if (!started.ok || !started.data) throw new Error("no ha empezado");
    const secret = totpSecretFromUri(`otpauth://totp/x?secret=${started.data.secret}`);
    expect(await confirmTwoFactorSetupAction({ code: await currentTotp(secret) })).toMatchObject({ ok: true });
    expect(await twoFactorEnabled(owner.userId)).toBe(true);
  });

  it("while it is required, owners and admins cannot turn it off", async () => {
    const admin = await createUser("admin");
    const { secret } = await enableTwoFactorFor(admin);
    sendCookie(await serverSignInWithTwoFactor(admin.email, admin.password, secret));
    await db.update(businessSettings).set({ require2faAdmins: true });
    const result = await disableTwoFactorAction({ password: admin.password });
    expect(result.ok).toBe(false);
    expect(await twoFactorEnabled(admin.userId)).toBe(true);
  });
});

describe("without a session nothing changes [SEG-04]", () => {
  it("every action answers «sesión caducada»", async () => {
    request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
    const expired = { ok: false, error: SESSION_EXPIRED };
    expect(await updateNameAction({ name: "Intruso" })).toEqual(expired);
    expect(await changePasswordAction({ currentPassword: "x-12345678", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual(expired);
    expect(await startTwoFactorSetupAction({ password: "x-12345678" })).toEqual(expired);
    expect(await confirmTwoFactorSetupAction({ code: "123456" })).toEqual(expired);
    expect(await disableTwoFactorAction({ password: "x-12345678" })).toEqual(expired);
    expect(await signOutOtherSessionsAction()).toEqual(expired);
  });

  it("a deactivated user cannot use a session they still hold [USU-14]", async () => {
    const member = await signedIn();
    await db.update(userRoles).set({ disabledAt: new Date() }).where(eq(userRoles.userId, member.userId));
    expect(await updateNameAction({ name: "Desactivado" })).toEqual({ ok: false, error: SESSION_EXPIRED });
  });
});
