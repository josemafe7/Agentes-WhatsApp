// The system tools that already work, and which of them an agent gets ([AGE-08], [HER-10]). Each later phase adds
// its tool module to IMPLEMENTED (buscar_conocimiento in phase 4, the booking tools in phase 5…).
import "server-only";
import { ALWAYS_ENABLED_TOOLS, isSystemToolName, type SystemToolName } from "@/lib/agent-tools";
import { buscarConocimiento } from "./buscar-conocimiento";
import { toToolDefinition } from "./registry";
import { transferirAHumano } from "./transferir-a-humano";
import type { RegisteredTool } from "./types";

export {
  defineTool,
  executeToolCall,
  MAX_TOOL_RESULT_CHARS,
  skipToolCalls,
  toToolDefinition,
  UNKNOWN_TOOL_NAME,
  type SkippedToolCallsReason,
  type ToolCallOutcome,
} from "./registry";
export type { AgentTool, RegisteredTool, ToolCallRecord, ToolContext, ToolMode, ToolOutput } from "./types";

const IMPLEMENTED: readonly RegisteredTool[] = [transferirAHumano, buscarConocimiento];

const BY_NAME: ReadonlyMap<string, RegisteredTool> = new Map(IMPLEMENTED.map((tool) => [tool.name, tool]));

/** Names of the system tools that work today (the rest show «Próximamente» in the editor). */
export function implementedSystemTools(): SystemToolName[] {
  return IMPLEMENTED.map((tool) => tool.name).filter(isSystemToolName);
}

/** Tools an agent can use: the implemented ones it has enabled, plus those always on (the hand-off). */
export function toolsForAgent(enabled: readonly string[]): Map<string, RegisteredTool> {
  const wanted = new Set<string>([...enabled, ...ALWAYS_ENABLED_TOOLS]);
  return new Map([...BY_NAME].filter(([name]) => wanted.has(name)));
}

/** The `tools` field of the chat request. */
export function toolDefinitions(tools: ReadonlyMap<string, RegisteredTool>) {
  return [...tools.values()].map(toToolDefinition);
}
