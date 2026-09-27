// Token and cost totals of one AI run with several calls (tools steps, a draft retry), as ai_runs stores them
// ([MOT-11]). The cost is always the sum of OpenRouter's usage.cost, never computed from prices.
import "server-only";
import type { ChatUsage } from "@/lib/openrouter/types";

/** Tokens of a run, summed over its calls. */
export type RunUsage = Omit<ChatUsage, "cost" | "cacheWriteTokens">;

export type UsageTotals = { usage: RunUsage; /** Null while OpenRouter sent no cost. */ cost: number | null };

export function emptyUsageTotals(): UsageTotals {
  return { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 }, cost: null };
}

/** Adds one call's usage to the run's totals. */
export function addUsage(totals: UsageTotals, usage: ChatUsage): void {
  totals.usage.promptTokens += usage.promptTokens;
  totals.usage.completionTokens += usage.completionTokens;
  totals.usage.totalTokens += usage.totalTokens;
  totals.usage.cachedTokens += usage.cachedTokens;
  totals.usage.reasoningTokens += usage.reasoningTokens;
  if (usage.cost !== null) totals.cost = (totals.cost ?? 0) + usage.cost;
}
