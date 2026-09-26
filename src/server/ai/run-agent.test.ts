import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { agents, aiRuns, appKv, auditLog, conversations, integrationSettings } from "@/db/schema";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, sequence, type FakeHandler } from "@/test/fake-openrouter";
import { createBusiness } from "@/test/factories";
import { AgentRunError, AiNotConfiguredError } from "./errors";
import { MAX_TOOL_CALLS_PER_STEP, MAX_TOOL_STEPS, REFUSAL_REPLY, runAgent, type RunAgentInput } from "./run-agent";

const IN_HOURS = "Te paso con una persona del equipo ahora mismo.";
const OFF_HOURS = "Ahora estamos cerrados; te contestamos al abrir.";
// Wednesday 30 Sep 2026, 11:00 in Madrid.
const NOW = new Date("2026-09-30T09:00:00Z");

async function createAgentRow(overrides: Partial<typeof agents.$inferInsert> = {}) {
  const [row] = await db
    .insert(agents)
    .values({
      name: "Asistente de citas",
      model: "openai/gpt-5.6-luna",
      fallbackModel: "google/gemini-3.1-flash-lite",
      instructions: { role: "Eres el asistente de la peluquería." },
      handoff: { messageInHours: IN_HOURS, messageOffHours: OFF_HOURS },
      systemTools: ["transferir_a_humano"],
      ...overrides,
    })
    .returning();
  return row;
}

/** OpenRouter with the sample catalogue and the given chat answers. */
function openRouter(...chat: FakeHandler[]) {
  return fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": sequence(...chat) }));
}

const chatCalls = (fake: ReturnType<typeof fakeFetch>) => fake.calls.filter((call) => call.path === "/chat/completions");
const body = (call: { body: unknown }) => call.body as Record<string, unknown>;

async function run(fake: ReturnType<typeof fakeFetch>, overrides: Partial<RunAgentInput> = {}) {
  const agent = overrides.agent ?? (await createAgentRow());
  let tick = 1_000;
  return runAgent(
    { agent, history: [{ role: "contact", text: "Hola, ¿tenéis hueco mañana?" }], mode: "test", ...overrides },
    { fetchImpl: fake.fetch, now: NOW, clock: () => (tick += 350) },
  );
}

beforeEach(async () => {
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid" });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  await db.delete(appKv);
  await db.delete(aiRuns);
  await db.delete(auditLog);
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("without a key the agent does not reply [PRU-07] [ARR-14]", () => {
  it("throws AiNotConfiguredError, calls nothing and records nothing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fake = openRouter(() => jsonResponse(chatCompletion()));
    await expect(run(fake)).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(fake.calls).toHaveLength(0);
    expect(await db.select().from(aiRuns)).toHaveLength(0);
  });
});

describe("one reply, recorded [MOT-08] [MOT-10] [MOT-11] [PRU-02]", () => {
  it("sends the prompt with the fallback, privacy rules, session, low reasoning and the hand-off tool", async () => {
    const fake = openRouter(() => jsonResponse(chatCompletion({ content: "¡Hola! Soy el asistente de IA. Mañana tengo hueco a las 10:00." })));
    const result = await run(fake);
    const [call] = chatCalls(fake);
    const request = body(call);
    expect(request).toMatchObject({
      models: ["openai/gpt-5.6-luna", "google/gemini-3.1-flash-lite"],
      stream: false,
      provider: { data_collection: "deny" },
      reasoning: { effort: "low" },
      max_tokens: 2000,
      tool_choice: "auto",
    });
    expect(String(request.session_id)).toMatch(/^prueba-/);
    // gpt-5.6-luna does not take temperature (§3.6).
    expect(request).not.toHaveProperty("temperature");
    expect((request.tools as { function: { name: string } }[]).map((tool) => tool.function.name)).toEqual(["transferir_a_humano"]);
    const messages = request.messages as { role: string; content: string }[];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content.startsWith("# Reglas de la plataforma")).toBe(true);
    expect(messages.at(-1)).toEqual({ role: "user", content: "Hola, ¿tenéis hueco mañana?" });

    expect(result).toMatchObject({
      text: "¡Hola! Soy el asistente de IA. Mañana tengo hueco a las 10:00.",
      toolCalls: [],
      modelRequested: "openai/gpt-5.6-luna",
      modelUsed: "openai/gpt-5.6-luna",
      provider: "OpenAI",
      steps: 1,
      handedOff: false,
      retrievals: [],
      costUsd: 0.00024,
      usage: { promptTokens: 1200, completionTokens: 40, totalTokens: 1240 },
    });
    expect(result.latencyMs).toBeGreaterThan(0);

    const [row] = await db.select().from(aiRuns).where(eq(aiRuns.id, result.runId));
    expect(row).toMatchObject({
      kind: "chat",
      agentId: expect.any(String),
      modelRequested: "openai/gpt-5.6-luna",
      modelUsed: "openai/gpt-5.6-luna",
      provider: "OpenAI",
      promptTokens: 1200,
      completionTokens: 40,
      cachedTokens: 0,
      costUsd: 0.00024,
      latencyMs: result.latencyMs,
      toolsUsed: [],
      steps: 1,
      ok: true,
      error: null,
      isTest: true,
    });
  });

  it("the fallback of another provider answers when the primary fails, and that model is recorded [MOD-05]", async () => {
    const fake = openRouter(() => jsonResponse(chatCompletion({ content: "Respondo yo.", model: "google/gemini-3.1-flash-lite", provider: "Google Vertex" })));
    const result = await run(fake);
    expect(result).toMatchObject({ modelRequested: "openai/gpt-5.6-luna", modelUsed: "google/gemini-3.1-flash-lite", provider: "Google Vertex" });
    const [row] = await db.select().from(aiRuns);
    expect(row).toMatchObject({ modelRequested: "openai/gpt-5.6-luna", modelUsed: "google/gemini-3.1-flash-lite" });
  });

  it("a fallback from the same provider is not sent", async () => {
    const fake = openRouter(() => jsonResponse(chatCompletion()));
    await run(fake, { agent: await createAgentRow({ fallbackModel: "openai/gpt-6-luna" }) });
    const request = body(chatCalls(fake)[0]);
    expect(request).toMatchObject({ model: "openai/gpt-5.6-luna" });
    expect(request).not.toHaveProperty("models");
  });

  it("adds zdr when «Sin retención de datos» is on [CUM-10]", async () => {
    await db.update(integrationSettings).set({ zdr: true });
    const fake = openRouter(() => jsonResponse(chatCompletion()));
    await run(fake);
    expect(body(chatCalls(fake)[0]).provider).toEqual({ data_collection: "deny", zdr: true });
  });

  it("simulates the chosen channel in «Probar agente» [PRU-03]", async () => {
    const fake = openRouter(() => jsonResponse(chatCompletion()));
    await run(fake, { simulateChannel: "email" });
    const system = (body(chatCalls(fake)[0]).messages as { content: string }[])[0].content;
    expect(system).toMatch(/simulando correo electrónico/);
  });

  it("a refusal becomes an offer to talk to a person, never an empty reply", async () => {
    const refused = chatCompletion({ content: null, finishReason: "content_filter" });
    (refused.choices[0].message as Record<string, unknown>).refusal = "No puedo ayudar con eso.";
    const result = await run(openRouter(() => jsonResponse(refused)));
    expect(result.text).toBe(REFUSAL_REPLY);
  });
});

describe("tools loop [MOT-08] [MOT-09] [HER-02]", () => {
  it("runs the tools, sends their results back with the tools again, and ends with one text; costs add up", async () => {
    const details = [{ type: "reasoning.encrypted", data: "xyz" }];
    const fake = openRouter(
      () =>
        jsonResponse(
          chatCompletion({ toolCalls: [{ id: "call_a", name: "transferir_a_humano", arguments: { motivo: "x" } }], reasoningDetails: details, usage: { cost: 0.001, cached: 900 } }),
        ),
      () => jsonResponse(chatCompletion({ content: "Perdona, ¿me dices qué necesitas?", usage: { cost: 0.002 } })),
    );
    const result = await run(fake);
    const calls = chatCalls(fake);
    expect(calls).toHaveLength(2);
    const second = body(calls[1]);
    expect(second.tools).toEqual(body(calls[0]).tools);
    const messages = second.messages as Record<string, unknown>[];
    expect(messages.at(-2)).toMatchObject({ role: "assistant", content: null, reasoning_details: details, tool_calls: [{ id: "call_a" }] });
    expect(messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_a" });
    expect(String(messages.at(-1)?.content)).toMatch(/resumen/);

    expect(result.text).toBe("Perdona, ¿me dices qué necesitas?");
    expect(result.steps).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.003, 10);
    expect(result.usage.cachedTokens).toBe(900);
    expect(result.toolCalls).toEqual([expect.objectContaining({ id: "call_a", name: "transferir_a_humano", ok: false })]);
    const [row] = await db.select().from(aiRuns);
    expect(row).toMatchObject({ steps: 2, toolsUsed: [{ name: "transferir_a_humano", ok: false }], cachedTokens: 900 });
    expect(row.costUsd).toBeCloseTo(0.003, 10);
  });

  it("the hand-off ends the turn with the agent's message inside opening hours [HER-08] [TRA-03]", async () => {
    const { businessHours } = await import("@/db/schema");
    await db.insert(businessHours).values({ weekday: 3, startMin: 600, endMin: 1200 });
    const fake = openRouter(() =>
      jsonResponse(chatCompletion({ toolCalls: [{ name: "transferir_a_humano", arguments: { motivo: "Pide una persona", resumen: "Quiere hablar con Marta.", urgencia: "normal" } }] })),
    );
    const result = await run(fake);
    expect(chatCalls(fake)).toHaveLength(1);
    expect(result).toMatchObject({ text: IN_HOURS, handedOff: true, steps: 1 });
    expect(result.toolCalls[0]).toMatchObject({ name: "transferir_a_humano", ok: true, result: { simulado: true } });
    await db.delete(businessHours);
  });

  it("outside opening hours the hand-off message is the off-hours one", async () => {
    const fake = openRouter(() =>
      jsonResponse(chatCompletion({ toolCalls: [{ name: "transferir_a_humano", arguments: { motivo: "Pide una persona", resumen: "Quiere hablar con Marta.", urgencia: "normal" } }] })),
    );
    expect((await run(fake)).text).toBe(OFF_HOURS);
  });

  it(`runs at most ${MAX_TOOL_CALLS_PER_STEP} tools of one answer; every other call gets an error and one entry in the log [HER-03] [SEG-10]`, async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `call_${index}`, name: `inventada_${index}`, arguments: {} }));
    const fake = openRouter(
      () => jsonResponse(chatCompletion({ toolCalls: many })),
      () => jsonResponse(chatCompletion({ content: "Perdona, ¿me dices qué necesitas?" })),
    );
    const result = await run(fake);
    expect(result.toolCalls).toHaveLength(MAX_TOOL_CALLS_PER_STEP);
    expect(new Set(result.toolCalls.map((call) => call.name))).toEqual(new Set(["desconocida"]));
    // Every call has its answer in the next request.
    const answers = (body(chatCalls(fake)[1]).messages as Record<string, unknown>[]).filter((message) => message.role === "tool");
    expect(answers.map((answer) => answer.tool_call_id)).toEqual(many.map((call) => call.id));
    expect(String(answers.at(-1)?.content)).toMatch(/demasiadas herramientas/);
    const log = await db.select().from(auditLog);
    expect(log.filter((entry) => entry.action === "ai.tool_called")).toHaveLength(MAX_TOOL_CALLS_PER_STEP);
    expect(log.filter((entry) => entry.action === "ai.tool_calls_skipped").map((entry) => entry.metadata)).toEqual([
      expect.objectContaining({ reason: "too_many", count: 40 - MAX_TOOL_CALLS_PER_STEP }),
    ]);
  });

  it("after the hand-off nothing else of the same answer runs: one reply per turn [MOT-10]", async () => {
    const handoff = { name: "transferir_a_humano", arguments: { motivo: "Pide una persona", resumen: "Quiere hablar con Marta.", urgencia: "normal" } };
    const fake = openRouter(() => jsonResponse(chatCompletion({ toolCalls: [handoff, { ...handoff, id: "otra" }, { name: "cancelar_cita", arguments: {} }] })));
    const result = await run(fake);
    expect(result).toMatchObject({ handedOff: true, steps: 1, text: OFF_HOURS });
    expect(result.toolCalls).toEqual([expect.objectContaining({ name: "transferir_a_humano", ok: true })]);
    const log = await db.select().from(auditLog);
    expect(log.filter((entry) => entry.action === "ai.tool_called")).toHaveLength(1);
    expect(log.find((entry) => entry.action === "ai.tool_calls_skipped")?.metadata).toMatchObject({ reason: "handed_off", count: 2 });
  });

  it(`after ${MAX_TOOL_STEPS} steps without a final answer nothing is sent: the run is recorded and fails`, async () => {
    const fake = openRouter(() => jsonResponse(chatCompletion({ toolCalls: [{ name: "transferir_a_humano", arguments: {} }], usage: { cost: 0.001 } })));
    const error = await run(fake).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentRunError);
    expect(error).toMatchObject({ reason: "step_limit", retryable: false });
    expect(chatCalls(fake)).toHaveLength(MAX_TOOL_STEPS);
    const [row] = await db.select().from(aiRuns);
    expect(row).toMatchObject({ ok: false, steps: MAX_TOOL_STEPS, error: expect.stringMatching(/6 pasos/) });
    expect(row.id).toBe((error as AgentRunError).runId);
    // Tools asked on the last step are not run.
    expect(row.toolsUsed).toHaveLength(MAX_TOOL_STEPS - 1);
  });
});

describe("errors are typed and recorded [MOT-12: retryable flag, message and record; the retry itself is the engine's, phase 2]", () => {
  it("no credits: not retryable, Spanish message, run recorded as failed", async () => {
    const fake = openRouter(() => jsonResponse({ error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }, 402));
    const error = (await run(fake).catch((caught: unknown) => caught)) as AgentRunError;
    expect(error).toBeInstanceOf(AgentRunError);
    expect(error).toMatchObject({ reason: "no_credits", retryable: false });
    expect(error.userMessage).toMatch(/saldo/);
    const [row] = await db.select().from(aiRuns);
    expect(row).toMatchObject({ ok: false, error: error.userMessage, modelRequested: "openai/gpt-5.6-luna", isTest: true });
  });

  it("rate limits and time-outs are retryable", async () => {
    const limited = (await run(openRouter(() => jsonResponse({ error: { code: 429, message: "slow" } }, 429))).catch((caught: unknown) => caught)) as AgentRunError;
    expect(limited).toMatchObject({ reason: "rate_limited", retryable: true });
    const timeout = (await run(openRouter(() => jsonResponse({ error: { code: 504, message: "slow" } }, 504))).catch((caught: unknown) => caught)) as AgentRunError;
    expect(timeout).toMatchObject({ reason: "timeout", retryable: true });
  });

  it("a live run is recorded for its conversation and does not count as a test [INF-08]", async () => {
    const [conversation] = await db.insert(conversations).values({ isTest: false }).returning();
    const fake = openRouter(() => jsonResponse(chatCompletion()));
    const result = await run(fake, { mode: "live", context: { conversationId: conversation.id, channelKind: "whatsapp" } });
    expect(body(chatCalls(fake)[0]).session_id).toBe(conversation.id);
    const [row] = await db.select().from(aiRuns).where(eq(aiRuns.id, result.runId));
    expect(row).toMatchObject({ isTest: false, conversationId: conversation.id });
  });
});
