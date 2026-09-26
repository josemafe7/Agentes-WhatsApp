// Server Actions of Ajustes › Notificaciones called directly ([SEG-04], [AJU-08], [USU-18]).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { businessSettings, userRoles } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createBusiness, createUser } from "@/test/factories";
import { saveMyNotificationPreferencesAction, saveNotificationSettingsAction } from "./actions";

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
  return person;
};

beforeEach(async () => {
  state.session = null;
  await createBusiness({ notificationSettings: {} });
});

describe("saveNotificationSettingsAction", () => {
  it("owner saves who is notified", async () => {
    await signInAs("owner");
    const result = await saveNotificationSettingsAction(undefined, {
      events: { handoff: { enabled: true, roles: ["owner", "agent"] } },
    });
    expect(result).toEqual({ ok: true, message: "Cambios guardados." });
    const [row] = await db.select().from(businessSettings);
    expect(row.notificationSettings.handoff).toEqual({ enabled: true, roles: ["owner", "agent"] });
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot change the business notifications", async (role) => {
    await signInAs(role);
    const result = await saveNotificationSettingsAction(undefined, { events: { handoff: { enabled: false, roles: [] } } });
    expect(result).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    const [row] = await db.select().from(businessSettings);
    expect(row.notificationSettings).toEqual({});
  });
});

describe("saveMyNotificationPreferencesAction", () => {
  it.each<Role>(["owner", "admin", "supervisor", "agent", "viewer"])("%s saves their own preferences", async (role) => {
    const me = await signInAs(role);
    const result = await saveMyNotificationPreferencesAction(undefined, { handoff: { inApp: true, push: false, email: false } });
    expect(result).toEqual({ ok: true, message: "Preferencias guardadas." });
    const [row] = await db.select().from(userRoles).where(eq(userRoles.userId, me.userId));
    expect(row.notificationPreferences.handoff).toEqual({ inApp: true, push: false, email: false });
  });

  it("without a session changes nothing", async () => {
    const result = await saveMyNotificationPreferencesAction(undefined, { handoff: { inApp: false } });
    expect(result.ok).toBe(false);
  });
});
