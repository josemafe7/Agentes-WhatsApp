import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { internalNotes, messages, userRoles } from "@/db/schema";
import { AuthError, ValidationError } from "@/server/errors";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { addNote, listNotes } from "./notes";

let users: Record<"supervisor" | "agentA" | "viewer", TestUser>;
let inA: { id: string };
let inB: { id: string };

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  await createBusiness();
  await db.delete(userRoles);
  const channelA = (await createChannel({ name: "A" })).id;
  const channelB = (await createChannel({ name: "B" })).id;
  users = {
    supervisor: await createUser("supervisor", { name: "Susana" }),
    agentA: await createUser("agent", { name: "Aitor", channelIds: [channelA] }),
    viewer: await createUser("viewer"),
  };
  inA = await createConversation(channelA, (await createContactWithIdentity("webchat")).contact.id);
  inB = await createConversation(channelB, (await createContactWithIdentity("webchat")).contact.id);
});

describe("internal notes [BAN-07] [USU-15]", () => {
  it("are written with their author and read in order, never as messages to the customer", async () => {
    await addNote(users.agentA.actor, { conversationId: inA.id, text: "Cliente habitual, prefiere mañanas" });
    await addNote(users.supervisor.actor, { conversationId: inA.id, text: "OK" });
    const notes = await listNotes(users.viewer.actor, inA.id);
    expect(notes.map((note) => [note.authorName, note.text])).toEqual([
      ["Aitor", "Cliente habitual, prefiere mañanas"],
      ["Susana", "OK"],
    ]);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("Solo lectura reads but cannot write; agents only in their channels", async () => {
    expect(await errorOf(addNote(users.viewer.actor, { conversationId: inA.id, text: "x" }))).toBeInstanceOf(AuthError);
    expect(await errorOf(addNote(users.agentA.actor, { conversationId: inB.id, text: "x" }))).toBeInstanceOf(AuthError);
    expect(await errorOf(listNotes(users.agentA.actor, inB.id))).toBeInstanceOf(AuthError);
    expect(await errorOf(addNote(users.supervisor.actor, { conversationId: inA.id, text: "  " }))).toBeInstanceOf(ValidationError);
    expect((await db.select().from(internalNotes)).every((note) => note.conversationId === inA.id)).toBe(true);
  });
});
