// Accepting an invitation from its link, with real Better Auth on this file's own database.
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { db } from "@/db";
import { businessSettings, invitations, user, userRoles } from "@/db/schema";
import type { InvitableRole } from "@/lib/enums";
import { hashToken, randomToken } from "@/server/crypto";
import { createBusiness } from "@/test/factories";
import { TOO_MANY_ATTEMPTS_MESSAGE } from "../../_lib/messages";
import { nextTestIp, sessionCount } from "../../_lib/test-helpers";
import { acceptInvitationAction } from "./actions";

const PASSWORD = "clave-del-invitado-1";
const DAY_MS = 24 * 60 * 60_000;
let invitationNumber = 0;

/** A pending invitation row and the token of its link. */
async function invitation(role: InvitableRole = "agent", overrides: Partial<typeof invitations.$inferInsert> = {}) {
  invitationNumber += 1;
  const token = randomToken();
  const email = `invitado-${invitationNumber}@example.com`;
  await db.insert(invitations).values({ email, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * DAY_MS), ...overrides });
  return { token, email };
}

async function userByEmail(email: string) {
  const [row] = await db
    .select({ id: user.id, name: user.name, role: userRoles.role })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.email, email));
  return row;
}

beforeAll(async () => {
  await createBusiness();
});

beforeEach(async () => {
  request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
  await db.update(businessSettings).set({ require2faAdmins: false });
});

describe("accepting an invitation [USU-07]", () => {
  it("creates the account with the invited role, signs in and goes to the inbox", async () => {
    const { token, email } = await invitation("supervisor");
    await expect(acceptInvitationAction({ token, name: "  Lucía Pérez ", password: PASSWORD, confirmPassword: PASSWORD })).rejects.toThrow(
      "REDIRECT:/bandeja",
    );
    const created = await userByEmail(email);
    expect(created).toMatchObject({ name: "Lucía Pérez", role: "supervisor" });
    expect(await sessionCount(created.id)).toBe(1);
  });

  it("an invited admin who must use 2FA goes straight to set it up [USU-12]", async () => {
    await db.update(businessSettings).set({ require2faAdmins: true });
    const { token } = await invitation("admin");
    await expect(acceptInvitationAction({ token, name: "Admin Nuevo", password: PASSWORD, confirmPassword: PASSWORD })).rejects.toThrow(
      "REDIRECT:/perfil?dos-pasos=obligatorio",
    );
  });
});

describe("used, revoked or expired links create nothing [USU-08]", () => {
  it.each([
    ["used", { acceptedAt: new Date() }],
    ["revoked", { revokedAt: new Date() }],
    ["expired", { expiresAt: new Date(Date.now() - 1000) }],
  ])("%s", async (_label, overrides) => {
    const { token, email } = await invitation("agent", overrides);
    const result = await acceptInvitationAction({ token, name: "Alguien", password: PASSWORD, confirmPassword: PASSWORD });
    expect(result).toEqual({ ok: false, error: "Esta invitación ya no es válida. Pide una nueva al propietario." });
    expect(await userByEmail(email)).toBeUndefined();
  });

  it("the same link cannot be used twice", async () => {
    const { token } = await invitation("viewer");
    await expect(acceptInvitationAction({ token, name: "Primera", password: PASSWORD, confirmPassword: PASSWORD })).rejects.toThrow(
      "REDIRECT:",
    );
    request.headers = new Headers({ "x-forwarded-for": nextTestIp() });
    expect((await acceptInvitationAction({ token, name: "Segunda", password: PASSWORD, confirmPassword: PASSWORD })).ok).toBe(false);
  });

  it("a made-up link creates nothing", async () => {
    const result = await acceptInvitationAction({ token: randomToken(), name: "Nadie", password: PASSWORD, confirmPassword: PASSWORD });
    expect(result.ok).toBe(false);
  });
});

describe("the form is validated on the server [SEG-05]", () => {
  it("passwords must match and follow the rules, and the name is required", async () => {
    const { token, email } = await invitation("agent");
    const mismatch = await acceptInvitationAction({ token, name: "Ana", password: PASSWORD, confirmPassword: "otra-clave-999" });
    const short = await acceptInvitationAction({ token, name: "Ana", password: "corta", confirmPassword: "corta" });
    const noName = await acceptInvitationAction({ token, name: "   ", password: PASSWORD, confirmPassword: PASSWORD });
    for (const [result, field] of [
      [mismatch, "confirmPassword"],
      [short, "password"],
      [noName, "name"],
    ] as const) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors?.[field]).toBeDefined();
    }
    expect(await userByEmail(email)).toBeUndefined();
  });
});

describe("attempts are rate limited per IP [SEG-07]", () => {
  it("more than 10 in 15 minutes from one IP are refused", async () => {
    request.headers = new Headers({ "x-forwarded-for": "192.0.2.123" });
    for (let attempt = 0; attempt < 10; attempt++) {
      await acceptInvitationAction({ token: randomToken(), name: "Prueba", password: PASSWORD, confirmPassword: PASSWORD });
    }
    const { token } = await invitation("agent");
    expect(await acceptInvitationAction({ token, name: "Prueba", password: PASSWORD, confirmPassword: PASSWORD })).toEqual({
      ok: false,
      error: TOO_MANY_ATTEMPTS_MESSAGE,
    });
  });
});
