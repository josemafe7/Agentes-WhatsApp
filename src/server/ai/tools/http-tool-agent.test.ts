import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { agentCustomTools, agents, aiRuns, appKv, auditLog, customTools, integrationSettings } from "@/db/schema";
import { encryptSecret } from "@/server/crypto";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, sequence } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness } from "@/test/factories";
import type { ResolveHost } from "@/server/web-fetch";
import { runAgent } from "../run-agent";
import { parametersToJsonSchema, type HttpToolParameter } from "./http-tool-definition";
import { loadAgentHttpTools, readSecretHeaders } from "./http-tool-agent";
import type { HttpToolDeps } from "./http-tool";
import { executeToolCall, type ToolContext } from "./index";

const SECRET = "sk-crm-live-5566778899aabbcc";
const NOW = new Date("2026-09-30T09:00:00Z");

const numero: HttpToolParameter = { name: "numero", type: "string", description: "Número del pedido", required: true, options: [] };

async function createTool(overrides: Partial<typeof customTools.$inferInsert> = {}) {
  const [row] = await db
    .insert(customTools)
    .values({
      name: "consultar_pedido",
      description: "Consulta el estado de un pedido de la tienda por su número.",
      parameters: parametersToJsonSchema([numero]),
      method: "GET",
      url: "https://crm.example.com/pedidos/{numero}",
      timeoutMs: 10_000,
      secretHeadersEnc: encryptSecret(JSON.stringify({ "X-Api-Key": SECRET })),
      ...overrides,
    })
    .returning();
  return row;
}

async function attach(agentId: string, toolId: string) {
  await db.insert(agentCustomTools).values({ agentId, customToolId: toolId });
}

/** A fake CRM and a DNS that says it is public. */
function fakeCrm(answer: () => Response = () => jsonResponse({ pedido: "42", estado: "En reparto" })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const resolveHost: ResolveHost = async () => [{ address: "93.184.215.14", family: 4 }];
  const deps: HttpToolDeps = {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return answer();
    },
    resolveHost,
    allowLocal: false,
  };
  return { deps, calls };
}

const context = (agentId: string, overrides: Partial<ToolContext> = {}): ToolContext => ({
  mode: "live",
  agentId,
  conversationId: crypto.randomUUID(),
  contactId: null,
  channelId: null,
  now: NOW,
  timezone: "Europe/Madrid",
  withinBusinessHours: true,
  handoff: {},
  ...overrides,
});

/** Each reading is `step` ms after the previous one. */
function steppingClock(step: number): () => number {
  let now = 0;
  return () => (now += step);
}

const call = (name: string, args: unknown) => ({ id: "call_1", type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(agentCustomTools);
  await db.delete(customTools);
});

describe("the agent's custom HTTP tools [AGE-08] [HER-11]", () => {
  it("only the tools attached to the agent, switched on, with the description and parameters the model reads", async () => {
    const agent = await createAgentRow();
    const other = await createAgentRow();
    const tool = await createTool();
    const off = await createTool({ name: "apagada", enabled: false });
    const elsewhere = await createTool({ name: "de_otro_agente" });
    await attach(agent.id, tool.id);
    await attach(agent.id, off.id);
    await attach(other.id, elsewhere.id);

    const tools = await loadAgentHttpTools(agent.id);
    expect(tools.map((candidate) => candidate.name)).toEqual(["consultar_pedido"]);
    expect(tools[0].description).toBe("Consulta el estado de un pedido de la tienda por su número.");
    expect(tools[0].jsonSchema).toMatchObject({
      type: "object",
      properties: { numero: { type: "string", description: "Número del pedido" } },
      required: ["numero"],
    });
    expect(JSON.stringify(tools[0].jsonSchema)).not.toContain(SECRET);
  });

  it("a stored row this app did not write, or named like a system tool, is never offered", async () => {
    const agent = await createAgentRow();
    const broken = await createTool({ name: "rota", parameters: { type: "object", properties: { x: { type: "fecha" } } } });
    const clash = await createTool({ name: "crear_cita" });
    await attach(agent.id, broken.id);
    await attach(agent.id, clash.id);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadAgentHttpTools(agent.id)).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it("the arguments are validated with Zod first: an invalid call gets a Spanish error and nothing is called [HER-02]", async () => {
    const agent = await createAgentRow();
    await attach(agent.id, (await createTool()).id);
    const crm = fakeCrm();
    const tools = new Map((await loadAgentHttpTools(agent.id, crm.deps)).map((tool) => [tool.name, tool]));
    const outcome = await executeToolCall(tools, call("consultar_pedido", { numero: 42 }), context(agent.id));
    expect(outcome.record).toMatchObject({ name: "consultar_pedido", ok: false, result: { ok: false, error: "Datos no válidos: numero: Tiene que ser un texto." } });
    const missing = await executeToolCall(tools, call("consultar_pedido", {}), context(agent.id));
    expect(missing.record.result.error).toBe("Datos no válidos: numero: Falta este dato.");
    expect(crm.calls).toHaveLength(0);
  });

  it("a call returns the answer to the model and is logged with tool, agent, conversation, status and time, never secrets or data [HER-03] [SEG-10]", async () => {
    const agent = await createAgentRow();
    const tool = await createTool();
    await attach(agent.id, tool.id);
    const crm = fakeCrm();
    const tools = new Map((await loadAgentHttpTools(agent.id, { ...crm.deps, clock: steppingClock(80) })).map((item) => [item.name, item]));
    const ctx = context(agent.id);
    const outcome = await executeToolCall(tools, call("consultar_pedido", { numero: "42" }), ctx);

    expect(crm.calls).toHaveLength(1);
    expect(crm.calls[0].url).toBe("https://crm.example.com/pedidos/42");
    expect(new Headers(crm.calls[0].init.headers).get("x-api-key")).toBe(SECRET);
    expect(outcome.record).toMatchObject({ ok: true, result: { ok: true, estado: 200, respuesta: { pedido: "42", estado: "En reparto" } } });
    expect(outcome.message.content).not.toContain(SECRET);

    const entries = await db.select().from(auditLog);
    const httpEntry = entries.find((entry) => entry.action === "ai.http_tool_called");
    expect(httpEntry).toMatchObject({
      actorType: "ai",
      targetType: "conversation",
      targetId: ctx.conversationId,
      metadata: {
        tool: "consultar_pedido",
        toolId: tool.id,
        agentId: agent.id,
        mode: "live",
        method: "GET",
        host: "crm.example.com",
        status: 200,
        durationMs: 80,
        ok: true,
      },
    });
    expect(entries.map((entry) => entry.action).sort()).toEqual(["ai.http_tool_called", "ai.tool_called"]);
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("En reparto");
    expect(logged).not.toContain("/pedidos/42");
  });

  it("a failed call is logged with its error code and the model gets the Spanish explanation", async () => {
    const agent = await createAgentRow();
    await attach(agent.id, (await createTool()).id);
    const crm = fakeCrm(() => jsonResponse({ error: "caído" }, 503));
    const tools = new Map((await loadAgentHttpTools(agent.id, crm.deps)).map((tool) => [tool.name, tool]));
    const outcome = await executeToolCall(tools, call("consultar_pedido", { numero: "42" }), context(agent.id, { conversationId: null, mode: "test" }));
    expect(outcome.record.result).toMatchObject({ ok: false, error: "El servicio ha respondido con un error (503).", estado: 503 });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "ai.http_tool_called"));
    expect(entry).toMatchObject({ targetType: "agent", targetId: agent.id, metadata: { ok: false, status: 503, error: "http_status", mode: "test" } });
  });

  it("secret headers that cannot be read (the key changed) stop the call with an explanation [SEG-03]", async () => {
    const agent = await createAgentRow();
    await attach(agent.id, (await createTool({ secretHeadersEnc: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA" })).id);
    const crm = fakeCrm();
    const tools = new Map((await loadAgentHttpTools(agent.id, crm.deps)).map((tool) => [tool.name, tool]));
    const outcome = await executeToolCall(tools, call("consultar_pedido", { numero: "42" }), context(agent.id));
    expect(outcome.record.result).toMatchObject({ ok: false, error: expect.stringMatching(/cabeceras secretas no se pueden leer/) });
    expect(crm.calls).toHaveLength(0);
    expect(readSecretHeaders(null)).toEqual({});
    expect(readSecretHeaders(encryptSecret("no es json"))).toBeNull();
  });
});

describe("runAgent offers the attached tools, also in «Probar agente» [AGE-08] [PRU-01]", () => {
  beforeEach(async () => {
    await createBusiness({ name: "Tienda Lola", timezone: "Europe/Madrid" });
    await ensureSettingsRows();
    await db.update(integrationSettings).set({ zdr: false });
    await db.delete(appKv);
    await db.delete(aiRuns);
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("the model sees the tool next to the system ones, calls it and answers with what it returned", async () => {
    const agent = await createAgentRow({ systemTools: ["transferir_a_humano"] });
    await attach(agent.id, (await createTool()).id);
    const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
    const crm = fakeCrm();
    const openRouter = fakeFetch(
      routes({
        "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
        "POST /chat/completions": sequence(
          () => jsonResponse(chatCompletion({ toolCalls: [{ name: "consultar_pedido", arguments: { numero: "42" } }] })),
          () => jsonResponse(chatCompletion({ content: "Tu pedido 42 está en reparto." })),
        ),
      }),
    );

    const result = await runAgent(
      { agent: row, history: [{ role: "contact", text: "¿Cómo va mi pedido 42?" }], mode: "test" },
      { fetchImpl: openRouter.fetch, now: NOW, httpTools: crm.deps },
    );

    const chats = openRouter.calls.filter((item) => item.path === "/chat/completions");
    const offered = (chats[0].body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);
    expect(offered).toEqual(["transferir_a_humano", "consultar_pedido"]);
    expect(result.text).toBe("Tu pedido 42 está en reparto.");
    expect(result.toolCalls).toMatchObject([{ name: "consultar_pedido", ok: true, arguments: { numero: "42" }, result: { estado: 200 } }]);
    expect(crm.calls).toHaveLength(1);
    // What went back to the model: the answer, never the secret header.
    const toolMessage = (chats[1].body as { messages: { role: string; content: string }[] }).messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("En reparto");
    expect(JSON.stringify(chats)).not.toContain(SECRET);
  });
});
