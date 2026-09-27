import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { notifications, userRoles } from "@/db/schema";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { countMyUnreadNotifications, listMyNotifications, markAllNotificationsRead, markNotificationRead } from "./notifications";

let me: TestUser;
let other: TestUser;
let agent: TestUser;
let channelA: string;
let channelB: string;

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "A" })).id;
  channelB = (await createChannel({ name: "B" })).id;
  me = await createUser("viewer");
  other = await createUser("admin");
  agent = await createUser("agent", { channelIds: [channelA] });
});

beforeEach(async () => {
  await db.delete(notifications);
});

describe("own notices [PWA-06] [PWA-08]", () => {
  it("each person sees and marks only their own, with the unread counter", async () => {
    const [mine] = await db.insert(notifications).values({ userId: me.userId, event: "handoff", title: "Traspaso: Ana" }).returning();
    const [theirs] = await db.insert(notifications).values({ userId: other.userId, event: "handoff", title: "Traspaso: Bruno" }).returning();
    expect((await listMyNotifications(me.actor)).map((notice) => notice.title)).toEqual(["Traspaso: Ana"]);
    expect(await countMyUnreadNotifications(me.actor)).toBe(1);
    expect(await markNotificationRead(me.actor, theirs.id)).toBe(false);
    expect(await countMyUnreadNotifications(other.actor)).toBe(1);
    expect(await markNotificationRead(me.actor, mine.id)).toBe(true);
    expect(await countMyUnreadNotifications(me.actor)).toBe(0);
    expect(await listMyNotifications(me.actor, { unreadOnly: true })).toEqual([]);
  });

  it("marks all as read", async () => {
    await db.insert(notifications).values([
      { userId: me.userId, event: "handoff", title: "1" },
      { userId: me.userId, event: "handoff", title: "2" },
    ]);
    expect(await markAllNotificationsRead(me.actor)).toBe(2);
    expect(await countMyUnreadNotifications(me.actor)).toBe(0);
  });

  it("an agent never sees a notice of a channel that is no longer theirs", async () => {
    await db.insert(notifications).values([
      { userId: agent.userId, event: "handoff", title: "Suyo", channelId: channelA },
      { userId: agent.userId, event: "handoff", title: "Ya no", channelId: channelB },
      { userId: agent.userId, event: "channel_error", title: "Sin canal" },
    ]);
    expect((await listMyNotifications(agent.actor)).map((notice) => notice.title).sort()).toEqual(["Sin canal", "Suyo"]);
    expect(await countMyUnreadNotifications(agent.actor)).toBe(2);
  });
});
