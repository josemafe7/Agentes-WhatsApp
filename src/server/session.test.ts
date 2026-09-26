import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("./auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { businessSettings, userRoles } from "@/db/schema";
import { PERMISSIONS } from "@/lib/permissions";
import { createBusiness, createChannel, createUser } from "@/test/factories";
import { AuthError } from "./errors";
import { getActor, requireActor, requirePageActor, requirePermission, resolveActor } from "./session";

const signIn = (userId: string | null) => {
  state.session = userId ? { session: { id: `s-${userId}` }, user: { id: userId } } : null;
};

beforeAll(async () => {
  await createBusiness();
});

beforeEach(async () => {
  signIn(null);
  await db.update(businessSettings).set({ require2faAdmins: false });
});

describe("resolveActor [PER-02] [USU-14]", () => {
  it("loads role, name and channels of the signed-in user", async () => {
    const channel = await createChannel();
    const agent = await createUser("agent", { channelIds: [channel.id] });
    expect(await resolveActor({ session: { id: "s1" }, user: { id: agent.userId } })).toMatchObject({
      userId: agent.userId,
      role: "agent",
      channelIds: [channel.id],
      email: agent.email,
      sessionId: "s1",
      twoFactorSetupRequired: false,
    });
  });

  it("returns null without session, for deactivated users and for unknown users", async () => {
    const disabled = await createUser("admin", { disabled: true });
    expect(await resolveActor(null)).toBeNull();
    expect(await resolveActor({ session: { id: "s" }, user: { id: disabled.userId } })).toBeNull();
    expect(await resolveActor({ session: { id: "s" }, user: { id: crypto.randomUUID() } })).toBeNull();
  });
});

describe("requireActor / requirePermission (actions and routes) [SEG-04]", () => {
  it("401 without a session", async () => {
    const error = await requireActor().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(401);
  });

  it("returns the actor with a session, and 403 without the permission", async () => {
    const viewer = await createUser("viewer");
    signIn(viewer.userId);
    expect((await getActor())?.role).toBe("viewer");
    expect((await requireActor()).userId).toBe(viewer.userId);
    await expect(requirePermission(PERMISSIONS.reports.view)).resolves.toMatchObject({ role: "viewer" });
    const error = await requirePermission(PERMISSIONS.settings.business).catch((e: unknown) => e);
    expect((error as AuthError).status).toBe(403);
  });

  it("an admin without 2FA gets 403 while it is required, except where setting it up is allowed [USU-12]", async () => {
    const admin = await createUser("admin");
    signIn(admin.userId);
    await db.update(businessSettings).set({ require2faAdmins: true });
    await expect(requireActor()).rejects.toMatchObject({ code: "two_factor_required", status: 403 });
    await expect(requireActor({ allowTwoFactorSetup: true })).resolves.toMatchObject({ role: "admin" });
  });
});

describe("requirePageActor (pages) [USU-02]", () => {
  it("redirects to /login and back to the page afterwards", async () => {
    await expect(requirePageActor({ next: "/contactos?filtro=1" })).rejects.toThrow(
      "REDIRECT:/login?next=%2Fcontactos%3Ffiltro%3D1",
    );
    await expect(requirePageActor({ next: "https://evil.example/" })).rejects.toThrow("REDIRECT:/login");
  });

  it("sends owners and admins who must set up 2FA to Mi cuenta [USU-12]", async () => {
    const owner = await createUser("owner");
    signIn(owner.userId);
    await db.update(businessSettings).set({ require2faAdmins: true });
    await expect(requirePageActor()).rejects.toThrow("REDIRECT:/perfil?dos-pasos=obligatorio");
    await expect(requirePageActor({ allowTwoFactorSetup: true })).resolves.toMatchObject({ role: "owner" });
  });

  it("only in-app paths are accepted as the return target", async () => {
    await expect(requirePageActor({ next: "/bandeja" })).rejects.toThrow("REDIRECT:/login?next=%2Fbandeja");
    for (const next of ["//evil.example", "https://evil.example", "/\\evil", undefined]) {
      await expect(requirePageActor({ next })).rejects.toThrow(/^REDIRECT:\/login$/);
    }
  });
});

describe("a role change applies on the next request [USU-14]", () => {
  it("reads the role from the database every time", async () => {
    const member = await createUser("supervisor");
    signIn(member.userId);
    expect((await requireActor()).role).toBe("supervisor");
    await db.update(userRoles).set({ role: "viewer" }).where(eq(userRoles.userId, member.userId));
    expect((await requireActor()).role).toBe("viewer");
  });
});
