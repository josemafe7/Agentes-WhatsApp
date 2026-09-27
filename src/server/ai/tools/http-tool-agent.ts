// The custom HTTP tools of an agent ([HER-11], [AGE-08]): each one a registered tool whose Zod parameters are validated
// before anything is called ([HER-02]), run by ./http-tool.ts, with one activity-log entry per call (tool, agent,
// conversation, status and time), never the arguments, the answer or the secrets ([HER-03], [SEG-10]). The secret
// headers are decrypted only for the call itself.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/data/audit";
import { db } from "@/db";
import { agentCustomTools, customTools } from "@/db/schema";
import { isSystemToolName } from "@/lib/agent-tools";
import type { HttpMethod } from "@/lib/enums";
import { tryDecryptSecret } from "@/server/crypto";
import { executeHttpTool, httpToolErrorMessage, toolResultForModel, type HttpToolDeps, type HttpToolOutcome } from "./http-tool";
import { HTTP_TOOL_LIMITS, HTTP_TOOL_NAME_PATTERN, httpToolArgumentsSchema, parametersFromJsonSchema, templateOrigin, type HttpToolParameter } from "./http-tool-definition";
import { defineTool } from "./registry";
import type { RegisteredTool } from "./types";

/** A row of custom_tools, with its parameters read back. */
export type StoredHttpTool = {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  timeoutMs: number;
  parameters: HttpToolParameter[];
  /** Encrypted JSON object name → value ([HER-12]). */
  secretHeadersEnc: string | null;
};

const secretHeadersSchema = z.record(z.string(), z.string());

/** The secret headers of a stored tool (name → value); null when they cannot be read (the key changed, [SEG-03]). */
export function readSecretHeaders(stored: string | null): Record<string, string> | null {
  if (!stored) return {};
  const text = tryDecryptSecret(stored);
  if (text === null) return null;
  try {
    const parsed = secretHeadersSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function boundedTimeout(timeoutMs: number): number {
  return Math.min(Math.max(timeoutMs, HTTP_TOOL_LIMITS.timeoutMinSeconds * 1000), HTTP_TOOL_LIMITS.timeoutMaxSeconds * 1000);
}

/** The one way a stored tool runs (agents and «Probar»): headers decrypted just for the call. Never throws. */
export async function runStoredHttpTool(tool: StoredHttpTool, args: Record<string, unknown>, deps: HttpToolDeps = {}): Promise<HttpToolOutcome> {
  const headers = readSecretHeaders(tool.secretHeadersEnc);
  if (headers === null) {
    return { ok: false, status: null, durationMs: 0, error: { code: "secrets_unreadable", message: httpToolErrorMessage("secrets_unreadable") }, data: null, truncated: false };
  }
  const target = { name: tool.name, method: tool.method, url: tool.url, timeoutMs: boundedTimeout(tool.timeoutMs), parameters: tool.parameters, headers };
  return executeHttpTool(target, args, deps);
}

/** The server of a tool's address, for the log; never its path or query (they may carry the customer's data). */
export function httpToolHost(url: string): string | null {
  return templateOrigin(url)?.host ?? null;
}

/** What the activity log keeps of one call ([HER-03]): no arguments, no answer, no secrets. */
export function httpToolAuditDetails(tool: Pick<StoredHttpTool, "id" | "name" | "method" | "url">, outcome: HttpToolOutcome): Record<string, string | number | boolean | null> {
  return {
    tool: tool.name,
    toolId: tool.id,
    method: tool.method,
    host: httpToolHost(tool.url),
    status: outcome.status,
    durationMs: outcome.durationMs,
    ok: outcome.ok,
    ...(outcome.error ? { error: outcome.error.code } : {}),
  };
}

/** A stored tool as one of the agent's tools: the model sees its description and the JSON Schema of its parameters. */
export function createHttpAgentTool(tool: StoredHttpTool, deps: HttpToolDeps = {}): RegisteredTool {
  return defineTool({
    name: tool.name,
    description: tool.description,
    parameters: httpToolArgumentsSchema(tool.parameters),
    async execute(args, context) {
      const outcome = await runStoredHttpTool(tool, args, deps);
      await writeAudit({
        actor: "ai",
        action: "ai.http_tool_called",
        targetType: context.conversationId ? "conversation" : "agent",
        targetId: context.conversationId ?? context.agentId,
        metadata: { ...httpToolAuditDetails(tool, outcome), agentId: context.agentId, mode: context.mode },
      });
      return { result: toolResultForModel(outcome) };
    },
  });
}

/**
 * The custom HTTP tools attached to an agent, for runAgent ([AGE-08]), in «Probar agente» too. A row this app did not
 * write (or named like a system tool) is left out and logged, never offered.
 */
export async function loadAgentHttpTools(agentId: string, deps: HttpToolDeps = {}): Promise<RegisteredTool[]> {
  const rows = await db
    .select({
      id: customTools.id,
      name: customTools.name,
      description: customTools.description,
      method: customTools.method,
      url: customTools.url,
      timeoutMs: customTools.timeoutMs,
      parameters: customTools.parameters,
      secretHeadersEnc: customTools.secretHeadersEnc,
    })
    .from(agentCustomTools)
    .innerJoin(customTools, eq(customTools.id, agentCustomTools.customToolId))
    .where(and(eq(agentCustomTools.agentId, agentId), eq(customTools.enabled, true)))
    .orderBy(asc(customTools.name));
  const tools: RegisteredTool[] = [];
  for (const row of rows) {
    const parameters = parametersFromJsonSchema(row.parameters);
    const validName = row.name.length <= HTTP_TOOL_LIMITS.nameMax && HTTP_TOOL_NAME_PATTERN.test(row.name) && !isSystemToolName(row.name);
    if (!parameters || !validName) {
      console.error(`[ai] La herramienta HTTP ${row.id} no es válida y no se ofrece al agente.`);
      continue;
    }
    tools.push(createHttpAgentTool({ ...row, parameters }, deps));
  }
  return tools;
}
