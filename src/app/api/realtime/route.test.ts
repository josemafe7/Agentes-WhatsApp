import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { realtimeEvents, userRoles } from "@/db/schema";
import { publishConversationEvent, publishNotificationEvent } from "@/server/realtime/events";
import { createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { GET, runtime } from "./route";

let owner: TestUser;
let agentA: TestUser;
let channelA: string;
let channelB: string;

const signIn = (user: TestUser | null) => {
  state.session = user ? { session: { id: `s-${user.userId}` }, user: { id: user.userId } } : null;
};
const poll = async (cursor?: string) => {
  const response = await GET(new Request(`http://localhost:3000/api/realtime${cursor !== undefined ? `?cursor=${cursor}` : ""}`));
  return { status: response.status, body: (await response.json()) as { cursor: string; events: { type: string; cursor: string; conversationId?: string }[]; error?: string } };
};

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "A" })).id;
  channelB = (await createChannel({ name: "B" })).id;
  owner = await createUser("owner");
  agentA = await createUser("agent", { channelIds: [channelA] });
});

beforeEach(async () => {
  await db.delete(realtimeEvents);
  signIn(null);
});

describe("/api/realtime [BAN-03] [PER-02]", () => {
  it("runs on Node and needs a session", async () => {
    expect(runtime).toBe("nodejs");
    const { status } = await poll("0");
    expect(status).toBe(401);
  });

  it("starts from now without a cursor, then returns only what the person may see", async () => {
    signIn(agentA);
    const start = await poll();
    expect(start.body.events).toEqual([]);
    await publishConversationEvent({ type: "conversation.updated", conversationId: "c-a", channelId: channelA, change: "inbound" });
    await publishConversationEvent({ type: "conversation.updated", conversationId: "c-b", channelId: channelB, change: "inbound" });
    await publishNotificationEvent({ notificationId: "n-agent", userId: agentA.userId });
    await publishNotificationEvent({ notificationId: "n-owner", userId: owner.userId });

    const agentView = await poll(start.body.cursor);
    expect(agentView.body.events.map((event) => [event.type, event.conversationId ?? null])).toEqual([
      ["conversation.updated", "c-a"],
      ["notification.created", null],
    ]);
    signIn(owner);
    const ownerView = await poll(start.body.cursor);
    expect(ownerView.body.events.map((event) => event.type)).toEqual(["conversation.updated", "conversation.updated", "notification.created"]);
    // Nothing new after the returned cursor.
    expect((await poll(ownerView.body.cursor)).body.events).toEqual([]);
  });

  it("rejects a malformed cursor", async () => {
    signIn(owner);
    expect((await poll("abc")).status).toBe(400);
  });
});
