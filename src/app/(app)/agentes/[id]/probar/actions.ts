"use server";
// «Probar agente» ([PRU-01]–[PRU-03], [PRU-07]): one turn of the agent with its saved configuration and no real
// channel. Stateless: the browser sends the transcript and it is checked again here; the only thing stored is the
// ai_runs row marked as a test, so nothing reaches the inbox or the reports ([PRU-05], [INF-08]). Owner, admin and
// supervisor ([PER-01]); every message counts against the per-person AI limit ([SEG-07]).
import { getAgentForTesting } from "@/data/agents";
import { listAgentKnowledgeBases } from "@/data/knowledge";
import { isAiConfigured } from "@/data/settings";
import { fail, fromZodError, type ActionFailure } from "@/lib/action-result";
import { manualRetryMessage } from "@/lib/openrouter/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { AgentRunError, AiNotConfiguredError } from "@/server/ai/errors";
import { enforceAiRateLimit } from "@/server/ai/limits";
import { runAgent } from "@/server/ai/run-agent";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { INVALID_TEST_MESSAGE, testChatInputSchema } from "./_lib/input";
import { toTestReply, type TestReply } from "./_lib/reply";

/** ai_not_configured: no OpenRouter key ([ARR-14]); ai_failed: OpenRouter or the run failed (Spanish message). */
export type TestChatFailure = ActionFailure & { reason?: "ai_not_configured" | "ai_failed" };
export type TestChatResult = { ok: true; data: TestReply } | TestChatFailure;

function aiNotConfigured(): TestChatFailure {
  return { ...fail(new AiNotConfiguredError().userMessage), reason: "ai_not_configured" };
}

/** Sends the tester's new message (last of `input.messages`) and returns the agent's one reply with its details. */
export async function sendTestMessageAction(input: unknown): Promise<TestChatResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agents.test);
    const parsed = testChatInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error, INVALID_TEST_MESSAGE);
    const { agentId, channel, messages } = parsed.data;
    const agent = await getAgentForTesting(actor, agentId);
    // Without a key the agent does not answer, and the attempt does not use up the person's limit ([PRU-07]).
    if (!(await isAiConfigured())) return aiNotConfigured();
    await enforceAiRateLimit("test", actor.userId);
    const result = await runAgent({
      agent,
      history: messages.map(({ role, text }) => ({ role, text })),
      mode: "test",
      simulateChannel: channel,
    });
    // The base of each fragment, by name ([PRU-02]); read only when the reply used any.
    const bases = result.retrievals.length > 0 ? (await listAgentKnowledgeBases(actor, agentId)).available : [];
    return { ok: true, data: toTestReply(result, channel, new Map(bases.map((base) => [base.id, base.name]))) };
  } catch (error) {
    // The key was removed while testing.
    if (error instanceof AiNotConfiguredError) return aiNotConfigured();
    // Recorded in ai_runs by runAgent; the message is generic Spanish, never the key or provider details. Here nothing
    // retries on its own: a transient failure says to press «Reintentar» ([PRU-02]).
    if (error instanceof AgentRunError) return { ...fail(manualRetryMessage(error.reason) ?? error.userMessage), reason: "ai_failed" };
    return toActionFailure(error);
  }
}
