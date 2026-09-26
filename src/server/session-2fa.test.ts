import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { session: { id: string }; user: { id: string } },
  headers: new Headers(),
}));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("./auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { businessSettings, user } from "@/db/schema";
import { REQUEST_PATH_HEADER } from "@/lib/auth-paths";
import { actorFor, createBusiness, createUser } from "@/test/factories";
import { isTwoFactorRequiredFor, requireTwoFactorCompliance } from "./session-2fa";

function signIn(userId: string | null): void {
  state.session = userId ? { session: { id: `s-${userId}` }, user: { id: userId } } : null;
}

function on(path: string | null): void {
  state.headers = new Headers(path ? { [REQUEST_PATH_HEADER]: path } : {});
}

async function requireTwoFactor(enabled: boolean): Promise<void> {
  await db.update(businessSettings).set({ require2faAdmins: enabled });
}

beforeAll(async () => {
  await createBusiness();
});

beforeEach(async () => {
  signIn(null);
  on("/bandeja");
  await requireTwoFactor(false);
});

describe("(app) layout: signed out goes to /login and comes back [USU-02]", () => {
  it("keeps the requested page as `next`", async () => {
    on("/contactos?filtro=vip");
    await expect(requireTwoFactorCompliance()).rejects.toThrow("REDIRECT:/login?next=%2Fcontactos%3Ffiltro%3Dvip");
  });

  it("without the path header it still sends to /login", async () => {
    on(null);
    await expect(requireTwoFactorCompliance()).rejects.toThrow("REDIRECT:/login");
  });

  it("returns the actor when signed in", async () => {
    const member = await createUser("agent");
    signIn(member.userId);
    await expect(requireTwoFactorCompliance()).resolves.toMatchObject({ userId: member.userId, role: "agent" });
  });
});

describe("«Exigir verificación en dos pasos» for owner and admins [USU-12]", () => {
  it("an owner or admin without 2FA is sent to Mi cuenta from any other page", async () => {
    await requireTwoFactor(true);
    for (const role of ["owner", "admin"] as const) {
      const member = await createUser(role);
      signIn(member.userId);
      for (const path of ["/bandeja", "/ajustes/usuarios", "/perfilx"]) {
        on(path);
        await expect(requireTwoFactorCompliance(), `${role} ${path}`).rejects.toThrow("REDIRECT:/perfil?dos-pasos=obligatorio");
      }
    }
  });

  it("…but can stay on Mi cuenta to set it up (no redirect loop)", async () => {
    await requireTwoFactor(true);
    const owner = await createUser("owner");
    signIn(owner.userId);
    on("/perfil?dos-pasos=obligatorio");
    await expect(requireTwoFactorCompliance()).resolves.toMatchObject({ role: "owner", twoFactorSetupRequired: true });
  });

  it("without the path header it fails closed and redirects", async () => {
    await requireTwoFactor(true);
    const admin = await createUser("admin");
    signIn(admin.userId);
    on(null);
    await expect(requireTwoFactorCompliance()).rejects.toThrow("REDIRECT:/perfil?dos-pasos=obligatorio");
  });

  it("does not affect other roles, admins who already use 2FA, or anyone while it is off", async () => {
    await requireTwoFactor(true);
    const supervisor = await createUser("supervisor");
    signIn(supervisor.userId);
    await expect(requireTwoFactorCompliance()).resolves.toMatchObject({ role: "supervisor" });

    const admin = await createUser("admin");
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, admin.userId));
    signIn(admin.userId);
    await expect(requireTwoFactorCompliance()).resolves.toMatchObject({ role: "admin" });

    await requireTwoFactor(false);
    const owner = await createUser("owner");
    signIn(owner.userId);
    await expect(requireTwoFactorCompliance()).resolves.toMatchObject({ role: "owner" });
  });

  it("isTwoFactorRequiredFor: only owner and admin, and only while the setting is on", async () => {
    expect(await isTwoFactorRequiredFor(actorFor("owner"))).toBe(false);
    await requireTwoFactor(true);
    expect(await isTwoFactorRequiredFor(actorFor("owner"))).toBe(true);
    expect(await isTwoFactorRequiredFor(actorFor("admin"))).toBe(true);
    for (const role of ["supervisor", "agent", "viewer"] as const) expect(await isTwoFactorRequiredFor(actorFor(role))).toBe(false);
  });
});
