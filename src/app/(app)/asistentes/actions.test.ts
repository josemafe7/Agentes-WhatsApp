// The Server Actions of «Asistentes» ([INT-06], [INT-07], [INT-09]–[INT-12]) and the ones of the editor that only an
// internal agent has ([INT-01], [INT-04], [INT-05], [INT-13]): what the screens call, with the session of each role.
// OpenRouter is the fake of src/test (docs/testing.md); the rules themselves are tested in src/data.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDatabase } from "../../../../scripts/lib/testing";
import { db } from "@/db";
import { agentContextFiles, agentKnowledgeBases, agentMembers, agents, aiRuns, assistantChats, assistantMessages, kbDocuments, knowledgeBases, rateLimits } from "@/db/schema";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { chatCompletion, FAKE_BASE_URL, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeHandler } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createUser, type TestUser } from "@/test/factories";

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
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { createAgentAction } from "../agentes/actions";
import { saveAgentAccessAction, saveAgentAction } from "../agentes/[id]/actions";
import { createContextFileAction, moveContextFileToBaseAction } from "../agentes/[id]/conocimiento/actions";
import { sendTestMessageAction } from "../agentes/[id]/probar/actions";
import { askAssistantAction, deleteAssistantChatAction, loadEarlierAssistantMessagesAction, loadMoreAssistantChatsAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const users = {} as Record<Role, TestUser>;
const as = (role: Role | null) => (state.actor = role ? users[role].actor : null);

function useOpenRouter(chat: FakeHandler = () => jsonResponse(chatCompletion({ content: "Se piden con 30 días de antelación." }))) {
  const fake = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": chat }));
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

const internalAgent = (overrides: Partial<typeof agents.$inferInsert> = {}) => createAgentRow({ name: "Asistente del equipo", audience: "team", teamAccess: "everyone", systemTools: [], ...overrides });

beforeEach(async () => {
  await emptyDatabase();
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid" });
  for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) users[role] = await createUser(role);
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
  as("owner");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("asking from «Asistentes» [INT-06] [INT-07] [INT-11]", () => {
  it("who has access gets the answer and the conversation is theirs", async () => {
    const internal = await internalAgent();
    const fake = useOpenRouter();
    as("agent");
    const result = await askAssistantAction({ agentId: internal.id, text: "¿Con cuánta antelación pido las vacaciones?" });
    expect(result).toMatchObject({ ok: true, data: { question: { role: "user" }, answer: { role: "assistant", content: "Se piden con 30 días de antelación." } } });
    expect(fake.calls.filter((call) => call.path === "/chat/completions")).toHaveLength(1);
    const [chat] = await db.select().from(assistantChats);
    expect(chat.userId).toBe(users.agent.userId);
  });

  it("the viewer and someone without a session cannot ask; without access the assistant is «not found»", async () => {
    const internal = await internalAgent({ teamAccess: "selected" });
    const fake = useOpenRouter();
    as("viewer");
    expect(await askAssistantAction({ agentId: internal.id, text: "Hola" })).toEqual(FORBIDDEN);
    as(null);
    expect(await askAssistantAction({ agentId: internal.id, text: "Hola" })).toMatchObject({ ok: false });
    as("supervisor");
    expect(await askAssistantAction({ agentId: internal.id, text: "Hola" })).toMatchObject({ ok: false, error: "No se ha encontrado el asistente." });
    expect(fake.calls).toHaveLength(0);
    expect(await db.select().from(assistantChats)).toHaveLength(0);
  });

  it("without an OpenRouter key it says so and nothing is sent [INT-11] [ARR-14]", async () => {
    vi.unstubAllEnvs();
    const internal = await internalAgent();
    const fake = useOpenRouter();
    as("agent");
    const result = await askAssistantAction({ agentId: internal.id, text: "Hola" });
    expect(result).toMatchObject({ ok: false, reason: "ai_not_configured" });
    expect(fake.calls).toHaveLength(0);
    expect(await db.select().from(assistantMessages)).toHaveLength(0);
  });

  it("when the AI fails the person reads a generic message, the question is not stored and the failure is recorded [MOT-12]", async () => {
    const internal = await internalAgent();
    useOpenRouter(() => jsonResponse({ error: { code: 402, message: "Insufficient credits for sk-or-v1-secret" } }, 402));
    as("agent");
    const result = await askAssistantAction({ agentId: internal.id, text: "Hola" });
    expect(result).toMatchObject({ ok: false, reason: "ai_failed" });
    expect(JSON.stringify(result)).not.toContain("sk-or-v1");
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    const [run] = await db.select().from(aiRuns).where(eq(aiRuns.agentId, internal.id));
    expect(run).toMatchObject({ ok: false, audience: "team" });
  });

  it("who cannot open Ajustes › IA is told to tell an administrator; who can, what is wrong; and «Reintentar» only when it can help [INT-07]", async () => {
    const internal = await internalAgent();
    // No credit: nothing the person asking can fix, and asking again changes nothing.
    useOpenRouter(() => jsonResponse({ error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }, 402));
    as("agent");
    const forAgent = await askAssistantAction({ agentId: internal.id, text: "Hola" });
    expect(forAgent).toMatchObject({ ok: false, reason: "ai_failed", error: "El asistente no puede responder ahora mismo. Avisa a un administrador para que lo revise." });
    expect(forAgent).not.toHaveProperty("retry");
    as("owner");
    const forOwner = await askAssistantAction({ agentId: internal.id, text: "Hola" });
    expect(forOwner).toMatchObject({ ok: false, error: expect.stringMatching(/saldo/) });
    expect(forOwner).not.toHaveProperty("retry");

    // The model refuses the message: writing it another way is up to the person; nobody takes the conversation.
    useOpenRouter(() => jsonResponse({ error: { code: 403, message: "Flagged", metadata: { reasons: ["violence"] } } }, 403));
    as("agent");
    const refused = await askAssistantAction({ agentId: internal.id, text: "Hola" });
    expect(refused).toMatchObject({ ok: false, reason: "ai_failed", error: expect.stringMatching(/Prueba a escribirlo de otra forma/) });
    expect(refused).not.toHaveProperty("retry");
    expect(JSON.stringify(refused)).not.toMatch(/persona/);

    // A failure that passes on its own: «Reintentar» makes sense.
    useOpenRouter(() => jsonResponse({ error: { code: 503, message: "No providers" } }, 503));
    expect(await askAssistantAction({ agentId: internal.id, text: "Hola" })).toMatchObject({ ok: false, reason: "ai_failed", retry: true, error: expect.stringMatching(/Reintentar/) });
  });

  it("too many questions in a minute can be retried in a while; the limit of the day cannot [INT-12]", async () => {
    const internal = await internalAgent();
    useOpenRouter();
    as("agent");
    const now = new Date();
    // The minute is used up.
    await db.insert(rateLimits).values({ key: `ai:assistant:${users.agent.userId}`, count: 20, windowStart: now });
    expect(await askAssistantAction({ agentId: internal.id, text: "Hola" })).toMatchObject({ ok: false, retry: true, error: expect.stringMatching(/Espera un minuto/) });
    // And now the day.
    await db.delete(rateLimits);
    await db.insert(rateLimits).values({ key: `ai:assistant_day:${users.agent.userId}`, count: 200, windowStart: now });
    const overTheDay = await askAssistantAction({ agentId: internal.id, text: "Hola" });
    expect(overTheDay).toMatchObject({ ok: false, error: expect.stringMatching(/máximo de preguntas de hoy/) });
    expect(overTheDay).not.toHaveProperty("retry");
    expect(await db.select().from(assistantChats)).toHaveLength(0);
  });

  it("an empty question is explained next to its field", async () => {
    const internal = await internalAgent();
    useOpenRouter();
    expect(await askAssistantAction({ agentId: internal.id, text: " " })).toMatchObject({ ok: false, fieldErrors: { text: ["Escribe tu pregunta."] } });
  });
});

describe("deleting a conversation [INT-09] [INT-10]", () => {
  it("only who wrote it deletes it: for anybody else it is «not found» and stays", async () => {
    const internal = await internalAgent();
    useOpenRouter();
    as("agent");
    const asked = await askAssistantAction({ agentId: internal.id, text: "Hola" });
    if (!asked.ok) throw new Error("La pregunta de preparación ha fallado.");
    const chatId = asked.data.chat.id;

    for (const role of ["owner", "admin", "supervisor"] as const) {
      as(role);
      expect(await deleteAssistantChatAction({ chatId })).toMatchObject({ ok: false, error: "No se ha encontrado la conversación." });
    }
    as("viewer");
    expect(await deleteAssistantChatAction({ chatId })).toEqual(FORBIDDEN);
    expect(await db.select().from(assistantChats)).toHaveLength(1);

    as("agent");
    expect(await deleteAssistantChatAction({ chatId })).toMatchObject({ ok: true });
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    expect(await db.select().from(assistantMessages)).toHaveLength(0);
  });
});

describe("«Cargar más» and «Cargar mensajes anteriores» [INT-09] [INT-10]", () => {
  it("bring more of what the person wrote, and nothing of anybody else's", async () => {
    const internal = await internalAgent();
    const start = Date.parse("2026-10-01T09:00:00Z");
    const chats = await db
      .insert(assistantChats)
      .values(Array.from({ length: 52 }, (_, index) => ({ agentId: internal.id, userId: users.agent.userId, title: `Pregunta ${index + 1}`, createdAt: new Date(start + index * 1000), updatedAt: new Date(start + index * 1000) })))
      .returning();
    const newestFirst = [...chats].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const long = newestFirst[0];
    const messages = await db
      .insert(assistantMessages)
      .values(Array.from({ length: 202 }, (_, index) => ({ chatId: long.id, role: index % 2 === 0 ? ("user" as const) : ("assistant" as const), content: `Mensaje ${index + 1}`, sources: [], createdAt: new Date(start + index), updatedAt: new Date(start + index) })))
      .returning();
    const lastListed = newestFirst[49].id;
    const firstShown = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[2].id;

    as("agent");
    const more = await loadMoreAssistantChatsAction({ agentId: internal.id, before: lastListed });
    expect(more).toMatchObject({ ok: true, data: { hasMore: false } });
    expect(more.ok && more.data?.chats.map((chat) => chat.title)).toEqual(["Pregunta 2", "Pregunta 1"]);
    // Without a place to continue from (every listed one was deleted), the first ones again.
    const again = await loadMoreAssistantChatsAction({ agentId: internal.id });
    expect(again).toMatchObject({ ok: true, data: { hasMore: true } });
    expect(again.ok && again.data?.chats.slice(0, 2).map((chat) => chat.title)).toEqual(["Pregunta 52", "Pregunta 51"]);
    const earlier = await loadEarlierAssistantMessagesAction({ chatId: long.id, before: firstShown });
    expect(earlier).toMatchObject({ ok: true, data: { hasEarlier: false } });
    expect(earlier.ok && earlier.data?.messages.map((message) => message.content)).toEqual(["Mensaje 1", "Mensaje 2"]);

    // Owner, admin and a colleague get «not found»; the viewer, «no permission».
    for (const role of ["owner", "admin", "supervisor"] as const) {
      as(role);
      expect(await loadMoreAssistantChatsAction({ agentId: internal.id, before: lastListed })).toMatchObject({ ok: false, error: "No se ha encontrado la conversación." });
      expect(await loadEarlierAssistantMessagesAction({ chatId: long.id, before: firstShown })).toMatchObject({ ok: false, error: "No se ha encontrado la conversación." });
    }
    as("viewer");
    expect(await loadMoreAssistantChatsAction({ agentId: internal.id, before: lastListed })).toEqual(FORBIDDEN);
    expect(await loadEarlierAssistantMessagesAction({ chatId: long.id, before: firstShown })).toEqual(FORBIDDEN);
    // What is not an id is refused without looking anything up.
    as("agent");
    expect(await loadMoreAssistantChatsAction({ agentId: internal.id, before: "x" })).toMatchObject({ ok: false });
    expect(await loadEarlierAssistantMessagesAction({ chatId: long.id })).toMatchObject({ ok: false });
  });
});

describe("the editor of an internal agent [INT-01] [INT-05] [INT-13]", () => {
  it("«Nuevo agente» › «Interno» creates a blank internal agent; only owner and admin can", async () => {
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      as(role);
      expect(await createAgentAction({ source: "internal", name: "Interno" })).toEqual(FORBIDDEN);
    }
    expect(await db.select().from(agents)).toHaveLength(0);
    as("admin");
    const created = await createAgentAction({ source: "internal", name: "Asistente del equipo" });
    expect(created).toMatchObject({ ok: true });
    const [agent] = await db.select().from(agents);
    expect(agent).toMatchObject({ name: "Asistente del equipo", audience: "team", teamAccess: "selected", systemTools: [], instructions: {}, templateSector: null });
  });

  it("saving a tab never changes who the agent is for", async () => {
    const internal = await internalAgent();
    expect(await saveAgentAction(internal.id, { audience: "customers" })).toMatchObject({ ok: false });
    expect(await saveAgentAction(internal.id, { name: "Asistente de almacén" })).toMatchObject({ ok: true });
    const [agent] = await db.select().from(agents).where(eq(agents.id, internal.id));
    expect(agent).toMatchObject({ audience: "team", name: "Asistente de almacén" });
  });

  it("«Acceso»: owner and admin choose the people; nobody else can", async () => {
    const internal = await internalAgent({ teamAccess: "selected" });
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      as(role);
      expect(await saveAgentAccessAction(internal.id, { teamAccess: "everyone", userIds: [] })).toEqual(FORBIDDEN);
    }
    as("admin");
    expect(await saveAgentAccessAction(internal.id, { teamAccess: "selected", userIds: [users.agent.userId] })).toMatchObject({ ok: true, message: "Acceso guardado." });
    expect((await db.select().from(agentMembers)).map((member) => member.userId)).toEqual([users.agent.userId]);
    // Someone who cannot use internal agents is refused next to the list.
    expect(await saveAgentAccessAction(internal.id, { teamAccess: "selected", userIds: [users.viewer.userId] })).toMatchObject({ ok: false, fieldErrors: { userIds: expect.any(Array) } });
    expect(await saveAgentAccessAction(internal.id, { teamAccess: "todos", userIds: [] })).toMatchObject({ ok: false });
  });

  it("«Probar» answers under the rules of an internal agent and stores no conversation [INT-13]", async () => {
    const internal = await internalAgent();
    const fake = useOpenRouter();
    as("admin");
    const result = await sendTestMessageAction({ agentId: internal.id, channel: "whatsapp", messages: [{ role: "contact", text: "¿Cómo se abre la caja?" }] });
    expect(result).toMatchObject({ ok: true });
    const [request] = fake.calls.filter((call) => call.path === "/chat/completions").map((call) => call.body as { messages: { content: unknown }[]; tools?: { function: { name: string } }[] });
    expect(String(request.messages[0].content)).toContain("asistente interno de Peluquería Lola");
    expect(String(request.messages[0].content)).toContain("Prueba desde el editor del agente interno.");
    expect((request.tools ?? []).map((tool) => tool.function.name)).toEqual(["buscar_conocimiento"]);
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    // The supervisor tests agents for customers, never an internal one ([INT-15]).
    as("supervisor");
    expect(await sendTestMessageAction({ agentId: internal.id, channel: "whatsapp", messages: [{ role: "contact", text: "Hola" }] })).toMatchObject({ ok: false, error: "No se ha encontrado el agente." });
  });
});

describe("«Pasar a una base» keeps what an internal agent knows in internal bases [INT-04]", () => {
  async function contextFileOf(agentId: string) {
    const created = await createContextFileAction(agentId, { title: "Turnos", contentMd: "El turno de tarde empieza a las 15:00." });
    if (!created.ok || !created.data) throw new Error("No se ha podido crear el archivo de contexto.");
    return created.data.id;
  }

  it("a new base made from the file of an internal agent is internal, and the agent starts using it", async () => {
    const internal = await internalAgent();
    const fileId = await contextFileOf(internal.id);
    const moved = await moveContextFileToBaseAction({ agentId: internal.id, fileId, newBaseName: "Turnos del equipo" });
    expect(moved).toMatchObject({ ok: true });
    const [base] = await db.select().from(knowledgeBases);
    expect(base).toMatchObject({ name: "Turnos del equipo", audience: "team" });
    expect(await db.select().from(kbDocuments).where(eq(kbDocuments.kbId, base.id))).toHaveLength(1);
    expect((await db.select().from(agentKnowledgeBases)).map((link) => [link.agentId, link.knowledgeBaseId])).toEqual([[internal.id, base.id]]);
    expect(await db.select().from(agentContextFiles)).toHaveLength(0);
  });

  it("it cannot go to a base for customers: refused, and the file stays where it was", async () => {
    const internal = await internalAgent();
    const fileId = await contextFileOf(internal.id);
    const [publicBase] = await db.insert(knowledgeBases).values({ name: "Servicios y precios" }).returning();
    expect(await moveContextFileToBaseAction({ agentId: internal.id, fileId, kbId: publicBase.id })).toMatchObject({ ok: false });
    expect(await db.select().from(kbDocuments)).toHaveLength(0);
    expect(await db.select().from(agentContextFiles)).toHaveLength(1);
  });

  it("the file of an agent for customers makes a base for customers, as before", async () => {
    const forCustomers = await createAgentRow({ name: "Recepción" });
    const fileId = await contextFileOf(forCustomers.id);
    expect(await moveContextFileToBaseAction({ agentId: forCustomers.id, fileId, newBaseName: "Normas" })).toMatchObject({ ok: true });
    const [base] = await db.select().from(knowledgeBases);
    expect(base.audience).toBe("customers");
  });
});
