import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { contactIdentities, contacts, conversations, messageRetrievals, messages, userRoles } from "@/db/schema";
import { AuthError } from "@/server/errors";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { listMessageSources } from "./message-sources";

let users: Record<"owner" | "agentA" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let inA: typeof conversations.$inferSelect;
let inB: typeof conversations.$inferSelect;
let aiInA: typeof messages.$inferSelect;
let aiInB: typeof messages.$inferSelect;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "Web A" })).id;
  channelB = (await createChannel({ name: "Web B" })).id;
  users = {
    owner: await createUser("owner"),
    agentA: await createUser("agent", { channelIds: [channelA] }),
    viewer: await createUser("viewer"),
  };
});

beforeEach(async () => {
  for (const table of [messageRetrievals, messages, conversations, contactIdentities, contacts]) await db.delete(table);
  const ana = await createContactWithIdentity("webchat", { name: "Ana" });
  const bruno = await createContactWithIdentity("webchat", { name: "Bruno" });
  inA = await createConversation(channelA, ana.contact.id);
  inB = await createConversation(channelB, bruno.contact.id);
  aiInA = await createMessage(inA, { direction: "outbound", senderType: "ai", agentName: "Nuria", status: "sent", text: "Abrimos a las 9." });
  aiInB = await createMessage(inB, { direction: "outbound", senderType: "ai", agentName: "Nuria", status: "sent", text: "Sí." });
  await db.insert(messageRetrievals).values([
    { messageId: aiInA.id, rank: 2, score: 0.41, title: "Tarifas", section: "Cortes", page: 3 },
    { messageId: aiInA.id, rank: 1, score: 0.87, title: "Horario", section: "Semana", page: null },
    { messageId: aiInB.id, rank: 1, score: 0.5, title: "Otra base", section: null, page: null },
  ]);
});

describe("«¿Por qué respondió esto?» [BAN-07] [PER-02]", () => {
  it("returns the fragments of each AI answer of the conversation, numbered by rank", async () => {
    const sources = await listMessageSources(users.owner.actor, { conversationId: inA.id, messageIds: [aiInA.id] });
    expect(Object.keys(sources)).toEqual([aiInA.id]);
    expect(sources[aiInA.id]?.map((source) => [source.rank, source.title, source.section, source.page, source.score])).toEqual([
      [1, "Horario", "Semana", null, 0.87],
      [2, "Tarifas", "Cortes", 3, 0.41],
    ]);
  });

  it("never mixes in answers of another conversation, even when their ids are sent", async () => {
    const sources = await listMessageSources(users.owner.actor, { conversationId: inA.id, messageIds: [aiInA.id, aiInB.id] });
    expect(Object.keys(sources)).toEqual([aiInA.id]);
  });

  it("Solo lectura may look; an agent only in their channels", async () => {
    expect(Object.keys(await listMessageSources(users.viewer.actor, { conversationId: inA.id, messageIds: [aiInA.id] }))).toEqual([aiInA.id]);
    expect(Object.keys(await listMessageSources(users.agentA.actor, { conversationId: inA.id, messageIds: [aiInA.id] }))).toEqual([aiInA.id]);
    expect(await errorOf(listMessageSources(users.agentA.actor, { conversationId: inB.id, messageIds: [aiInB.id] }))).toBeInstanceOf(AuthError);
  });

  it("no messages asked, nothing read", async () => {
    expect(await listMessageSources(users.owner.actor, { conversationId: inA.id, messageIds: [] })).toEqual({});
  });
});
