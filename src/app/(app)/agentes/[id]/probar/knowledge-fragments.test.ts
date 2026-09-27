// «Probar agente» shows each knowledge fragment with its score and source, base included ([PRU-02]).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agentKnowledgeBases, agents, knowledgeBases, rateLimits } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { runAgent, type RunAgentResult } from "@/server/ai/run-agent";
import { FAKE_BASE_URL, FAKE_OPENROUTER_KEY } from "@/test/fake-openrouter";
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
// The model never runs here: each test says what the turn returned.
vi.mock("@/server/ai/run-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/run-agent")>();
  return { ...actual, runAgent: vi.fn() };
});

import { sendTestMessageAction } from "./actions";

const runAgentMock = vi.mocked(runAgent);

function runResult(retrievals: RunAgentResult["retrievals"]): RunAgentResult {
  return {
    runId: crypto.randomUUID(),
    text: "Un corte cuesta 18 €, según las tarifas.",
    toolCalls: [{ id: "call_1", name: "buscar_conocimiento", arguments: { consulta: "precio corte" }, ok: true, result: { ok: true, resultado: "[1] Tarifas 2026 · Cortes · pág. 3" } }],
    usage: { promptTokens: 900, completionTokens: 30, totalTokens: 930, cachedTokens: 0, reasoningTokens: 0 },
    costUsd: 0.0002,
    latencyMs: 700,
    modelRequested: "openai/gpt-5.6-luna",
    modelUsed: "openai/gpt-5.6-luna",
    provider: "OpenAI",
    steps: 2,
    handedOff: false,
    retrievals,
  };
}

const hello = (agentId: string) => ({ agentId, channel: "whatsapp", messages: [{ role: "contact", text: "¿Cuánto cuesta un corte?" }] });

let supervisor: TestUser;
let agentId: string;
let salonKb: string;
let spaKb: string;

beforeAll(async () => {
  await createBusiness();
  supervisor = await createUser("supervisor");
});

beforeEach(async () => {
  state.actor = supervisor.actor;
  runAgentMock.mockReset();
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  vi.stubEnv("OPENROUTER_BASE_URL", FAKE_BASE_URL);
  await db.delete(rateLimits);
  await db.delete(agentKnowledgeBases);
  await db.delete(knowledgeBases);
  await db.delete(agents);
  agentId = (await createAgentRow({ systemTools: ["transferir_a_humano", "buscar_conocimiento"] })).id;
  [{ id: salonKb }, { id: spaKb }] = await db
    .insert(knowledgeBases)
    .values([{ name: "Peluquería" }, { name: "Estética" }])
    .returning({ id: knowledgeBases.id });
  await db.insert(agentKnowledgeBases).values([
    { agentId, knowledgeBaseId: salonKb },
    { agentId, knowledgeBaseId: spaKb },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("«Probar agente»: fragments with score and source [PRU-02]", () => {
  it("each fragment says its rank, score, title, section, page and base", async () => {
    runAgentMock.mockResolvedValueOnce(
      runResult([
        { chunkId: crypto.randomUUID(), documentId: crypto.randomUUID(), kbId: salonKb, rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3 },
        { chunkId: crypto.randomUUID(), documentId: crypto.randomUUID(), kbId: spaKb, rank: 2, score: 0.016, title: "Tratamientos", section: null, page: null },
      ]),
    );
    const result = await sendTestMessageAction(hello(agentId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.retrievals).toEqual([
      { rank: 1, score: 0.033, title: "Tarifas 2026", section: "Cortes", page: 3, knowledgeBase: "Peluquería" },
      { rank: 2, score: 0.016, title: "Tratamientos", section: null, page: null, knowledgeBase: "Estética" },
    ]);
    // Only what the screen shows: no internal ids reach the browser.
    expect(JSON.stringify(result.data)).not.toMatch(/runId|chunkId|documentId|kbId/);
    expect(JSON.stringify(result.data)).not.toContain(salonKb);
  });

  it("a reply without fragments shows none", async () => {
    runAgentMock.mockResolvedValueOnce(runResult([]));
    const result = await sendTestMessageAction(hello(agentId));
    expect(result).toMatchObject({ ok: true, data: { retrievals: [] } });
  });
});
