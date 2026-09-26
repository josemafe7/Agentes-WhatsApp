// AI usage log ([MOT-11], [MED-01], [INF-07], [PRU-02]): every call to OpenRouter with the requested and used
// model, provider, tokens, the cost OpenRouter reports (usage.cost, never computed from stored prices), time,
// tools used and a Spanish, secret-free error. «Probar agente» runs are marked is_test and never count in reports.
import "server-only";
import { db, type Executor } from "@/db";
import { aiRuns } from "@/db/schema";
import type { AiRunKind } from "@/lib/enums";
import { safeErrorMessage } from "@/server/redact";

export type AiRunRecord = {
  kind: AiRunKind;
  mode: "test" | "live";
  conversationId?: string | null;
  messageId?: string | null;
  agentId?: string | null;
  modelRequested?: string | null;
  modelUsed?: string | null;
  provider?: string | null;
  generationId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  toolsUsed?: { name: string; ok: boolean }[];
  steps?: number | null;
  /** Spanish, generic message; null when it worked. */
  error?: string | null;
};

const MAX_ERROR_LENGTH = 300;

/** System: stores one AI call and returns its id. */
export async function recordAiRun(record: AiRunRecord, executor: Executor = db): Promise<string> {
  const [row] = await executor
    .insert(aiRuns)
    .values({
      kind: record.kind,
      conversationId: record.conversationId ?? null,
      messageId: record.messageId ?? null,
      agentId: record.agentId ?? null,
      modelRequested: record.modelRequested ?? null,
      modelUsed: record.modelUsed ?? null,
      provider: record.provider ?? null,
      generationId: record.generationId ?? null,
      promptTokens: record.promptTokens ?? null,
      completionTokens: record.completionTokens ?? null,
      reasoningTokens: record.reasoningTokens ?? null,
      cachedTokens: record.cachedTokens ?? null,
      totalTokens: record.totalTokens ?? null,
      costUsd: record.costUsd ?? null,
      latencyMs: record.latencyMs ?? null,
      toolsUsed: record.toolsUsed ?? [],
      steps: record.steps ?? null,
      ok: !record.error,
      // Already a generic Spanish message; redacted and cut anyway, so no key or long payload is ever stored.
      error: record.error ? safeErrorMessage(record.error, MAX_ERROR_LENGTH) : null,
      isTest: record.mode === "test",
    })
    .returning({ id: aiRuns.id });
  return row.id;
}
