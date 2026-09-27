// What «Probar agente» shows of each reply ([PRU-02]): model and provider, tokens, cost, time, tools with their data
// and result, and the knowledge fragments. Only what the screen renders goes to the browser (never the run itself).
import { isSystemToolName, SYSTEM_TOOL_LABELS } from "@/lib/agent-tools";
import type { SimulatedChannel } from "@/server/ai/prompt";
import type { RunAgentResult } from "@/server/ai/run-agent";

/** Tool data and results are shown as text, cut to a readable size. */
const MAX_DETAIL_CHARS = 4_000;

export type TestToolCall = {
  id: string;
  name: string;
  /** Spanish label of the Herramientas tab, or the raw name for an unknown tool the model made up. */
  label: string;
  ok: boolean;
  /** Arguments the model sent (JSON, or the raw text when it was not valid JSON). */
  argumentsText: string;
  resultText: string;
};

export type TestRetrieval = {
  rank: number;
  score: number | null;
  title: string | null;
  section: string | null;
  page: number | null;
  /** Name of the base the fragment comes from; null when it cannot be named (e.g. deleted meanwhile). */
  knowledgeBase: string | null;
};

export type TestReply = {
  text: string;
  /** Channel simulated for this reply ([PRU-03]). */
  channel: SimulatedChannel;
  modelRequested: string;
  modelUsed: string;
  provider: string | null;
  /** The fallback model answered because the primary failed ([MOD-05]). */
  usedFallback: boolean;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number; cachedTokens: number; totalTokens: number };
  /** usage.cost of OpenRouter in USD; null when it sent none. */
  costUsd: number | null;
  latencyMs: number;
  steps: number;
  toolCalls: TestToolCall[];
  /** transferir_a_humano ended the turn: only simulated here. */
  handedOff: boolean;
  retrievals: TestRetrieval[];
};

function detailText(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text;
}

/** `knowledgeBaseNames`: base id → name, so each fragment shows its source without sending ids to the browser. */
export function toTestReply(result: RunAgentResult, channel: SimulatedChannel, knowledgeBaseNames: ReadonlyMap<string, string> = new Map()): TestReply {
  return {
    text: result.text,
    channel,
    modelRequested: result.modelRequested,
    modelUsed: result.modelUsed,
    provider: result.provider,
    usedFallback: result.modelUsed !== result.modelRequested,
    usage: {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      reasoningTokens: result.usage.reasoningTokens,
      cachedTokens: result.usage.cachedTokens,
      totalTokens: result.usage.totalTokens,
    },
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    steps: result.steps,
    toolCalls: result.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      label: isSystemToolName(call.name) ? SYSTEM_TOOL_LABELS[call.name] : call.name,
      ok: call.ok,
      argumentsText: detailText(call.arguments),
      resultText: detailText(call.result),
    })),
    handedOff: result.handedOff,
    retrievals: result.retrievals.map(({ rank, score, title, section, page, kbId }) => ({
      rank,
      score,
      title,
      section,
      page,
      knowledgeBase: kbId ? (knowledgeBaseNames.get(kbId) ?? null) : null,
    })),
  };
}
