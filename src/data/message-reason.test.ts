import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { aiRuns, contactIdentities, contacts, conversations, knowledgeBases, messageRetrievals, messages, userRoles } from "@/db/schema";
import { AuthError, NotFoundError, ValidationError } from "@/server/errors";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { getMessageReason } from "./message-reason";

let users: Record<"owner" | "supervisor" | "agentA" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let inA: typeof conversations.$inferSelect;
let inB: typeof conversations.$inferSelect;
let aiInA: typeof messages.$inferSelect;
let humanInA: typeof messages.$inferSelect;
let customerInA: typeof messages.$inferSelect;
let aiInB: typeof messages.$inferSelect;
let kbId: string;

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
    supervisor: await createUser("supervisor"),
    agentA: await createUser("agent", { channelIds: [channelA] }),
    viewer: await createUser("viewer"),
  };
});

beforeEach(async () => {
  for (const table of [aiRuns, messageRetrievals, messages, conversations, contactIdentities, contacts, knowledgeBases]) await db.delete(table);
  [{ id: kbId }] = await db.insert(knowledgeBases).values({ name: "Peluquería" }).returning({ id: knowledgeBases.id });
  const ana = await createContactWithIdentity("webchat", { name: "Ana" });
  const bruno = await createContactWithIdentity("webchat", { name: "Bruno" });
  inA = await createConversation(channelA, ana.contact.id);
  inB = await createConversation(channelB, bruno.contact.id);
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 30, 9, minute));
  customerInA = await createMessage(inA, { text: "¿Cuánto cuesta un corte?", createdAt: at(0) });
  aiInA = await createMessage(inA, { direction: "outbound", senderType: "ai", agentName: "Nuria", status: "sent", text: "Un corte cuesta 18 €.", createdAt: at(1) });
  humanInA = await createMessage(inA, { direction: "outbound", senderType: "human", status: "sent", text: "Y con lavado, 22 €.", createdAt: at(2) });
  aiInB = await createMessage(inB, { direction: "outbound", senderType: "ai", agentName: "Nuria", status: "sent", text: "Sí.", createdAt: at(1) });
  await db.insert(messageRetrievals).values([
    { messageId: aiInA.id, kbId, rank: 2, score: 0.016, title: "Preguntas frecuentes", section: null, page: null },
    { messageId: aiInA.id, kbId, rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3 },
    // The base was deleted afterwards: the copy stays, without its link.
    { messageId: aiInA.id, kbId: null, rank: 3, score: 0.012, title: "Horario antiguo", section: "Verano", page: 1 },
    { messageId: aiInB.id, kbId, rank: 1, score: 0.5, title: "Otra conversación", section: null, page: null },
  ]);
  await db.insert(aiRuns).values([
    {
      kind: "chat",
      conversationId: inA.id,
      messageId: aiInA.id,
      toolsUsed: [
        { name: "buscar_conocimiento", ok: true },
        { name: "consultar_web", ok: false },
      ],
      createdAt: at(1),
    },
    // A transcription or an embedding linked to the message is not a tool the AI called.
    { kind: "embedding", conversationId: inA.id, messageId: aiInA.id, toolsUsed: [{ name: "no_es_una_herramienta", ok: true }], createdAt: at(1) },
    { kind: "chat", conversationId: inB.id, messageId: aiInB.id, toolsUsed: [{ name: "transferir_a_humano", ok: true }], createdAt: at(1) },
  ]);
});

const ref = (conversation: { id: string }, message: { id: string }) => ({ conversationId: conversation.id, messageId: message.id });

describe("«¿Por qué respondió esto?» of one AI answer [BAN-07] [CON-20]", () => {
  it("returns the fragments used, numbered by rank, with score, title, section, page and base", async () => {
    const reason = await getMessageReason(users.owner.actor, ref(inA, aiInA));
    expect(reason.messageId).toBe(aiInA.id);
    expect(reason.fragments).toEqual([
      { rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3, kbId, kbName: "Peluquería", documentId: null },
      { rank: 2, score: 0.016, title: "Preguntas frecuentes", section: null, page: null, kbId, kbName: "Peluquería", documentId: null },
      { rank: 3, score: 0.012, title: "Horario antiguo", section: "Verano", page: 1, kbId: null, kbName: null, documentId: null },
    ]);
  });

  it("returns the tools the AI called in that turn, in order, and nothing that is not a tool call", async () => {
    const reason = await getMessageReason(users.owner.actor, ref(inA, aiInA));
    expect(reason.tools).toEqual([
      { name: "buscar_conocimiento", ok: true },
      { name: "consultar_web", ok: false },
    ]);
  });

  it("never mixes in what belongs to an answer of another conversation", async () => {
    const reason = await getMessageReason(users.owner.actor, ref(inA, aiInA));
    expect(reason.fragments.map((fragment) => fragment.title)).not.toContain("Otra conversación");
    expect(reason.tools.map((tool) => tool.name)).not.toContain("transferir_a_humano");
    // An answer of conversation B asked through conversation A is not found.
    expect(await errorOf(getMessageReason(users.owner.actor, { conversationId: inA.id, messageId: aiInB.id }))).toBeInstanceOf(NotFoundError);
  });

  it("only an answer of the AI has a reason: a person's reply or a customer's message is not found", async () => {
    expect(await errorOf(getMessageReason(users.owner.actor, ref(inA, humanInA)))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(getMessageReason(users.owner.actor, ref(inA, customerInA)))).toBeInstanceOf(NotFoundError);
  });

  it("an AI answer without fragments nor tools comes back empty", async () => {
    const plain = await createMessage(inA, { direction: "outbound", senderType: "ai", status: "sent", text: "¡Hola!" });
    expect(await getMessageReason(users.owner.actor, ref(inA, plain))).toEqual({ messageId: plain.id, fragments: [], tools: [] });
  });

  it("what the browser sends is validated [SEG-05]", async () => {
    expect(await errorOf(getMessageReason(users.owner.actor, { conversationId: inA.id, messageId: "../../etc" }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(getMessageReason(users.owner.actor, { ...ref(inA, aiInA), extra: true }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(getMessageReason(users.owner.actor, "hola"))).toBeInstanceOf(ValidationError);
  });
});

describe("«¿Por qué respondió esto?»: who can see it [PER-01] [PER-02] [PER-03]", () => {
  it("owner, supervisor and Solo lectura can look; an agent in their channels", async () => {
    for (const user of [users.owner, users.supervisor, users.viewer, users.agentA]) {
      expect((await getMessageReason(user.actor, ref(inA, aiInA))).fragments).toHaveLength(3);
    }
  });

  it("an agent never sees an answer of a channel that is not theirs", async () => {
    expect(await errorOf(getMessageReason(users.agentA.actor, ref(inB, aiInB)))).toBeInstanceOf(AuthError);
  });

  it("a conversation that does not exist is «no permission», not «not found»", async () => {
    expect(await errorOf(getMessageReason(users.owner.actor, { conversationId: crypto.randomUUID(), messageId: aiInA.id }))).toBeInstanceOf(AuthError);
  });
});
