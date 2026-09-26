import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { businessSettings, userRoles } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { AuthError, ValidationError } from "@/server/errors";
import { actorFor, createBusiness, createUser } from "@/test/factories";
import {
  getMyNotificationPreferences,
  getNotificationSettings,
  NOTIFICATION_EVENTS,
  resolveNotificationPreferences,
  resolveNotificationSettings,
  updateMyNotificationPreferences,
  updateNotificationSettings,
} from "./notification-settings";

const owner = actorFor("owner");
const admin = actorFor("admin");
const denied: Role[] = ["supervisor", "agent", "viewer"];

beforeEach(async () => {
  await createBusiness({ notificationSettings: {} });
});

describe("defaults", () => {
  it("covers hand-offs, new and assigned conversations, channel errors, WhatsApp quality and retiring models [AJU-08]", () => {
    expect([...NOTIFICATION_EVENTS]).toEqual([
      "handoff",
      "new_conversation",
      "conversation_assigned",
      "channel_error",
      "whatsapp_quality",
      "model_deprecated",
    ]);
    const settings = resolveNotificationSettings({});
    expect(settings.handoff).toEqual({ enabled: true, roles: ["owner", "admin", "supervisor", "agent"] });
    expect(settings.channel_error).toEqual({ enabled: true, roles: ["owner", "admin"] });
    expect(settings.new_conversation.enabled).toBe(false);
  });

  it("ignores stored keys that are not events and fills the missing ones", () => {
    const settings = resolveNotificationSettings({ handoff: { enabled: false, roles: ["owner"] }, raro: { enabled: true, roles: [] } });
    expect(settings.handoff).toEqual({ enabled: false, roles: ["owner"] });
    expect(Object.keys(settings)).toEqual([...NOTIFICATION_EVENTS]);
  });

  it("each person gets in-app and push by default; email only for the important ones", () => {
    const preferences = resolveNotificationPreferences({ handoff: { push: false } });
    expect(preferences.handoff).toEqual({ inApp: true, push: false, email: true });
    expect(preferences.new_conversation).toEqual({ inApp: true, push: true, email: false });
  });
});

describe("Ajustes › Notificaciones: what notifies and who by default [AJU-08]", () => {
  it("owner and admin choose the events and the roles", async () => {
    await updateNotificationSettings(owner, {
      events: {
        handoff: { enabled: true, roles: ["owner", "supervisor"] },
        new_conversation: { enabled: true, roles: ["agent"] },
      },
    });
    const settings = await getNotificationSettings(admin);
    expect(settings.handoff).toEqual({ enabled: true, roles: ["owner", "supervisor"] });
    expect(settings.new_conversation).toEqual({ enabled: true, roles: ["agent"] });
    expect(settings.channel_error).toEqual({ enabled: true, roles: ["owner", "admin"] });
  });

  it("rejects unknown events and roles and saves nothing", async () => {
    await expect(
      updateNotificationSettings(owner, { events: { fiesta: { enabled: true, roles: ["owner"] } } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateNotificationSettings(owner, { events: { handoff: { enabled: true, roles: ["superadmin"] } } }),
    ).rejects.toBeInstanceOf(ValidationError);
    const [row] = await db.select().from(businessSettings);
    expect(row.notificationSettings).toEqual({});
  });

  it("an enabled event that notifies by role needs at least one role", async () => {
    const error = await updateNotificationSettings(owner, { events: { handoff: { enabled: true, roles: [] } } }).catch(
      (e: unknown) => e,
    );
    expect((error as ValidationError).fieldErrors?.handoff?.[0]).toBe("Elige al menos un rol o desactiva este aviso.");
  });

  it.each(denied)("%s cannot read or change the business notifications [PER-03] [PER-04]", async (role) => {
    await expect(getNotificationSettings(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(
      updateNotificationSettings(actorFor(role), { events: { handoff: { enabled: false, roles: [] } } }),
    ).rejects.toBeInstanceOf(AuthError);
    const [row] = await db.select().from(businessSettings);
    expect(row.notificationSettings).toEqual({});
  });
});

describe("my notifications: in-app, push and email per event [USU-18] [PWA-07]", () => {
  it.each<Role>(["owner", "admin", "supervisor", "agent", "viewer"])("%s changes only their own preferences", async (role) => {
    const me = await createUser(role);
    const other = await createUser("supervisor");
    await updateMyNotificationPreferences(me.actor, { handoff: { inApp: true, push: false, email: false } });
    const mine = await getMyNotificationPreferences(me.actor);
    expect(mine.preferences.handoff).toEqual({ inApp: true, push: false, email: false });
    const [otherRow] = await db.select().from(userRoles).where(eq(userRoles.userId, other.userId));
    expect(otherRow.notificationPreferences).toEqual({});
  });

  it("says which events reach the person's role", async () => {
    const agent = await createUser("agent");
    const mine = await getMyNotificationPreferences(agent.actor);
    expect(mine.events.find((event) => event.key === "handoff")?.reachesMe).toBe(true);
    expect(mine.events.find((event) => event.key === "channel_error")?.reachesMe).toBe(false);
    // Assigned conversations reach whoever is assigned, whatever their role.
    expect(mine.events.find((event) => event.key === "conversation_assigned")?.reachesMe).toBe(true);
  });

  it("rejects unknown events and values", async () => {
    const me = await createUser("agent");
    await expect(updateMyNotificationPreferences(me.actor, { fiesta: { inApp: true } })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateMyNotificationPreferences(me.actor, { handoff: { push: "sí" } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("an actor without a user row changes nothing", async () => {
    await expect(
      updateMyNotificationPreferences(actorFor("agent"), { handoff: { inApp: false, push: false, email: false } }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
