// Sign-in Server Action with real Better Auth on this file's own database.
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
import { auditLog, businessSettings } from "@/db/schema";
import { createBusiness, createUser } from "@/test/factories";
import { ACCOUNT_DISABLED_MESSAGE, INVALID_CREDENTIALS_MESSAGE, TOO_MANY_ATTEMPTS_MESSAGE } from "../_lib/messages";
import { enableTwoFactorFor, nextTestIp, sessionCount } from "../_lib/test-helpers";
import { signInAction } from "./actions";

const WRONG_PASSWORD = "no-es-esta-123";

function fromNewIp(): void {
  request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
}

async function auditRows(action: string, userId?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.action, action));
  return userId ? rows.filter((row) => row.targetId === userId) : rows;
}

beforeAll(async () => {
  await createBusiness();
});

beforeEach(async () => {
  fromNewIp();
  await db.update(businessSettings).set({ require2faAdmins: false, setupCompletedAt: new Date() });
});

describe("sign in with email and password [USU-01]", () => {
  it("with the right credentials opens a session, goes to the inbox and logs the «entrada»", async () => {
    const member = await createUser("supervisor");
    await expect(signInAction({ email: member.email.toUpperCase(), password: member.password })).rejects.toThrow(
      "REDIRECT:/bandeja",
    );
    expect(await sessionCount(member.userId)).toBe(1);
    const [entry] = await auditRows("auth.login", member.userId);
    expect(entry).toMatchObject({ actorType: "user", actorUserId: member.userId, metadata: { twoFactor: false } });
  });

  it("a wrong password and an unknown email get the same generic message [SEG-14]", async () => {
    const member = await createUser("agent");
    const wrong = await signInAction({ email: member.email, password: WRONG_PASSWORD });
    const unknown = await signInAction({ email: "nadie@example.com", password: WRONG_PASSWORD });
    expect(wrong).toEqual({ ok: false, error: INVALID_CREDENTIALS_MESSAGE });
    expect(unknown).toEqual(wrong);
    expect(await sessionCount(member.userId)).toBe(0);
  });

  it("failed sign-ins go to the activity log without the password or the typed email [SEG-10]", async () => {
    const member = await createUser("agent");
    await signInAction({ email: member.email, password: WRONG_PASSWORD });
    await signInAction({ email: "desconocido@example.com", password: WRONG_PASSWORD });
    const failures = await auditRows("auth.login_failed");
    expect(failures.filter((row) => row.targetId === member.userId)).toHaveLength(1);
    expect(failures.some((row) => row.targetId === null)).toBe(true);
    const logged = JSON.stringify(failures);
    expect(logged).not.toContain(WRONG_PASSWORD);
    expect(logged).not.toContain("desconocido@example.com");
    expect(logged).not.toContain(member.email);
  });
});

describe("back to the page that was asked for [USU-02]", () => {
  it("goes to `next` when it is a page of the app", async () => {
    const member = await createUser("viewer");
    await expect(signInAction({ email: member.email, password: member.password, next: "/contactos?filtro=vip" })).rejects.toThrow(
      "REDIRECT:/contactos?filtro=vip",
    );
  });

  it("ignores a `next` that points to another site [SEG-05]", async () => {
    const member = await createUser("viewer");
    for (const next of ["https://evil.example/", "//evil.example", "/\t/evil.example", "/.//evil.example"]) {
      fromNewIp();
      await expect(signInAction({ email: member.email, password: member.password, next })).rejects.toThrow("REDIRECT:/bandeja");
    }
  });
});

describe("an unfinished setup wizard [ASI-11]", () => {
  it("signing in again as the owner goes back to its first pending step, whatever page was asked for", async () => {
    const owner = await createUser("owner");
    await db.update(businessSettings).set({ setupCompletedAt: null, setupStep: 3 });
    await expect(signInAction({ email: owner.email, password: owner.password })).rejects.toThrow("REDIRECT:/setup");
    fromNewIp();
    await expect(signInAction({ email: owner.email, password: owner.password, next: "/agenda" })).rejects.toThrow("REDIRECT:/setup");
  });

  it("other roles, who cannot continue it, go to the inbox as usual", async () => {
    const admin = await createUser("admin");
    await db.update(businessSettings).set({ setupCompletedAt: null, setupStep: 3 });
    await expect(signInAction({ email: admin.email, password: admin.password })).rejects.toThrow("REDIRECT:/bandeja");
  });
});

describe("with two-step verification the password is not enough [USU-11]", () => {
  it("sends to /dos-pasos (keeping `next`) without opening a session yet", async () => {
    const member = await createUser("admin");
    await enableTwoFactorFor(member);
    const sessionsBefore = await sessionCount(member.userId);
    await expect(signInAction({ email: member.email, password: member.password, next: "/agenda" })).rejects.toThrow(
      "REDIRECT:/dos-pasos?next=%2Fagenda",
    );
    expect(await sessionCount(member.userId)).toBe(sessionsBefore);
  });
});

describe("owners and admins who must set up 2FA go to Mi cuenta [USU-12]", () => {
  it("an admin without 2FA, while the business requires it, lands on /perfil", async () => {
    const admin = await createUser("admin");
    await db.update(businessSettings).set({ require2faAdmins: true });
    await expect(signInAction({ email: admin.email, password: admin.password, next: "/agenda" })).rejects.toThrow(
      "REDIRECT:/perfil?dos-pasos=obligatorio",
    );
  });

  it("other roles are not affected", async () => {
    const supervisor = await createUser("supervisor");
    await db.update(businessSettings).set({ require2faAdmins: true });
    await expect(signInAction({ email: supervisor.email, password: supervisor.password })).rejects.toThrow("REDIRECT:/bandeja");
  });
});

describe("repeated failures are slowed down [USU-13] [SEG-07]", () => {
  it("after 5 wrong passwords for one email, even the right one gets the limit message", async () => {
    const member = await createUser("viewer");
    for (let attempt = 0; attempt < 5; attempt++) {
      fromNewIp();
      expect(await signInAction({ email: member.email, password: WRONG_PASSWORD })).toEqual({
        ok: false,
        error: INVALID_CREDENTIALS_MESSAGE,
      });
    }
    fromNewIp();
    expect(await signInAction({ email: member.email, password: member.password })).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE });
    expect(await sessionCount(member.userId)).toBe(0);
  });

  it("a correct password starts the count again for that email", async () => {
    const member = await createUser("viewer");
    for (let round = 0; round < 2; round++) {
      for (let attempt = 0; attempt < 4; attempt++) {
        fromNewIp();
        await signInAction({ email: member.email, password: WRONG_PASSWORD });
      }
      fromNewIp();
      await expect(signInAction({ email: member.email, password: member.password })).rejects.toThrow("REDIRECT:/bandeja");
    }
  });

  it("from one IP, after 30 attempts in 15 minutes the next ones are refused", async () => {
    const member = await createUser("viewer");
    request.headers = new Headers({ "x-forwarded-for": "203.0.113.50" });
    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await signInAction({ email: `intento-${attempt}@example.com`, password: WRONG_PASSWORD })).ok).toBe(false);
    }
    expect(await signInAction({ email: member.email, password: member.password })).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE });
    // Another IP is not affected.
    fromNewIp();
    await expect(signInAction({ email: member.email, password: member.password })).rejects.toThrow("REDIRECT:/bandeja");
  });
});

describe("deactivated users cannot get in [USU-14]", () => {
  it("even with the right password: clear message and no session left", async () => {
    const member = await createUser("agent", { disabled: true });
    expect(await signInAction({ email: member.email, password: member.password })).toEqual({ ok: false, error: ACCOUNT_DISABLED_MESSAGE });
    expect(await sessionCount(member.userId)).toBe(0);
    const blocked = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "auth.login_blocked"), eq(auditLog.targetId, member.userId)));
    expect(blocked).toHaveLength(1);
  });
});

describe("invalid input is refused before trying [SEG-05]", () => {
  it.each([
    ["nothing", null],
    ["text", "email=a@example.com"],
    ["empty object", {}],
    ["bad email", { email: "no-es-un-email", password: "x" }],
    ["empty password", { email: "a@example.com", password: "" }],
    ["password too long", { email: "a@example.com", password: "x".repeat(129) }],
  ])("%s", async (_label, input) => {
    const result = await signInAction(input);
    expect(result.ok).toBe(false);
  });

  it("marks the wrong fields", async () => {
    const result = await signInAction({ email: "no-es-un-email", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["email", "password"]);
  });
});
