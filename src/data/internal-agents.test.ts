// Internal agents (docs/spec.md «Agentes internos», [INT-01]–[INT-07], [INT-09]–[INT-12], [INT-15]) at the data
// layer, for the five roles: who creates and sees them, that they never answer customers, that an internal base never
// reaches an agent for customers, who may use each one, and that a conversation belongs to who wrote it.
// The expectations come from the specification, not from the code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDatabase } from "../../scripts/lib/testing";
import { db } from "@/db";
import {
  agentKnowledgeBases,
  agentMembers,
  agents,
  aiRuns,
  assistantChats,
  assistantMessages,
  channels,
  conversations,
  kbDocuments,
  knowledgeBases,
  rateLimits,
  userRoles,
} from "@/db/schema";
import type { Role } from "@/lib/enums";
import { DiskStorage } from "@/server/adapters/file-storage";
import type { RateLimiter } from "@/server/adapters/rate-limiter";
import { AiNotConfiguredError } from "@/server/ai/errors";
import { AuthError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import { agentKnowledgeBaseIds, searchForAgent } from "@/server/knowledge/agent-knowledge";
import { processDocument } from "@/server/knowledge/ingest";
import { budget, knowledgeOpenRouter, makeTextPdf } from "@/server/knowledge/test-helpers";
import { chatCompletion, FAKE_OPENROUTER_KEY, jsonResponse, sequence } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { assertAnswersCustomers } from "./agent-audience";
import { setAgentChannelActive } from "./agent-channels";
import {
  canUseInternalAgent,
  createAgent,
  deleteAgent,
  duplicateAgent,
  getAgent,
  getAgentAccess,
  getAgentForTesting,
  listAgents,
  listAgentVersions,
  loadAgentForRun,
  setAgentAccess,
  updateAgent,
} from "./agents";
import {
  askAssistant,
  ASSISTANT_LIMITS,
  CHATS_PAGE_SIZE,
  deleteMyAssistantChat,
  getMyAssistant,
  getMyAssistantChat,
  listEarlierAssistantMessages,
  listMyAssistantChats,
  listMyAssistants,
  MESSAGES_PAGE_SIZE,
} from "./assistants";
import { createWebchatChannel, setActiveAgent } from "./channels";
import { setConversationAgent } from "./conversation-actions";
import { setAgentCustomTool } from "./custom-tools";
import { createKnowledgeBase, getKnowledgeBase, listAgentKnowledgeBases, listKnowledgeBases, setAgentKnowledgeBases, updateKnowledgeBase } from "./knowledge";
import { listAgentContextFiles } from "./knowledge-context-files";
import { addKnowledgeFaq, addKnowledgeFile, addKnowledgeText, canViewKnowledgeFile, getKnowledgeDocument, listKnowledgeDocuments } from "./knowledge-documents";
import { testKnowledgeSearch } from "./knowledge-search";
import { removeUser } from "./users";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-internal-agents-"));
const storage = new DiskStorage(dir);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ROLES_LIST = ["owner", "admin", "supervisor", "agent", "viewer"] as const;
const users = {} as Record<Role, TestUser>;
const actor = (role: Role) => users[role].actor;

beforeEach(async () => {
  await emptyDatabase();
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid" });
  for (const role of ROLES_LIST) users[role] = await createUser(role);
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

const internalAgent = (overrides: Partial<typeof agents.$inferInsert> = {}) => createAgentRow({ name: "Asistente del equipo", audience: "team", teamAccess: "selected", systemTools: [], ...overrides });
const customersAgent = (overrides: Partial<typeof agents.$inferInsert> = {}) => createAgentRow({ name: "Recepción", ...overrides });
const internalBase = async (name = "Manual interno") => (await createKnowledgeBase(actor("owner"), { name, audience: "team" })).id;
const customersBase = async (name = "Servicios y precios") => (await createKnowledgeBase(actor("owner"), { name })).id;

/** A text document already processed, with the embeddings of the fake OpenRouter: searchable by words and by meaning. */
async function addProcessedText(kbId: string, title: string, text: string): Promise<string> {
  const { id } = await addKnowledgeText(actor("owner"), kbId, { title, text });
  expect(await processDocument(id, budget(), { storage, fetchImpl: knowledgeOpenRouter().fetch })).toBe("done");
  return id;
}

const MANUAL = "## Vacaciones\n\nCada persona tiene 23 días laborables de vacaciones al año. Se piden con 30 días de antelación.";
const QUESTION = "¿Cuántos días de vacaciones tengo?";
const ANSWER = "Tienes 23 días laborables de vacaciones al año (Manual del equipo).";

/** OpenRouter that searches the knowledge once and then answers. */
function assistantAi(answer = ANSWER) {
  return knowledgeOpenRouter({
    "POST /chat/completions": sequence(
      () => jsonResponse(chatCompletion({ toolCalls: [{ name: "buscar_conocimiento", arguments: { consulta: "días de vacaciones" } }] })),
      () => jsonResponse(chatCompletion({ content: answer, usage: { cost: 0.0005 } })),
    ),
  });
}

const chatRequests = (fake: ReturnType<typeof knowledgeOpenRouter>) => fake.calls.filter((call) => call.path === "/chat/completions").map((call) => call.body as Record<string, unknown>);
const systemPromptOf = (request: Record<string, unknown>) => String((request.messages as { role: string; content: unknown }[])[0].content);
const toolNamesOf = (request: Record<string, unknown>) => ((request.tools ?? []) as { function: { name: string } }[]).map((tool) => tool.function.name);

describe("[INT-01] who an agent is for is chosen when it is created and never changes", () => {
  it("owner and admin create an internal agent: blank, without tools or hand-off, and used by nobody else until its access is chosen", async () => {
    for (const role of ["owner", "admin"] as const) {
      const agent = await createAgent(actor(role), { name: `Interno ${role}`, audience: "team" });
      expect(agent).toMatchObject({ audience: "team", teamAccess: "selected", systemTools: [], handoff: {}, instructions: {}, templateSector: null, currentVersion: 1 });
      expect(await listAgentVersions(actor(role), agent.id)).toHaveLength(1);
    }
  });

  it("supervisor, agent and viewer cannot create one, and nothing is created", async () => {
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      expect(await errorOf(createAgent(actor(role), { name: "Interno", audience: "team" }))).toBeInstanceOf(AuthError);
    }
    expect(await db.select().from(agents)).toHaveLength(0);
  });

  it("without saying who it is for, an agent is for customers, as before", async () => {
    expect(await createAgent(actor("owner"), { name: "Recepción" })).toMatchObject({ audience: "customers", systemTools: ["transferir_a_humano"] });
  });

  it("an internal agent is never made from a sector template", async () => {
    expect(await errorOf(createAgent(actor("owner"), { name: "Interno", audience: "team" }, { templateSector: "peluqueria" }))).toBeInstanceOf(ValidationError);
    expect(await db.select().from(agents)).toHaveLength(0);
  });

  it("the kind cannot be changed afterwards: saving it with another one is refused and nothing changes", async () => {
    const internal = await createAgent(actor("owner"), { name: "Interno", audience: "team" });
    const forCustomers = await createAgent(actor("owner"), { name: "Recepción" });
    expect(await errorOf(updateAgent(actor("owner"), internal.id, { audience: "customers" }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(updateAgent(actor("owner"), forCustomers.id, { audience: "team" }))).toBeInstanceOf(ValidationError);
    expect((await getAgent(actor("owner"), internal.id)).audience).toBe("team");
    expect((await getAgent(actor("owner"), forCustomers.id)).audience).toBe("customers");
  });

  it("its copy is internal too, with the same access [AGE-16]", async () => {
    const internal = await internalAgent();
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [users.agent.userId] });
    const copy = await duplicateAgent(actor("owner"), internal.id, storage);
    expect(copy).toMatchObject({ audience: "team", teamAccess: "selected" });
    expect((await getAgentAccess(actor("owner"), copy.id)).people.filter((person) => person.member).map((person) => person.id)).toEqual([users.agent.userId]);
  });
});

describe("[INT-15] internal agents and internal bases only exist for owner and admin", () => {
  it("Agentes lists the internal ones only for owner and admin; every agent picker gets only those for customers", async () => {
    const internal = await internalAgent();
    const forCustomers = await customersAgent();
    for (const role of ["owner", "admin"] as const) {
      expect((await listAgents(actor(role), { audience: "all" })).map((agent) => agent.id).sort()).toEqual([internal.id, forCustomers.id].sort());
    }
    for (const role of ["supervisor", "viewer"] as const) {
      expect((await listAgents(actor(role), { audience: "all" })).map((agent) => agent.id)).toEqual([forCustomers.id]);
    }
    // The default list is what a channel or a conversation offers: never an internal agent ([INT-03]).
    for (const role of ["owner", "admin", "supervisor", "viewer"] as const) {
      expect((await listAgents(actor(role))).map((agent) => agent.id)).toEqual([forCustomers.id]);
    }
    expect(await errorOf(listAgents(actor("agent"), { audience: "all" }))).toBeInstanceOf(AuthError);
  });

  it("for supervisor and viewer an internal agent is «not found»: its configuration, versions, context files and test", async () => {
    const internal = await internalAgent();
    for (const role of ["supervisor", "viewer"] as const) {
      expect(await errorOf(getAgent(actor(role), internal.id))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(listAgentVersions(actor(role), internal.id))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(listAgentContextFiles(actor(role), internal.id))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(listAgentKnowledgeBases(actor(role), internal.id))).toBeInstanceOf(NotFoundError);
    }
    // The supervisor may test agents for customers ([PER-01]), never an internal one.
    expect(await errorOf(getAgentForTesting(actor("supervisor"), internal.id))).toBeInstanceOf(NotFoundError);
    expect(await getAgentForTesting(actor("admin"), internal.id)).toMatchObject({ id: internal.id, audience: "team" });
    // The agent role has no access to Agentes at all.
    expect(await errorOf(getAgent(actor("agent"), internal.id))).toBeInstanceOf(AuthError);
  });

  it("only owner and admin create an internal base; who the base is for never changes", async () => {
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      expect(await errorOf(createKnowledgeBase(actor(role), { name: "Interna", audience: "team" }))).toBeInstanceOf(AuthError);
    }
    expect(await db.select().from(knowledgeBases)).toHaveLength(0);
    const kbId = (await createKnowledgeBase(actor("admin"), { name: "Manual interno", audience: "team" })).id;
    expect(await getKnowledgeBase(actor("admin"), kbId)).toMatchObject({ audience: "team" });
    expect(await errorOf(updateKnowledgeBase(actor("owner"), kbId, { audience: "customers" }))).toBeInstanceOf(ValidationError);
    expect((await getKnowledgeBase(actor("owner"), kbId)).audience).toBe("team");
    // A supervisor still creates bases for customers ([PER-01]).
    const supervisorBase = await createKnowledgeBase(actor("supervisor"), { name: "Preguntas frecuentes" });
    expect(await getKnowledgeBase(actor("supervisor"), supervisorBase.id)).toMatchObject({ audience: "customers" });
  });

  it("supervisor and viewer neither see an internal base nor its documents, and the supervisor cannot add, search or open its files", async () => {
    const kbId = await internalBase();
    const publicId = await customersBase();
    const docId = await addProcessedText(kbId, "Manual del equipo", MANUAL);
    const { id: fileDocId } = await addKnowledgeFile(actor("owner"), kbId, { fileName: "nominas.md", bytes: new TextEncoder().encode("# Nóminas\n\nSe pagan el día 28.") }, { storage });
    const [fileDoc] = await db.select({ fileKey: kbDocuments.fileKey }).from(kbDocuments).where(eq(kbDocuments.id, fileDocId));

    for (const role of ["supervisor", "viewer"] as const) {
      expect((await listKnowledgeBases(actor(role))).map((base) => base.id)).toEqual([publicId]);
      expect(await errorOf(getKnowledgeBase(actor(role), kbId))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(listKnowledgeDocuments(actor(role), kbId))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(getKnowledgeDocument(actor(role), docId))).toBeInstanceOf(NotFoundError);
      expect(await canViewKnowledgeFile(actor(role), fileDoc.fileKey ?? "")).toBe(false);
    }
    expect(await errorOf(addKnowledgeText(actor("supervisor"), kbId, { title: "Otro", text: "Texto" }))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(addKnowledgeFaq(actor("supervisor"), kbId, { question: "¿Cuándo se cobra?", answer: "El día 28." }))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(testKnowledgeSearch(actor("supervisor"), { kbIds: [kbId], query: "vacaciones" }))).toBeInstanceOf(NotFoundError);
    expect(await db.select().from(kbDocuments).where(eq(kbDocuments.kbId, kbId))).toHaveLength(2);

    for (const role of ["owner", "admin"] as const) {
      expect((await listKnowledgeBases(actor(role))).map((base) => base.id).sort()).toEqual([kbId, publicId].sort());
      expect(await canViewKnowledgeFile(actor(role), fileDoc.fileKey ?? "")).toBe(true);
      expect((await testKnowledgeSearch(actor(role), { kbIds: [kbId], query: "vacaciones" })).status).toBe("ok");
    }
  });

  it("a base for customers does not name the internal agents that use it to who cannot see them", async () => {
    const publicId = await customersBase();
    const internal = await internalAgent();
    const forCustomers = await customersAgent();
    await setAgentKnowledgeBases(actor("owner"), internal.id, { kbIds: [publicId] });
    await setAgentKnowledgeBases(actor("owner"), forCustomers.id, { kbIds: [publicId] });
    expect((await getKnowledgeBase(actor("supervisor"), publicId)).agents.map((agent) => agent.id)).toEqual([forCustomers.id]);
    expect((await getKnowledgeBase(actor("owner"), publicId)).agents.map((agent) => agent.id).sort()).toEqual([internal.id, forCustomers.id].sort());
  });
});

describe("[INT-03] an internal agent never answers customers", () => {
  it("it cannot be made the active agent of a channel, from the agent or from the channel, and the channel stays as it was", async () => {
    const internal = await internalAgent();
    const forCustomers = await customersAgent();
    const channel = await createChannel({ activeAgentId: forCustomers.id });

    expect(await errorOf(setAgentChannelActive(actor("owner"), { agentId: internal.id, channelId: channel.id, active: true, confirmReplace: true }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(setActiveAgent(actor("owner"), { channelId: channel.id, agentId: internal.id, confirmReplace: true }))).toBeInstanceOf(ValidationError);
    const [after] = await db.select({ activeAgentId: channels.activeAgentId }).from(channels).where(eq(channels.id, channel.id));
    expect(after.activeAgentId).toBe(forCustomers.id);
  });

  it("a new channel cannot start with it", async () => {
    const internal = await internalAgent();
    expect(await errorOf(createWebchatChannel(actor("owner"), { name: "Chat de la web", activeAgentId: internal.id }))).toBeInstanceOf(ValidationError);
    expect(await db.select().from(channels)).toHaveLength(0);
    // Every wizard that connects a channel (Telegram, YCloud, QR) checks the agent with this same function.
    expect(await errorOf(assertAnswersCustomers(db, internal.id))).toBeInstanceOf(ValidationError);
    await expect(assertAnswersCustomers(db, (await customersAgent()).id)).resolves.toBeUndefined();
  });

  it("it cannot be chosen for a conversation [AGE-14]", async () => {
    const internal = await internalAgent();
    const channel = await createChannel();
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(channel.id, contact.id);
    expect(await errorOf(setConversationAgent(actor("owner"), { conversationId: conversation.id, agentId: internal.id }))).toBeInstanceOf(ValidationError);
    const [after] = await db.select({ agentOverrideId: conversations.agentOverrideId }).from(conversations).where(eq(conversations.id, conversation.id));
    expect(after.agentOverrideId).toBeNull();
  });

  it("who cannot see internal agents is told the same as for an agent that does not exist [INT-15]", async () => {
    const internal = await internalAgent();
    const channel = await createChannel();
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(channel.id, contact.id);
    const refusal = async (agentId: string) => {
      const error = await errorOf(setConversationAgent(actor("supervisor"), { conversationId: conversation.id, agentId }));
      return [error instanceof NotFoundError, (error as NotFoundError).userMessage];
    };
    expect(await refusal(internal.id)).toEqual([true, "No se ha encontrado el agente."]);
    expect(await refusal(internal.id)).toEqual(await refusal(crypto.randomUUID()));
    const [after] = await db.select({ agentOverrideId: conversations.agentOverrideId }).from(conversations).where(eq(conversations.id, conversation.id));
    expect(after.agentOverrideId).toBeNull();
  });

  it("the reply engine never loads it, whatever a channel points to", async () => {
    const internal = await internalAgent();
    const forCustomers = await customersAgent();
    expect(await loadAgentForRun(internal.id)).toBeNull();
    expect(await loadAgentForRun(forCustomers.id)).toMatchObject({ id: forCustomers.id });
  });

  it("it has no HTTP tools to switch on [INT-07]", async () => {
    const internal = await internalAgent();
    expect(await errorOf(setAgentCustomTool(actor("owner"), { agentId: internal.id, toolId: crypto.randomUUID(), attached: true }))).toBeInstanceOf(NotFoundError);
  });
});

describe("[INT-04] an internal base is only for internal agents", () => {
  it("giving one to an agent for customers is refused and nothing is assigned", async () => {
    const kbId = await internalBase();
    const publicId = await customersBase();
    const forCustomers = await customersAgent();
    expect(await errorOf(setAgentKnowledgeBases(actor("owner"), forCustomers.id, { kbIds: [publicId, kbId] }))).toBeInstanceOf(ValidationError);
    expect(await db.select().from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, forCustomers.id))).toHaveLength(0);
  });

  it("an agent for customers is not even offered the internal bases; an internal agent can use both kinds", async () => {
    const kbId = await internalBase();
    const publicId = await customersBase();
    const forCustomers = await customersAgent();
    const internal = await internalAgent();
    expect((await listAgentKnowledgeBases(actor("owner"), forCustomers.id)).available.map((base) => base.id)).toEqual([publicId]);
    expect((await listAgentKnowledgeBases(actor("owner"), internal.id)).available.map((base) => base.id).sort()).toEqual([kbId, publicId].sort());
    await setAgentKnowledgeBases(actor("owner"), internal.id, { kbIds: [kbId, publicId] });
    expect((await agentKnowledgeBaseIds(internal.id)).sort()).toEqual([kbId, publicId].sort());
  });

  it("the search of an agent for customers never reads an internal base, even if a row said it uses it", async () => {
    const kbId = await internalBase();
    await addProcessedText(kbId, "Manual del equipo", MANUAL);
    const forCustomers = await customersAgent();
    // What the screens can never do: written straight into the table.
    await db.insert(agentKnowledgeBases).values({ agentId: forCustomers.id, knowledgeBaseId: kbId });

    expect(await agentKnowledgeBaseIds(forCustomers.id)).toEqual([]);
    const { search, answer } = await searchForAgent("vacaciones", { agentId: forCustomers.id, mode: "live", conversationId: null });
    expect(search.status).toBe("no_results");
    expect(answer).not.toContain("23 días");

    const internal = await internalAgent();
    await db.insert(agentKnowledgeBases).values({ agentId: internal.id, knowledgeBaseId: kbId });
    expect((await searchForAgent("vacaciones", { agentId: internal.id, mode: "live", conversationId: null })).answer).toContain("23 días");
  });
});

describe("[INT-05] [INT-06] who may use each internal agent", () => {
  it("a new one is only for owner and admin; «Todo el equipo» opens it to supervisor and agent, never to the viewer", async () => {
    const internal = await internalAgent();
    for (const role of ["owner", "admin"] as const) expect((await listMyAssistants(actor(role))).map((item) => item.id)).toEqual([internal.id]);
    for (const role of ["supervisor", "agent"] as const) {
      expect(await listMyAssistants(actor(role))).toEqual([]);
      expect(await errorOf(getMyAssistant(actor(role), internal.id))).toBeInstanceOf(NotFoundError);
    }

    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "everyone", userIds: [] });
    for (const role of ["owner", "admin", "supervisor", "agent"] as const) {
      expect((await listMyAssistants(actor(role))).map((item) => item.id)).toEqual([internal.id]);
      expect(await getMyAssistant(actor(role), internal.id)).toMatchObject({ id: internal.id, name: "Asistente del equipo" });
    }
    // «Solo lectura» never uses an internal agent, whatever its access.
    expect(await errorOf(listMyAssistants(actor("viewer")))).toBeInstanceOf(AuthError);
    expect(await errorOf(getMyAssistant(actor("viewer"), internal.id))).toBeInstanceOf(AuthError);
    expect(await canUseInternalAgent(actor("viewer"), { id: internal.id, audience: "team", teamAccess: "everyone" })).toBe(false);
  });

  it("with «Personas concretas», only the people listed (and owner and admin)", async () => {
    const internal = await internalAgent();
    await setAgentAccess(actor("admin"), internal.id, { teamAccess: "selected", userIds: [users.agent.userId] });
    expect((await listMyAssistants(actor("agent"))).map((item) => item.id)).toEqual([internal.id]);
    expect(await listMyAssistants(actor("supervisor"))).toEqual([]);
    expect(await errorOf(getMyAssistant(actor("supervisor"), internal.id))).toBeInstanceOf(NotFoundError);
    expect((await listMyAssistants(actor("owner"))).map((item) => item.id)).toEqual([internal.id]);
  });

  it("saving the access changes only the people on the screen: somebody deactivated keeps theirs for when they come back", async () => {
    const internal = await internalAgent();
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [users.supervisor.userId, users.agent.userId] });
    await db.update(userRoles).set({ disabledAt: new Date() }).where(eq(userRoles.userId, users.agent.userId));
    // The Acceso tab no longer lists them, so what it saves never names them.
    expect((await getAgentAccess(actor("owner"), internal.id)).people.map((person) => person.id)).toEqual([users.supervisor.userId]);
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [] });
    expect((await db.select().from(agentMembers).where(eq(agentMembers.agentId, internal.id))).map((member) => member.userId)).toEqual([users.agent.userId]);

    await db.update(userRoles).set({ disabledAt: null }).where(eq(userRoles.userId, users.agent.userId));
    expect(await canUseInternalAgent(actor("agent"), internal)).toBe(true);
    expect(await canUseInternalAgent(actor("supervisor"), internal)).toBe(false);
    // Once they are on the screen again, unchecking them removes them like anybody else.
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [] });
    expect(await canUseInternalAgent(actor("agent"), internal)).toBe(false);
  });

  it("Agentes says who each internal agent was given to: the whole team, or how many of the people listed can still use it", async () => {
    await internalAgent({ name: "Abierto", teamAccess: "everyone" });
    await internalAgent({ name: "Cerrado" });
    const some = await internalAgent({ name: "De algunos" });
    await customersAgent();
    await setAgentAccess(actor("owner"), some.id, { teamAccess: "selected", userIds: [users.supervisor.userId, users.agent.userId] });
    const access = async () => Object.fromEntries((await listAgents(actor("owner"), { audience: "all" })).map((agent) => [agent.name, [agent.teamAccess, agent.accessPeople]]));
    expect(await access()).toEqual({ Abierto: ["everyone", 0], Cerrado: ["selected", 0], "De algunos": ["selected", 2], Recepción: ["everyone", 0] });
    // Someone deactivated can no longer use it, so they no longer count.
    await db.update(userRoles).set({ disabledAt: new Date() }).where(eq(userRoles.userId, users.agent.userId));
    expect((await access())["De algunos"]).toEqual(["selected", 1]);
  });

  it("an agent for customers is never an assistant", async () => {
    const forCustomers = await customersAgent();
    expect(await listMyAssistants(actor("owner"))).toEqual([]);
    expect(await errorOf(getMyAssistant(actor("owner"), forCustomers.id))).toBeInstanceOf(NotFoundError);
  });

  it("only owner and admin decide the access, and only of an internal agent", async () => {
    const internal = await internalAgent();
    const forCustomers = await customersAgent();
    for (const role of ["supervisor", "agent", "viewer"] as const) {
      expect(await errorOf(setAgentAccess(actor(role), internal.id, { teamAccess: "everyone", userIds: [] }))).toBeInstanceOf(AuthError);
      expect(await errorOf(getAgentAccess(actor(role), internal.id))).toBeInstanceOf(AuthError);
    }
    expect(await errorOf(setAgentAccess(actor("owner"), forCustomers.id, { teamAccess: "everyone", userIds: [] }))).toBeInstanceOf(NotFoundError);
    const [row] = await db.select({ teamAccess: agents.teamAccess }).from(agents).where(eq(agents.id, internal.id));
    expect(row.teamAccess).toBe("selected");
  });

  it("only active supervisors and agents can be listed: a viewer, an admin, someone deactivated or unknown is refused and nothing changes", async () => {
    const internal = await internalAgent();
    const disabled = await createUser("agent", { disabled: true });
    expect((await getAgentAccess(actor("owner"), internal.id)).people.map((person) => person.id).sort()).toEqual([users.supervisor.userId, users.agent.userId].sort());
    for (const userId of [users.viewer.userId, users.admin.userId, disabled.userId, crypto.randomUUID()]) {
      expect(await errorOf(setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [users.agent.userId, userId] }))).toBeInstanceOf(ValidationError);
    }
    expect(await db.select().from(agentMembers)).toHaveLength(0);
  });
});

describe("[INT-07] a question gets one answer with its sources, and the agent only has the search of its knowledge", () => {
  async function assistantWithManual(access: "everyone" | "selected" = "everyone") {
    const kbId = await internalBase();
    await addProcessedText(kbId, "Manual del equipo", MANUAL);
    const internal = await internalAgent({ teamAccess: access });
    await setAgentKnowledgeBases(actor("owner"), internal.id, { kbIds: [kbId] });
    return { internal, kbId };
  }

  it("answers with the document it used, stores the pair for who asked and records the run as an internal one", async () => {
    const { internal } = await assistantWithManual();
    const fake = assistantAi();
    const result = await askAssistant(actor("agent"), { agentId: internal.id, text: QUESTION }, { fetchImpl: fake.fetch });

    expect(result.question).toMatchObject({ role: "user", content: QUESTION, sources: [] });
    expect(result.answer).toMatchObject({ role: "assistant", content: ANSWER });
    expect(result.answer.sources).toEqual([{ title: "Manual del equipo", section: "Vacaciones", page: null, knowledgeBase: "Manual interno" }]);
    expect(result.chat.title).toBe(QUESTION);

    const [chat] = await db.select().from(assistantChats);
    expect(chat).toMatchObject({ id: result.chat.id, agentId: internal.id, userId: users.agent.userId });
    expect((await db.select().from(assistantMessages).where(eq(assistantMessages.chatId, chat.id))).map((message) => message.role).sort()).toEqual(["assistant", "user"]);

    const runs = await db.select().from(aiRuns).where(eq(aiRuns.agentId, internal.id));
    expect(runs.filter((run) => run.kind === "chat")).toHaveLength(1);
    expect(runs.every((run) => run.audience === "team" && !run.isTest)).toBe(true);
  });

  it("from a PDF, the source says the page the fact is on", async () => {
    // Each page is a fragment of its own (about 300 tokens); only page 3 talks about holidays.
    const filler = (topic: string) => Array.from({ length: 22 }, (_, index) => `Norma ${index + 1} sobre ${topic}: el turno revisa el ${topic} con calma y lo apunta en la hoja numero ${index + 1}.`);
    const pdf = makeTextPdf(
      [
        ["Capitulo 1. Apertura", ...filler("escaparate")],
        ["Capitulo 2. Compras", ...filler("almacen")],
        ["Capitulo 3. Descansos", "Cada persona tiene 23 dias laborables de vacaciones.", ...filler("cuadrante")],
        ["Capitulo 4. Cierre", ...filler("alarma")],
      ],
      { title: "Manual del equipo" },
    );
    const kbId = await internalBase();
    const { id } = await addKnowledgeFile(actor("owner"), kbId, { fileName: "manual.pdf", bytes: pdf }, { storage });
    expect(await processDocument(id, budget(), { storage, fetchImpl: knowledgeOpenRouter().fetch })).toBe("done");
    const internal = await internalAgent({ teamAccess: "everyone" });
    await setAgentKnowledgeBases(actor("owner"), internal.id, { kbIds: [kbId] });

    const result = await askAssistant(actor("agent"), { agentId: internal.id, text: QUESTION }, { fetchImpl: assistantAi().fetch });
    expect(result.answer.sources[0]).toMatchObject({ title: "Manual del equipo", page: 3, knowledgeBase: "Manual interno" });
  });

  it("when the model refuses to answer after searching, the fixed reply carries no sources: it comes from no document", async () => {
    const { internal } = await assistantWithManual();
    const refused = chatCompletion({ content: null });
    (refused.choices[0].message as Record<string, unknown>).refusal = "No puedo ayudar con eso.";
    const fake = knowledgeOpenRouter({
      "POST /chat/completions": sequence(
        () => jsonResponse(chatCompletion({ toolCalls: [{ name: "buscar_conocimiento", arguments: { consulta: "días de vacaciones" } }] })),
        () => jsonResponse(refused),
      ),
    });
    const result = await askAssistant(actor("agent"), { agentId: internal.id, text: QUESTION }, { fetchImpl: fake.fetch });
    expect(result.answer.content).toBe("Lo siento, con eso no puedo ayudarte. Puedo responder a lo que esté en los documentos del negocio.");
    expect(result.answer.sources).toEqual([]);
  });

  it("the model is offered the knowledge search and nothing else, under the rules of an internal agent [INT-08]", async () => {
    // Whatever its row says: the tools of an agent for customers never reach an internal one.
    const { internal } = await assistantWithManual();
    await db.update(agents).set({ systemTools: ["transferir_a_humano", "crear_cita", "guardar_datos_contacto"] }).where(eq(agents.id, internal.id));
    const fake = assistantAi();
    await askAssistant(actor("owner"), { agentId: internal.id, text: QUESTION }, { fetchImpl: fake.fetch });

    const requests = chatRequests(fake);
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(toolNamesOf(request)).toEqual(["buscar_conocimiento"]);
    // The search is described for who asks here: a person of the team, with nobody to hand the conversation to.
    expect(JSON.stringify(requests[0].tools)).toContain("palabras clave de la pregunta");
    expect(JSON.stringify(requests[0].tools)).not.toMatch(/cliente|pasar con una persona/);
    const system = systemPromptOf(requests[0]);
    expect(system).toContain("asistente interno de Peluquería Lola");
    expect(system).toContain("nunca a clientes");
    expect(system).not.toContain("transferir_a_humano");
  });

  it("a second question of the same conversation carries what was said before", async () => {
    const { internal } = await assistantWithManual();
    const first = await askAssistant(actor("agent"), { agentId: internal.id, text: QUESTION }, { fetchImpl: assistantAi().fetch });
    const fake = knowledgeOpenRouter({ "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Con 30 días de antelación." })) });
    const second = await askAssistant(actor("agent"), { agentId: internal.id, chatId: first.chat.id, text: "¿Y con cuánta antelación las pido?" }, { fetchImpl: fake.fetch });

    expect(second.chat.id).toBe(first.chat.id);
    const [request] = chatRequests(fake);
    const sent = (request.messages as { role: string; content: unknown }[]).filter((message) => message.role !== "system").map((message) => [message.role, message.content]);
    expect(sent).toEqual([
      ["user", QUESTION],
      ["assistant", ANSWER],
      ["user", "¿Y con cuánta antelación las pido?"],
    ]);
    expect(await db.select().from(assistantChats)).toHaveLength(1);
    expect(await db.select().from(assistantMessages)).toHaveLength(4);
  });

  it("in a long conversation the model gets the last ten questions with their answers, never an answer without its question", async () => {
    const internal = await internalAgent({ teamAccess: "everyone" });
    const [chat] = await db.insert(assistantChats).values({ agentId: internal.id, userId: users.agent.userId, title: "Una conversación larga" }).returning();
    const start = Date.parse("2026-10-01T09:00:00Z");
    // Twelve questions already answered.
    await db.insert(assistantMessages).values(
      Array.from({ length: 24 }, (_, index) => ({
        chatId: chat.id,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `${index % 2 === 0 ? "Pregunta" : "Respuesta"} ${Math.floor(index / 2) + 1}`,
        sources: [],
        createdAt: new Date(start + index),
        updatedAt: new Date(start + index),
      })),
    );
    const fake = knowledgeOpenRouter({ "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Vale." })) });
    await askAssistant(actor("agent"), { agentId: internal.id, chatId: chat.id, text: "Pregunta 13" }, { fetchImpl: fake.fetch });

    const [request] = chatRequests(fake);
    const sent = (request.messages as { role: string; content: unknown }[]).filter((message) => message.role !== "system").map((message) => [message.role, message.content]);
    expect(sent).toHaveLength(21);
    expect(sent[0]).toEqual(["user", "Pregunta 3"]);
    expect(sent[1]).toEqual(["assistant", "Respuesta 3"]);
    expect(sent.at(-2)).toEqual(["assistant", "Respuesta 12"]);
    expect(sent.at(-1)).toEqual(["user", "Pregunta 13"]);
  });

  it("someone without access cannot ask: nothing is stored and the AI is not called [INT-06]", async () => {
    const { internal } = await assistantWithManual("selected");
    const fake = assistantAi();
    for (const role of ["supervisor", "agent"] as const) {
      expect(await errorOf(askAssistant(actor(role), { agentId: internal.id, text: QUESTION }, { fetchImpl: fake.fetch }))).toBeInstanceOf(NotFoundError);
    }
    expect(await errorOf(askAssistant(actor("viewer"), { agentId: internal.id, text: QUESTION }, { fetchImpl: fake.fetch }))).toBeInstanceOf(AuthError);
    expect(fake.calls).toHaveLength(0);
    expect(await db.select().from(assistantChats)).toHaveLength(0);
  });

  it("an empty question or one that is too long is refused", async () => {
    const { internal } = await assistantWithManual();
    const fake = assistantAi();
    for (const text of ["   ", "x".repeat(4_001)]) {
      expect(await errorOf(askAssistant(actor("owner"), { agentId: internal.id, text }, { fetchImpl: fake.fetch }))).toBeInstanceOf(ValidationError);
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe("[INT-09] [INT-10] a conversation belongs to who wrote it", () => {
  async function chatOf(role: Role) {
    const internal = await internalAgent({ teamAccess: "everyone" });
    const fake = knowledgeOpenRouter({ "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "No lo encuentro en la documentación que tengo." })) });
    const result = await askAssistant(actor(role), { agentId: internal.id, text: "¿Cuánto cobra mi compañera?" }, { fetchImpl: fake.fetch });
    return { internal, chatId: result.chat.id };
  }

  it("nobody else can list, read, continue or delete it: not the owner, not an admin, not a colleague", async () => {
    const { internal, chatId } = await chatOf("agent");
    const fake = assistantAi();
    for (const role of ["owner", "admin", "supervisor"] as const) {
      expect(await listMyAssistantChats(actor(role), internal.id)).toEqual({ chats: [], hasMore: false });
      expect(await errorOf(getMyAssistantChat(actor(role), chatId))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(askAssistant(actor(role), { agentId: internal.id, chatId, text: "¿Qué preguntó?" }, { fetchImpl: fake.fetch }))).toBeInstanceOf(NotFoundError);
      expect(await errorOf(deleteMyAssistantChat(actor(role), chatId))).toBeInstanceOf(NotFoundError);
    }
    expect(fake.calls).toHaveLength(0);
    expect(await db.select().from(assistantMessages).where(eq(assistantMessages.chatId, chatId))).toHaveLength(2);
  });

  it("who wrote it sees it with its messages, continues it and deletes it", async () => {
    const { internal, chatId } = await chatOf("agent");
    expect((await listMyAssistantChats(actor("agent"), internal.id)).chats.map((chat) => chat.id)).toEqual([chatId]);
    const chat = await getMyAssistantChat(actor("agent"), chatId);
    expect(chat.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "¿Cuánto cobra mi compañera?"],
      ["assistant", "No lo encuentro en la documentación que tengo."],
    ]);
    await deleteMyAssistantChat(actor("agent"), chatId);
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    expect(await db.select().from(assistantMessages)).toHaveLength(0);
    expect(await listMyAssistantChats(actor("agent"), internal.id)).toEqual({ chats: [], hasMore: false });
  });

  it("however many conversations a person has with an assistant, all of them can be listed a page at a time, and only theirs", async () => {
    const internal = await internalAgent({ teamAccess: "everyone" });
    const start = Date.parse("2026-10-01T09:00:00Z");
    // In pairs with the same moment, so the page also ends between two of them.
    const mine = Array.from({ length: CHATS_PAGE_SIZE + 3 }, (_, index) => {
      const at = new Date(start + Math.floor(index / 2) * 60_000);
      return { id: crypto.randomUUID(), agentId: internal.id, userId: users.agent.userId, title: `Pregunta ${index + 1}`, createdAt: at, updatedAt: at };
    });
    await db.insert(assistantChats).values(mine);
    const [theirs] = await db.insert(assistantChats).values({ agentId: internal.id, userId: users.supervisor.userId, title: "De otra persona" }).returning();

    const first = await listMyAssistantChats(actor("agent"), internal.id);
    expect(first.chats).toHaveLength(CHATS_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    const rest = await listMyAssistantChats(actor("agent"), internal.id, first.chats.at(-1)?.id);
    expect(rest.hasMore).toBe(false);
    const listed = [...first.chats, ...rest.chats];
    // Every one of theirs exactly once, newest first, and never somebody else's.
    expect(listed).toHaveLength(mine.length);
    expect(new Set(listed.map((chat) => chat.id))).toEqual(new Set(mine.map((chat) => chat.id)));
    const moments = listed.map((chat) => chat.updatedAt.getTime());
    expect(moments).toEqual([...moments].sort((a, b) => b - a));

    // The oldest one, beyond the first page, can be deleted like any other.
    const oldest = listed.at(-1);
    await deleteMyAssistantChat(actor("agent"), oldest?.id);
    expect(await db.select().from(assistantChats).where(eq(assistantChats.id, oldest?.id ?? ""))).toHaveLength(0);

    // The list never continues from a conversation of somebody else, nor from one with another assistant.
    expect(await errorOf(listMyAssistantChats(actor("agent"), internal.id, theirs.id))).toBeInstanceOf(NotFoundError);
    const other = await internalAgent({ name: "Otro asistente", teamAccess: "everyone" });
    expect(await errorOf(listMyAssistantChats(actor("agent"), other.id, first.chats[0].id))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(listMyAssistantChats(actor("agent"), internal.id, "no-es-un-id"))).toBeInstanceOf(NotFoundError);
  });

  it("a long conversation opens with its last messages, and who wrote it can ask for the earlier ones", async () => {
    const internal = await internalAgent({ teamAccess: "everyone" });
    const [chat] = await db.insert(assistantChats).values({ agentId: internal.id, userId: users.agent.userId, title: "Una conversación larga" }).returning();
    const start = Date.parse("2026-10-01T09:00:00Z");
    const contents = Array.from({ length: MESSAGES_PAGE_SIZE + 6 }, (_, index) => `Mensaje ${index + 1}`);
    await db.insert(assistantMessages).values(
      contents.map((content, index) => ({ chatId: chat.id, role: index % 2 === 0 ? ("user" as const) : ("assistant" as const), content, sources: [], createdAt: new Date(start + index), updatedAt: new Date(start + index) })),
    );

    const opened = await getMyAssistantChat(actor("agent"), chat.id);
    expect(opened.messages.map((message) => message.content)).toEqual(contents.slice(6));
    expect(opened.hasEarlier).toBe(true);
    const earlier = await listEarlierAssistantMessages(actor("agent"), chat.id, opened.messages[0].id);
    expect(earlier.messages.map((message) => message.content)).toEqual(contents.slice(0, 6));
    expect(earlier.hasEarlier).toBe(false);

    // Nobody else reads them, and a message of another conversation is not a place to continue from.
    for (const role of ["owner", "admin", "supervisor"] as const) {
      expect(await errorOf(listEarlierAssistantMessages(actor(role), chat.id, opened.messages[0].id))).toBeInstanceOf(NotFoundError);
    }
    const { chatId: otherChatId } = await chatOf("agent");
    const [foreign] = await db.select().from(assistantMessages).where(eq(assistantMessages.chatId, otherChatId));
    expect(await errorOf(listEarlierAssistantMessages(actor("agent"), chat.id, foreign.id))).toBeInstanceOf(NotFoundError);
  });

  it("a conversation deleted while its answer was being written says so, and nothing of it is kept", async () => {
    const { internal, chatId } = await chatOf("agent");
    // The person deletes it (from another tab) while the model answers.
    const fake = knowledgeOpenRouter({
      "POST /chat/completions": async () => {
        await deleteMyAssistantChat(actor("agent"), chatId);
        return jsonResponse(chatCompletion({ content: "Vale." }));
      },
    });
    const error = await errorOf(askAssistant(actor("agent"), { agentId: internal.id, chatId, text: "¿Y la caja?" }, { fetchImpl: fake.fetch }));
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).userMessage).toBe("No se ha encontrado la conversación.");
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    expect(await db.select().from(assistantMessages)).toHaveLength(0);
  });

  it("a conversation of one assistant cannot be continued with another", async () => {
    const { chatId } = await chatOf("agent");
    const other = await internalAgent({ name: "Otro asistente", teamAccess: "everyone" });
    const fake = assistantAi();
    expect(await errorOf(askAssistant(actor("agent"), { agentId: other.id, chatId, text: "Hola" }, { fetchImpl: fake.fetch }))).toBeInstanceOf(NotFoundError);
    expect(fake.calls).toHaveLength(0);
  });

  it("without access to the assistant any more, its conversations are not shown; they come back with the access", async () => {
    const { internal, chatId } = await chatOf("agent");
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [] });
    expect(await errorOf(getMyAssistantChat(actor("agent"), chatId))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(listMyAssistantChats(actor("agent"), internal.id))).toBeInstanceOf(NotFoundError);
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [users.agent.userId] });
    expect((await getMyAssistantChat(actor("agent"), chatId)).id).toBe(chatId);
  });

  it("deleting the user deletes their conversations and their place in the lists", async () => {
    const { internal, chatId } = await chatOf("agent");
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [users.agent.userId] });
    await removeUser(actor("owner"), { userId: users.agent.userId });
    expect(await db.select().from(assistantChats).where(eq(assistantChats.id, chatId))).toHaveLength(0);
    expect(await db.select().from(assistantMessages)).toHaveLength(0);
    expect(await db.select().from(agentMembers)).toHaveLength(0);
    expect(await db.select().from(userRoles).where(eq(userRoles.userId, users.agent.userId))).toHaveLength(0);
  });

  it("deleting the internal agent deletes every conversation the team had with it", async () => {
    const { internal } = await chatOf("agent");
    await askAssistant(actor("supervisor"), { agentId: internal.id, text: "¿Cómo se abre la caja?" }, { fetchImpl: knowledgeOpenRouter().fetch });
    await setAgentAccess(actor("owner"), internal.id, { teamAccess: "selected", userIds: [users.agent.userId] });
    await deleteAgent(actor("owner"), internal.id, { storage });
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    expect(await db.select().from(assistantMessages)).toHaveLength(0);
    expect(await db.select().from(agentMembers)).toHaveLength(0);
    expect(await db.select().from(agents).where(eq(agents.id, internal.id))).toHaveLength(0);
  });
});

describe("[INT-11] without an OpenRouter key nothing is sent", () => {
  it("the question is refused, nothing is stored and the person's limit is not used", async () => {
    vi.unstubAllEnvs();
    const internal = await internalAgent({ teamAccess: "everyone" });
    const fake = assistantAi();
    expect(await errorOf(askAssistant(actor("agent"), { agentId: internal.id, text: QUESTION }, { fetchImpl: fake.fetch }))).toBeInstanceOf(AiNotConfiguredError);
    expect(fake.calls).toHaveLength(0);
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    expect(await db.select().from(rateLimits)).toHaveLength(0);
  });
});

describe("[INT-12] each person asks at most 20 questions a minute and 200 a day", () => {
  const fixedAnswer = () => knowledgeOpenRouter({ "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Vale." })) });

  it("the question after the 20th of the minute is refused and not stored; another person is not affected", async () => {
    expect(ASSISTANT_LIMITS).toEqual({ perMinute: { limit: 20, windowMs: 60_000 }, perDay: { limit: 200, windowMs: 86_400_000 } });
    const internal = await internalAgent({ teamAccess: "everyone" });
    const fake = fixedAnswer();
    const first = await askAssistant(actor("agent"), { agentId: internal.id, text: "Pregunta 1" }, { fetchImpl: fake.fetch });
    for (let number = 2; number <= 20; number += 1) await askAssistant(actor("agent"), { agentId: internal.id, chatId: first.chat.id, text: `Pregunta ${number}` }, { fetchImpl: fake.fetch });
    const calls = fake.calls.length;

    const error = await errorOf(askAssistant(actor("agent"), { agentId: internal.id, chatId: first.chat.id, text: "Pregunta 21" }, { fetchImpl: fake.fetch }));
    expect(error).toBeInstanceOf(RateLimitError);
    expect(fake.calls).toHaveLength(calls);
    expect(await db.select().from(assistantMessages).where(and(eq(assistantMessages.chatId, first.chat.id), eq(assistantMessages.role, "user")))).toHaveLength(20);

    await expect(askAssistant(actor("supervisor"), { agentId: internal.id, text: "Otra persona" }, { fetchImpl: fake.fetch })).resolves.toBeDefined();
  });

  it("past the limit of the day it says so and does not send the question", async () => {
    const internal = await internalAgent({ teamAccess: "everyone" });
    const hits: { key: string; limit: number; windowMs: number }[] = [];
    // A day already used up for this person; the minute still has room.
    const limiter: RateLimiter = {
      async hit(key, limit, windowMs) {
        hits.push({ key, limit, windowMs });
        return { allowed: windowMs === ASSISTANT_LIMITS.perMinute.windowMs, remaining: 0, resetAt: new Date(), limit };
      },
      isLimited: async () => false,
      reset: async () => undefined,
      deleteBefore: async () => 0,
    };
    const fake = fixedAnswer();
    const error = await errorOf(askAssistant(actor("agent"), { agentId: internal.id, text: "Una más" }, { fetchImpl: fake.fetch, limiter }));
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).userMessage).toMatch(/hoy/);
    expect(fake.calls).toHaveLength(0);
    expect(await db.select().from(assistantChats)).toHaveLength(0);
    expect(hits).toEqual([
      { key: `ai:assistant:${users.agent.userId}`, limit: 20, windowMs: 60_000 },
      { key: `ai:assistant_day:${users.agent.userId}`, limit: 200, windowMs: 86_400_000 },
    ]);
  });
});
