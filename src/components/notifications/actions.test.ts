import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { notifications, userRoles } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});

import { loadNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

let owner: TestUser;
let agentA: TestUser;
let channelA: string;
let channelB: string;

const insert = async (userId: string, overrides: Partial<typeof notifications.$inferInsert> = {}) => {
  const [row] = await db
    .insert(notifications)
    .values({ userId, event: "handoff", title: "Traspaso: Ana", link: "/bandeja/00000000-0000-4000-8000-000000000001", ...overrides })
    .returning();
  return row;
};
const readAt = async (id: string) => (await db.select().from(notifications).where(eq(notifications.id, id)))[0]?.readAt ?? null;

beforeAll(async () => {
  await createBusiness({ timezone: "Europe/Madrid" });
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "Web A" })).id;
  channelB = (await createChannel({ name: "Web B" })).id;
  owner = await createUser("owner", { name: "Olga" });
  agentA = await createUser("agent", { name: "Aitor", channelIds: [channelA] });
});

beforeEach(async () => {
  await db.delete(notifications);
  state.actor = owner.actor;
});

describe("notifications bell [PWA-06] [PWA-08]", () => {
  it("lists the person's own notices, newest first, with the unread count and the business time zone", async () => {
    await insert(owner.userId, { title: "Antigua", createdAt: new Date(Date.now() - 60_000), readAt: new Date() });
    await insert(owner.userId, { title: "Nueva", createdAt: new Date() });
    await insert(agentA.userId, { title: "De otra persona" });
    const result = await loadNotificationsAction();
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("sin datos");
    expect(result.data.items.map((item) => item.title)).toEqual(["Nueva", "Antigua"]);
    expect(result.data.unread).toBe(1);
    expect(result.data.timezone).toBe("Europe/Madrid");
  });

  it("an agent never sees a notice of a channel that is not theirs", async () => {
    await insert(agentA.userId, { title: "Canal A", channelId: channelA });
    await insert(agentA.userId, { title: "Canal B", channelId: channelB });
    state.actor = agentA.actor;
    const result = await loadNotificationsAction();
    expect(result.ok && result.data?.items.map((item) => item.title)).toEqual(["Canal A"]);
    expect(result.ok && result.data?.unread).toBe(1);
  });

  it("marks one as read; someone else's stays as it was", async () => {
    const mine = await insert(owner.userId);
    const theirs = await insert(agentA.userId);
    expect(await markNotificationReadAction({ notificationId: mine.id })).toEqual({ ok: true });
    expect(await readAt(mine.id)).not.toBeNull();
    expect(await markNotificationReadAction({ notificationId: theirs.id })).toEqual({ ok: true });
    expect(await readAt(theirs.id)).toBeNull();
    expect(await markNotificationReadAction({ notificationId: "no-es-un-id" })).toMatchObject({ ok: false });
  });

  it("«Marcar todo como leído» only touches the person's notices", async () => {
    const [a, b] = [await insert(owner.userId), await insert(owner.userId)];
    const theirs = await insert(agentA.userId);
    expect(await markAllNotificationsReadAction()).toEqual({ ok: true });
    expect(await readAt(a.id)).not.toBeNull();
    expect(await readAt(b.id)).not.toBeNull();
    expect(await readAt(theirs.id)).toBeNull();
  });

  it("without a session nothing is read or changed", async () => {
    const mine = await insert(owner.userId);
    state.actor = null;
    const expired = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };
    expect(await loadNotificationsAction()).toEqual(expired);
    expect(await markNotificationReadAction({ notificationId: mine.id })).toEqual(expired);
    expect(await markAllNotificationsReadAction()).toEqual(expired);
    expect(await readAt(mine.id)).toBeNull();
  });
});
