// Shape of an agent tool ([HER-01]–[HER-04]). Tools act only on the conversation's contact and channel ([PER-08]):
// everything they may touch comes in the context, never from the model's arguments.
import "server-only";
import type { z } from "zod";
import type { AgentHandoffConfig } from "@/db/schema";
import type { KnowledgeRetrieval } from "@/server/knowledge/types";
import type { OpenRouterDeps } from "../openrouter";

export type ToolMode = "test" | "live";

export type ToolContext = {
  /** test = «Probar agente»: nothing real changes (bookings are marked «Prueba», hand-offs are simulated). */
  mode: ToolMode;
  agentId: string;
  conversationId: string | null;
  /** The only contact a tool may read or change ([HER-04]). */
  contactId: string | null;
  channelId: string | null;
  now: Date;
  timezone: string;
  /** Inside opening hours now (business time zone, closures included): picks the hand-off message ([TRA-03]). */
  withinBusinessHours: boolean;
  /** The agent's hand-off settings ([AGE-09]). */
  handoff: AgentHandoffConfig;
  /** Knowledge fragments used in this answer, filled by buscar_conocimiento ([CON-20], [PRU-02]); runAgent returns them. */
  retrievals?: KnowledgeRetrieval[];
  /** The run's OpenRouter client (or the fake fetch of a test), for tools that call the AI (query embeddings). */
  ai?: OpenRouterDeps;
};

export type ToolOutput = {
  /** Compact JSON for the model ([HER-03]). */
  result: Record<string, unknown>;
  /**
   * Ends the turn with this reply instead of asking the model again (e.g. the hand-off message of [TRA-03]); the
   * reply engine sends it as the one reply of the turn ([MOT-10]).
   */
  reply?: string;
};

export type AgentTool<S extends z.ZodType = z.ZodType> = {
  /** letters, digits, _ and -, at most 64 characters (docs/integracion-openrouter.md §3.3). */
  name: string;
  /** What the model reads to decide when to use it. Spanish. */
  description: string;
  /** Validated before execute ([HER-02]); also the JSON Schema the model sees. */
  parameters: S;
  /** Longest result sent back to the model; default MAX_TOOL_RESULT_CHARS (the knowledge search needs ~3,500 tokens, [CON-19]). */
  maxResultChars?: number;
  execute(args: z.output<S>, context: ToolContext): Promise<ToolOutput>;
};

export type RegisteredTool = AgentTool & {
  /** JSON Schema of `parameters` (z.toJSONSchema), computed once. */
  jsonSchema: Record<string, unknown>;
};

/** One call as «Probar agente» shows it ([PRU-02]): name, arguments, result and whether it worked. */
export type ToolCallRecord = {
  id: string;
  name: string;
  /** Parsed arguments (the raw text when it was not valid JSON). */
  arguments: unknown;
  ok: boolean;
  result: Record<string, unknown>;
};
