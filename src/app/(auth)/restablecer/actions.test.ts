// New password from the one-time link, with real Better Auth on this file's own database.
import { desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { db } from "@/db";
import { jobs, verification } from "@/db/schema";
import { auth } from "@/server/auth";
import { SYSTEM_EMAIL_JOB } from "@/server/jobs/handlers/system-email";
import { createBusiness, createUser } from "@/test/factories";
import { RESET_LINK_INVALID_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE } from "../_lib/messages";
import { serverSignIn, nextTestIp, sessionCount, storedResetIdentifier } from "../_lib/test-helpers";
import { resetPasswordAction } from "./actions";

const NEW_PASSWORD = "nueva-clave-segura-1";

/** Token of the reset link Better Auth emails (read from the queued email). */
async function resetTokenFor(email: string): Promise<string> {
  await auth.api.requestPasswordReset({ body: { email, redirectTo: "/restablecer" } });
  const [queued] = await db.select().from(jobs).where(eq(jobs.type, SYSTEM_EMAIL_JOB)).orderBy(desc(jobs.createdAt)).limit(1);
  const url = new URL((queued.payload as { url: string }).url);
  return url.pathname.split("/").at(-1) ?? "";
}

beforeAll(async () => {
  await createBusiness();
});

beforeEach(() => {
  request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
});

describe("setting a new password from the link [USU-10]", () => {
  it("changes it, closes every session and sends to /login with a notice", async () => {
    const member = await createUser("agent");
    expect((await serverSignIn(member.email, member.password)).status).toBe(200);
    expect(await sessionCount(member.userId)).toBe(1);
    const token = await resetTokenFor(member.email);
    await expect(resetPasswordAction({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).rejects.toThrow(
      "REDIRECT:/login?aviso=contrasena-cambiada",
    );
    expect(await sessionCount(member.userId)).toBe(0);
    expect((await serverSignIn(member.email, member.password)).status).toBe(401);
    expect((await serverSignIn(member.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("the link works only once", async () => {
    const member = await createUser("agent");
    const token = await resetTokenFor(member.email);
    await expect(resetPasswordAction({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).rejects.toThrow("REDIRECT:");
    expect(await resetPasswordAction({ token, password: "otra-clave-segura-2", confirmPassword: "otra-clave-segura-2" })).toEqual({
      ok: false,
      error: RESET_LINK_INVALID_MESSAGE,
    });
    expect((await serverSignIn(member.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("an expired or made-up link changes nothing", async () => {
    const member = await createUser("agent");
    const token = await resetTokenFor(member.email);
    await db.update(verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verification.identifier, storedResetIdentifier(token)));
    expect(await resetPasswordAction({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({
      ok: false,
      error: RESET_LINK_INVALID_MESSAGE,
    });
    expect(await resetPasswordAction({ token: "inventado123", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({
      ok: false,
      error: RESET_LINK_INVALID_MESSAGE,
    });
    expect((await serverSignIn(member.email, member.password)).status).toBe(200);
  });
});

describe("the new password follows the rules [SEG-05]", () => {
  it("both passwords must match", async () => {
    const result = await resetPasswordAction({ token: "abc", password: NEW_PASSWORD, confirmPassword: "otra-distinta-99" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.confirmPassword).toBeDefined();
  });

  it("at least 8 characters, and a well-formed token", async () => {
    const short = await resetPasswordAction({ token: "abc", password: "corta", confirmPassword: "corta" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.fieldErrors?.password).toBeDefined();
    const badToken = await resetPasswordAction({ token: "../../etc", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(badToken.ok).toBe(false);
  });
});

describe("attempts are rate limited per IP [SEG-07]", () => {
  it("more than 10 in 15 minutes from one IP are refused", async () => {
    request.headers = new Headers({ "x-forwarded-for": "192.0.2.99" });
    for (let attempt = 0; attempt < 10; attempt++) {
      await resetPasswordAction({ token: `inventado${attempt}`, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    }
    expect(await resetPasswordAction({ token: "inventado", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({
      ok: false,
      error: TOO_MANY_ATTEMPTS_MESSAGE,
    });
  });
});
