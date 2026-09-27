import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createKnowledgeBase } from "@/data/knowledge";
import { createAgentContextFileFromText } from "@/data/knowledge-context-files";
import { db } from "@/db";
import { agentContextFiles, agentKnowledgeBases, agents, appKv, integrationSettings, knowledgeBases } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { openRouterModelSchema } from "@/lib/openrouter/schemas";
import { MODEL_CATALOG_KV_KEY, normalizeModel } from "@/server/ai/models";
import { setKv } from "@/server/kv";
import { estimateTokens } from "@/server/knowledge/tokens";
import { modelEntry } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createUser, type TestUser } from "@/test/factories";
import { loadKnowledgeTab } from "./load";

const users = {} as Record<Role, TestUser>;

beforeAll(async () => {
  await createBusiness();
  for (const role of ["owner", "admin", "supervisor", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  for (const table of [agentKnowledgeBases, knowledgeBases, agentContextFiles, appKv]) await db.delete(table);
  await db.delete(agents);
  await db.update(integrationSettings).set({ defaultModels: {} });
});

const actor = (role: Role) => users[role].actor;

/** The model list as the Modelo tab caches it, with the prices of OpenRouter (USD per token). */
async function cacheCatalog(entries: Record<string, unknown>[]) {
  const models = entries.flatMap((entry) => {
    const parsed = openRouterModelSchema.safeParse(entry);
    return parsed.success ? [normalizeModel(parsed.data)] : [];
  });
  await setKv(MODEL_CATALOG_KV_KEY, { format: 1, fetchedAt: new Date().toISOString(), source: "user", models });
}

describe("pestaña Conocimiento del agente [AGE-07] [CON-03]", () => {
  it("who manages agents sees every base with whether this agent uses it; the rest only the ones it uses", async () => {
    const agent = await createAgentRow();
    const hair = (await createKnowledgeBase(actor("owner"), { name: "Peluquería" })).id;
    const beauty = (await createKnowledgeBase(actor("owner"), { name: "Estética", description: "Tratamientos" })).id;
    await db.insert(agentKnowledgeBases).values({ agentId: agent.id, knowledgeBaseId: hair });

    const managed = await loadKnowledgeTab(actor("admin"), agent, { canManage: true });
    expect(managed.selectedCount).toBe(1);
    expect(managed.bases).toEqual([
      { id: beauty, name: "Estética", description: "Tratamientos", state: "empty", documentCount: 0, selected: false },
      { id: hair, name: "Peluquería", description: null, state: "empty", documentCount: 0, selected: true },
    ]);

    for (const role of ["supervisor", "viewer"] as const) {
      const readOnly = await loadKnowledgeTab(actor(role), agent, { canManage: false });
      expect(readOnly.selectedCount).toBe(1);
      expect(readOnly.bases.map((base) => base.id)).toEqual([hair]);
    }
  });
});

describe("archivos de contexto y su coste [CON-01] [CON-02]", () => {
  it("lists the agent's context files with their tokens and the total against the 30,000 cap", async () => {
    const agent = await createAgentRow();
    await createAgentContextFileFromText(actor("owner"), agent.id, { title: "Normas", contentMd: "Llega 5 minutos antes." });
    const tab = await loadKnowledgeTab(actor("viewer"), agent, { canManage: false });
    expect(tab.contextFiles.files).toMatchObject([{ title: "Normas", tokenCount: estimateTokens("Llega 5 minutos antes.") }]);
    expect(tab.contextFiles.budget).toMatchObject({ totalTokens: estimateTokens("Llega 5 minutos antes."), maxTokens: 30_000, warnTokens: 20_000, level: "ok" });
  });

  it("the cost per message comes from the cached price of the agent's model (never a fixed price)", async () => {
    const agent = await createAgentRow({ model: "openai/gpt-5.6-luna" });
    await createAgentContextFileFromText(actor("owner"), agent.id, { title: "Carta", contentMd: "x".repeat(35_000) });
    await cacheCatalog([modelEntry({ id: "openai/gpt-5.6-luna", pricing: { prompt: "0.0000002", completion: "0.0000012" } })]);
    const tab = await loadKnowledgeTab(actor("owner"), agent, { canManage: true });
    expect(tab.cost.modelId).toBe("openai/gpt-5.6-luna");
    // 10,000 tokens × 0.20 US$ per million.
    expect(tab.cost.perMessage).toBeCloseTo(0.002, 10);
  });

  it("an agent without its own model uses the default chat model of Settings › IA", async () => {
    const agent = await createAgentRow({ model: null });
    await db.update(integrationSettings).set({ defaultModels: { chat: "anthropic/claude-haiku-4.5" } });
    await cacheCatalog([modelEntry({ id: "anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5", pricing: { prompt: "0.000001", completion: "0.000005" } })]);
    await createAgentContextFileFromText(actor("owner"), agent.id, { title: "Carta", contentMd: "x".repeat(3_500) });
    const tab = await loadKnowledgeTab(actor("owner"), agent, { canManage: true });
    expect(tab.cost).toEqual({ modelId: "anthropic/claude-haiku-4.5", perMessage: expect.closeTo(0.001, 10) });
  });

  it("without the model list (or a price for the model) there is no amount, only the tokens", async () => {
    const agent = await createAgentRow({ model: "openai/gpt-5.6-luna" });
    await createAgentContextFileFromText(actor("owner"), agent.id, { title: "Carta", contentMd: "Texto." });
    expect((await loadKnowledgeTab(actor("owner"), agent, { canManage: true })).cost.perMessage).toBeNull();
    await cacheCatalog([modelEntry({ id: "google/gemini-3.1-flash-lite", name: "Google: Gemini 3.1 Flash Lite" })]);
    expect((await loadKnowledgeTab(actor("owner"), agent, { canManage: true })).cost.perMessage).toBeNull();
  });
});
