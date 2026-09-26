// Second step of the sign-in (TOTP or backup code) with real Better Auth on this file's own database.
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { db } from "@/db";
import { auditLog, userRoles } from "@/db/schema";
import { createBusiness, createUser } from "@/test/factories";
import {
  ACCOUNT_DISABLED_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
  TWO_FACTOR_EXPIRED_MESSAGE,
  TWO_FACTOR_INVALID_BACKUP_MESSAGE,
  TWO_FACTOR_INVALID_CODE_MESSAGE,
} from "../_lib/messages";
import { currentTotp, enableTwoFactorFor, serverSignIn, nextTestIp, sessionCount } from "../_lib/test-helpers";
import { verifyTwoFactorAction } from "./actions";

/** A user with 2FA who has just typed the right password: the request carries Better Auth's two_factor cookie. */
async function afterPassword(role: "owner" | "admin" | "supervisor" | "agent" | "viewer" = "supervisor") {
  const member = await createUser(role);
  const { secret, backupCodes } = await enableTwoFactorFor(member);
  const { cookie } = await serverSignIn(member.email, member.password);
  expect(cookie).toContain("dominia.two_factor=");
  request.headers = new Headers({ cookie, "x-forwarded-for": nextTestIp() });
  return { member, secret, backupCodes };
}

/** A 6-digit code that is not the current one. */
function otherCode(code: string): string {
  return String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");
}

beforeAll(async () => {
  await createBusiness();
});

beforeEach(() => {
  request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
});

describe("the code from the authenticator app completes the sign-in [USU-11]", () => {
  it("opens the session, logs the «entrada» and goes to `next`", async () => {
    const { member, secret } = await afterPassword();
    const before = await sessionCount(member.userId);
    await expect(verifyTwoFactorAction({ method: "totp", code: await currentTotp(secret), next: "/agenda" })).rejects.toThrow(
      "REDIRECT:/agenda",
    );
    expect(await sessionCount(member.userId)).toBe(before + 1);
    const entries = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "auth.login"), eq(auditLog.targetId, member.userId)));
    expect(entries.at(-1)?.metadata).toEqual({ twoFactor: true });
  });

  it("a wrong code opens nothing and is logged as a failed sign-in", async () => {
    const { member, secret } = await afterPassword();
    const before = await sessionCount(member.userId);
    const failuresBefore = (await db.select().from(auditLog).where(eq(auditLog.action, "auth.login_failed"))).length;
    expect(await verifyTwoFactorAction({ method: "totp", code: otherCode(await currentTotp(secret)) })).toEqual({
      ok: false,
      error: TWO_FACTOR_INVALID_CODE_MESSAGE,
    });
    expect(await sessionCount(member.userId)).toBe(before);
    const failures = await db.select().from(auditLog).where(eq(auditLog.action, "auth.login_failed"));
    expect(failures).toHaveLength(failuresBefore + 1);
    expect(failures.at(-1)?.metadata).toEqual({ reason: "two_factor_invalid" });
  });

  it("a backup code works once", async () => {
    const { member, backupCodes } = await afterPassword();
    const [code] = backupCodes;
    await expect(verifyTwoFactorAction({ method: "backup", code })).rejects.toThrow("REDIRECT:/bandeja");
    const { cookie } = await serverSignIn(member.email, member.password);
    request.headers = new Headers({ cookie, "x-forwarded-for": nextTestIp() });
    expect(await verifyTwoFactorAction({ method: "backup", code })).toEqual({ ok: false, error: TWO_FACTOR_INVALID_BACKUP_MESSAGE });
  });

  it("accepts a backup code typed without the dash", async () => {
    const { backupCodes } = await afterPassword();
    await expect(verifyTwoFactorAction({ method: "backup", code: backupCodes[1].replace("-", "") })).rejects.toThrow("REDIRECT:/bandeja");
  });

  it("without the cookie of the first step (expired or never signed in) asks to sign in again", async () => {
    expect(await verifyTwoFactorAction({ method: "totp", code: "123456" })).toEqual({ ok: false, error: TWO_FACTOR_EXPIRED_MESSAGE });
  });

  it("after too many wrong codes the challenge ends and the person signs in again", async () => {
    const { secret } = await afterPassword();
    const wrong = otherCode(await currentTotp(secret));
    const results = [];
    for (let attempt = 0; attempt < 6; attempt++) results.push(await verifyTwoFactorAction({ method: "totp", code: wrong }));
    expect(results.at(-1)).toEqual({ ok: false, error: TWO_FACTOR_EXPIRED_MESSAGE });
  });
});

describe("the second step also keeps deactivated users out [USU-14]", () => {
  it("a user deactivated between the password and the code gets no session, and loses any other", async () => {
    const { member, secret } = await afterPassword("agent");
    await db.update(userRoles).set({ disabledAt: new Date() }).where(eq(userRoles.userId, member.userId));
    expect(await verifyTwoFactorAction({ method: "totp", code: await currentTotp(secret) })).toEqual({
      ok: false,
      error: ACCOUNT_DISABLED_MESSAGE,
    });
    // Not only the new one: every session the deactivated user still had is closed.
    expect(await sessionCount(member.userId)).toBe(0);
  });
});

describe("codes are rate limited per IP [SEG-07]", () => {
  it("more than 10 codes in 5 minutes from one IP are refused", async () => {
    request.headers = new Headers({ "x-forwarded-for": "198.51.100.7" });
    for (let attempt = 0; attempt < 10; attempt++) await verifyTwoFactorAction({ method: "totp", code: "123456" });
    expect(await verifyTwoFactorAction({ method: "totp", code: "123456" })).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE });
  });
});

describe("invalid input is refused [SEG-05]", () => {
  it.each([
    ["letters", { method: "totp", code: "12ab56" }],
    ["too short", { method: "totp", code: "123" }],
    ["bad backup code", { method: "backup", code: "abc" }],
    ["unknown method", { method: "sms", code: "123456" }],
    ["nothing", null],
  ])("%s", async (_label, input) => {
    expect((await verifyTwoFactorAction(input)).ok).toBe(false);
  });
});
