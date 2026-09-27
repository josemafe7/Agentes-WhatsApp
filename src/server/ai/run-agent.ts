// One turn of an agent ([MOT-05]–[MOT-12], [PRU-01]–[PRU-03]): builds the prompt, calls OpenRouter with the tools
// loop (at most 6 steps), and returns exactly one final text. Every run is recorded in ai_runs with the requested
// and used model, provider, tokens, the cost of usage.cost, time, tools and error. It never sends anything: the
// reply engine (live) or «Probar agente» (test) decides what to do with the text. Never call it inside a webhook.
import "server-only";
import { recordAiRun } from "@/data/ai-runs";
import type { AgentHandoffConfig, AgentInstructions } from "@/db/schema";
import type { AgentKnowledgeMode } from "@/lib/enums";
import { prefetchKnowledge, withSystemSection } from "@/server/knowledge/agent-knowledge";
import { isOpenRouterError } from "@/lib/openrouter/errors";
import { REASONING_EFFORTS, type ChatMessage, type ReasoningEffort } from "@/lib/openrouter/types";
import { isWithinOpeningHours } from "@/lib/opening-hours";
import { loadAgentContextFiles, loadPromptBusinessData } from "./context";
import { AgentRunError } from "./errors";
import { catalogSupport } from "./models";
import { fallbackOfOtherProvider, getOpenRouterClient, isZdrEnabled, resolveDefaultModels, type OpenRouterDeps } from "./openrouter";
import { buildPrompt, type PromptChannelKind, type PromptContact, type PromptHistoryMessage, type SimulatedChannel } from "./prompt";
import { executeToolCall, skipToolCalls, toolDefinitions, toolsForAgent, type ToolCallRecord, type ToolContext } from "./tools";
import { addUsage, emptyUsageTotals, type RunUsage } from "./usage";

/** «hasta 6 pasos de herramientas» ([MOT-08]). */
export const MAX_TOOL_STEPS = 6;
/** Tool calls run from one answer of the model; the rest get a short error (bounds the log and the next request). */
export const MAX_TOOL_CALLS_PER_STEP = 5;
/** Generous default length (docs/integracion-openrouter.md §3.6); the agent can change it ([MOD-07]). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;
/** A refusal inside a valid answer is treated as «no lo sé» with a person offered (§3.8). */
export const REFUSAL_REPLY = "Lo siento, con eso no puedo ayudarte por aquí. Si quieres, te paso con una persona del equipo.";

const STEP_LIMIT_MESSAGE = "La IA no ha podido terminar la respuesta en 6 pasos. La conversación queda para una persona.";

/** The agent settings a run needs (a row of `agents` fits). */
export type AgentRunConfig = {
  id: string;
  name: string;
  language: string;
  tone: string | null;
  instructions: AgentInstructions;
  model: string | null;
  fallbackModel: string | null;
  temperature: number | null;
  reasoningEffort: string | null;
  maxOutputTokens: number | null;
  handoff: AgentHandoffConfig;
  systemTools: string[];
  /** «Automático» (the model searches when needed) or «Buscar siempre» (search before each reply) ([AGE-07]). */
  knowledgeMode?: AgentKnowledgeMode;
};

export type RunAgentContext = {
  /** A row of `conversations` (test conversations included), or null. Also the OpenRouter session. */
  conversationId?: string | null;
  contactId?: string | null;
  channelId?: string | null;
  /** Kind of the real channel; «Probar agente» is always "test". */
  channelKind?: Exclude<PromptChannelKind, "test">;
  contact?: PromptContact | null;
  summary?: string | null;
  /** The channel's AI notice, when it has its own ([CUM-01]). */
  aiDisclosureText?: string | null;
  /** Live replies: the engine puts the AI notice in front of the first reply, so the model must not repeat it. */
  disclosureAddedByPlatform?: boolean;
  /** Messages of `history` the prompt keeps (default DEFAULT_HISTORY_MESSAGES); the rest is in `summary` ([MOT-13]). */
  maxHistoryMessages?: number;
};

export type RunAgentInput = {
  agent: AgentRunConfig;
  /** Oldest first, the new customer message(s) last. */
  history: PromptHistoryMessage[];
  context?: RunAgentContext;
  mode: "test" | "live";
  /** «Simular canal» of «Probar agente» ([PRU-03]). */
  simulateChannel?: SimulatedChannel;
};

export type RunAgentDeps = OpenRouterDeps & { now?: Date; clock?: () => number };

/** A knowledge fragment used in the reply ([PRU-02], [CON-20]); same shape as KnowledgeRetrieval. */
export type AgentRetrieval = {
  chunkId: string | null;
  documentId: string | null;
  kbId: string | null;
  rank: number;
  score: number | null;
  title: string | null;
  section: string | null;
  page: number | null;
};

export type RunAgentUsage = RunUsage;

export type RunAgentResult = {
  runId: string;
  /** The one reply of the turn ([MOT-10]). */
  text: string;
  toolCalls: ToolCallRecord[];
  usage: RunAgentUsage;
  /** Sum of usage.cost of every step; null when OpenRouter sent none. */
  costUsd: number | null;
  latencyMs: number;
  modelRequested: string;
  /** The model that answered (the fallback when the primary failed). */
  modelUsed: string;
  provider: string | null;
  steps: number;
  /** A tool ended the turn with its own reply; today only transferir_a_humano (`text` = hand-off message, [TRA-03]). */
  handedOff: boolean;
  retrievals: AgentRetrieval[];
};

function isEffort(value: string | null): value is ReasoningEffort {
  return value !== null && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * Runs one turn. Throws AiNotConfiguredError without a key (nothing recorded, [PRU-07]) and AgentRunError when no
 * reply could be produced (recorded, [MOT-09], [MOT-12]).
 */
export async function runAgent(input: RunAgentInput, deps: RunAgentDeps = {}): Promise<RunAgentResult> {
  const client = await getOpenRouterClient(deps);
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const now = deps.now ?? new Date();
  const { agent, mode } = input;
  const context = input.context ?? {};

  const [defaults, zdr, businessData, contextFiles] = await Promise.all([
    resolveDefaultModels(),
    isZdrEnabled(),
    loadPromptBusinessData(),
    loadAgentContextFiles(agent.id),
  ]);
  const model = agent.model || defaults.chat;
  const fallbackModel = fallbackOfOtherProvider(model, agent.fallbackModel || defaults.fallback);
  const support = await catalogSupport(client, model);

  const prompt = buildPrompt({
    ...businessData,
    agent: { name: agent.name, language: agent.language, tone: agent.tone, instructions: agent.instructions },
    contextFiles,
    channel: mode === "test" ? { kind: "test", simulated: input.simulateChannel } : { kind: context.channelKind ?? "webchat" },
    contact: context.contact ?? null,
    summary: context.summary ?? null,
    history: input.history,
    maxHistoryMessages: context.maxHistoryMessages,
    now,
    aiDisclosureText: context.aiDisclosureText ?? businessData.aiDisclosureText,
    disclosureAddedByPlatform: context.disclosureAddedByPlatform,
  });

  const tools = toolsForAgent(agent.systemTools);
  const retrievals: AgentRetrieval[] = [];
  const toolContext: ToolContext = {
    mode,
    agentId: agent.id,
    conversationId: context.conversationId ?? null,
    contactId: context.contactId ?? null,
    channelId: context.channelId ?? null,
    now,
    timezone: businessData.timezone,
    withinBusinessHours: isWithinOpeningHours(now, businessData.timezone, businessData.hours, businessData.closures),
    handoff: agent.handoff,
    retrievals,
    ai: { client },
  };

  let messages: ChatMessage[] = [...prompt.messages];
  const records: ToolCallRecord[] = [];
  // «Buscar siempre»: the knowledge is searched before the model and goes into the prompt ([AGE-07]).
  if (agent.knowledgeMode === "always") {
    const prefetch = await prefetchKnowledge(input.history, { agentId: agent.id, mode, conversationId: toolContext.conversationId, retrievals, ai: { client } });
    if (prefetch) {
      messages = withSystemSection(messages, prefetch.systemSection);
      records.push(prefetch.record);
    }
  }
  const totals = emptyUsageTotals();
  let modelUsed = model;
  let provider: string | null = null;
  let generationId: string | null = null;
  let steps = 0;
  let text: string | null = null;
  let handedOff = false;

  let latencyMs = 0;
  const record = (error: string | null) => {
    // One measurement for the log and the result.
    latencyMs = clock() - started;
    return recordAiRun({
      kind: "chat",
      mode,
      conversationId: context.conversationId ?? null,
      agentId: agent.id,
      modelRequested: model,
      modelUsed: steps > 0 ? modelUsed : null,
      provider,
      generationId,
      promptTokens: totals.usage.promptTokens,
      completionTokens: totals.usage.completionTokens,
      reasoningTokens: totals.usage.reasoningTokens,
      cachedTokens: totals.usage.cachedTokens,
      totalTokens: totals.usage.totalTokens,
      costUsd: totals.cost,
      latencyMs,
      toolsUsed: records.map((call) => ({ name: call.name, ok: call.ok })),
      steps,
      error,
    });
  };

  try {
    while (text === null) {
      if (steps >= MAX_TOOL_STEPS) break;
      steps += 1;
      const response = await client.chat({
        model,
        fallbackModel,
        messages,
        tools: tools.size > 0 ? toolDefinitions(tools) : undefined,
        zdr,
        reasoningEffort: isEffort(agent.reasoningEffort) ? agent.reasoningEffort : null,
        support,
        maxTokens: agent.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        temperature: agent.temperature,
        sessionId: context.conversationId ?? `prueba-${agent.id}`,
      });
      addUsage(totals, response.usage);
      modelUsed = response.model;
      provider = response.provider ?? provider;
      generationId = response.id;

      if (response.toolCalls.length === 0) {
        text = response.content?.trim() || (response.refusal ? REFUSAL_REPLY : null);
        if (text === null) throw new AgentRunError("empty_response", "El modelo ha devuelto una respuesta vacía.", true, null);
        break;
      }
      // Tools asked on the last step would run with no step left to answer: nothing half-done is sent ([MOT-09]).
      if (steps >= MAX_TOOL_STEPS) break;
      messages.push(response.assistantMessage);
      let reply: string | undefined;
      const allowed = response.toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP);
      for (const [index, call] of allowed.entries()) {
        const outcome = await executeToolCall(tools, call, toolContext);
        records.push(outcome.record);
        messages.push(outcome.message);
        if (outcome.reply) {
          // The turn ends with the hand-off: nothing else of this answer runs ([MOT-10]).
          reply = outcome.reply;
          messages.push(...(await skipToolCalls(response.toolCalls.slice(index + 1), "handed_off", toolContext)));
          break;
        }
      }
      if (!reply) messages.push(...(await skipToolCalls(response.toolCalls.slice(MAX_TOOL_CALLS_PER_STEP), "too_many", toolContext)));
      if (reply) {
        text = reply;
        handedOff = true;
      }
    }
  } catch (error) {
    const known = isOpenRouterError(error) ? { reason: error.code, message: error.userMessage, retryable: error.retryable } : null;
    const own = error instanceof AgentRunError ? { reason: error.reason, message: error.userMessage, retryable: error.retryable } : null;
    const failure = known ?? own;
    if (!failure) {
      await record("La IA ha fallado por un error inesperado.");
      throw error;
    }
    const runId = await record(failure.message);
    throw new AgentRunError(failure.reason, failure.message, failure.retryable, runId);
  }

  if (text === null) {
    const runId = await record(STEP_LIMIT_MESSAGE);
    throw new AgentRunError("step_limit", STEP_LIMIT_MESSAGE, false, runId);
  }

  const runId = await record(null);
  return {
    runId,
    text,
    toolCalls: records,
    usage: totals.usage,
    costUsd: totals.cost,
    latencyMs,
    modelRequested: model,
    modelUsed,
    provider,
    steps,
    handedOff,
    retrievals,
  };
}
