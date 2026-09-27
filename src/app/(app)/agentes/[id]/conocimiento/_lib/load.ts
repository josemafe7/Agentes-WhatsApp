// What the agent's Conocimiento tab shows ([AGE-07], [CON-01]–[CON-03]), read through src/data with the actor
// (each function checks the permission again). The cost uses the cached model list: no network on this page.
import "server-only";
import type { Agent } from "@/data/agents";
import { listAgentKnowledgeBases, listKnowledgeBases, type KnowledgeBaseState } from "@/data/knowledge";
import { listAgentContextFiles, type ContextFileItem, type ContextFilesBudget } from "@/data/knowledge-context-files";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { findModel, getCachedModelCatalog } from "@/server/ai/models";
import { resolveDefaultModels } from "@/server/ai/openrouter";
import { costPerMessage } from "./view";

export type AgentBaseRow = {
  id: string;
  name: string;
  description: string | null;
  /** Null when the person may not see the knowledge area (only the names of the agent's bases then). */
  state: KnowledgeBaseState | null;
  documentCount: number | null;
  /** This agent searches it ([CON-03]). */
  selected: boolean;
};

export type KnowledgeTabData = {
  contextFiles: { files: ContextFileItem[]; budget: ContextFilesBudget };
  /** Who manages agents: every base, to switch them on and off. The rest: only the ones the agent uses. */
  bases: AgentBaseRow[];
  selectedCount: number;
  /** Model whose input price the context files pay on every message, and that cost (USD) or null if unknown. */
  cost: { modelId: string; perMessage: number | null };
};

export async function loadKnowledgeTab(actor: Actor, agent: Pick<Agent, "id" | "model">, options: { canManage: boolean }): Promise<KnowledgeTabData> {
  const [contextFiles, agentBases, summaries, catalog, modelId] = await Promise.all([
    listAgentContextFiles(actor, agent.id),
    listAgentKnowledgeBases(actor, agent.id),
    can(actor, PERMISSIONS.knowledge.view) ? listKnowledgeBases(actor) : Promise.resolve(null),
    getCachedModelCatalog(),
    agent.model ? Promise.resolve(agent.model) : resolveDefaultModels().then((models) => models.chat),
  ]);

  const selectedIds = new Set(agentBases.selected.map((base) => base.id));
  const all: AgentBaseRow[] = summaries
    ? summaries.map((base) => ({
        id: base.id,
        name: base.name,
        description: base.description,
        state: base.state,
        documentCount: base.documentCount,
        selected: selectedIds.has(base.id),
      }))
    : agentBases.available.map((base) => ({ id: base.id, name: base.name, description: null, state: null, documentCount: null, selected: selectedIds.has(base.id) }));

  const price = findModel(catalog?.models, modelId)?.pricePromptPerM ?? null;
  return {
    contextFiles,
    bases: options.canManage ? all : all.filter((base) => base.selected),
    selectedCount: selectedIds.size,
    cost: { modelId, perMessage: costPerMessage(contextFiles.budget.totalTokens, price) },
  };
}
