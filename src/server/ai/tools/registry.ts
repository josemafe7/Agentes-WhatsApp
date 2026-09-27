// Tool plumbing ([HER-02], [HER-03]): Zod schema → JSON Schema for the model, arguments validated before anything
// runs, short results, and every call in the activity log with actor «ai» (tool name and outcome, no arguments:
// they may carry personal data).
import "server-only";
import { z } from "zod";
import { writeAudit } from "@/data/audit";
import type { ToolCall, ToolDefinition, ToolMessage } from "@/lib/openrouter/types";
import { AppError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import type { AgentTool, RegisteredTool, ToolCallRecord, ToolContext } from "./types";

/** Results stay short: they are sent back to the model on every step ([HER-03]). */
export const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_ISSUES_SHOWN = 3;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** How a call to a tool the agent does not have is recorded; what the model wrote is kept apart, cut short. */
export const UNKNOWN_TOOL_NAME = "desconocida";
const MAX_REQUESTED_NAME_CHARS = 64;

const MESSAGES = {
  unavailable: "Esta herramienta no está disponible para este agente.",
  invalidJson: "Los datos de la herramienta no son JSON válido.",
  invalidArgs: "Datos no válidos",
  failed: "La herramienta ha fallado. Inténtalo de otra forma o pasa con una persona.",
} as const;

/** Declares a tool: its Zod parameters become the JSON Schema the model sees (z.toJSONSchema). */
export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): RegisteredTool {
  if (!TOOL_NAME_PATTERN.test(tool.name)) throw new Error(`Invalid tool name: ${tool.name}`);
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(tool.parameters, { io: "input" }) };
  // The dialect marker is not part of the tool's parameters.
  delete jsonSchema.$schema;
  return { ...(tool as unknown as AgentTool), jsonSchema };
}

export function toToolDefinition(tool: RegisteredTool): ToolDefinition {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.jsonSchema } };
}

function issuesText(error: z.ZodError): string {
  const issues = error.issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message));
  return `${MESSAGES.invalidArgs}: ${issues.join("; ")}`;
}

function parseArguments(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text || "{}") as unknown };
  } catch {
    return { ok: false };
  }
}

export type ToolCallOutcome = {
  record: ToolCallRecord;
  /** The `tool` message for the next request of the loop. */
  message: ToolMessage;
  /** Set when the tool ends the turn with a fixed reply. */
  reply?: string;
};

function toolMessage(callId: string, result: Record<string, unknown>, maxChars: number = MAX_TOOL_RESULT_CHARS): ToolMessage {
  const text = JSON.stringify(result);
  return { role: "tool", tool_call_id: callId, content: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text };
}

/**
 * Runs one call of the model: unknown or disabled tools, bad JSON and invalid arguments return a short error to the
 * model and change nothing ([HER-02]); errors never reach the model with internal details. Always audited.
 */
export async function executeToolCall(
  tools: ReadonlyMap<string, RegisteredTool>,
  call: ToolCall,
  context: ToolContext,
): Promise<ToolCallOutcome> {
  const requested = call.function.name;
  const tool = tools.get(requested);
  // The model's text is data: a name that is not one of the agent's tools is recorded as «desconocida».
  const name = tool ? tool.name : UNKNOWN_TOOL_NAME;
  const parsed = parseArguments(call.function.arguments);
  const args = parsed.ok ? parsed.value : call.function.arguments;
  let result: Record<string, unknown>;
  let reply: string | undefined;
  let errorCode: string | undefined;

  if (!tool) {
    result = { ok: false, error: MESSAGES.unavailable };
    errorCode = "unavailable";
  } else if (!parsed.ok) {
    result = { ok: false, error: MESSAGES.invalidJson };
    errorCode = "invalid_json";
  } else {
    const validated = tool.parameters.safeParse(parsed.value);
    if (!validated.success) {
      result = { ok: false, error: issuesText(validated.error) };
      errorCode = "invalid_arguments";
    } else {
      try {
        const output = await tool.execute(validated.data, context);
        result = output.result;
        reply = output.reply;
      } catch (error) {
        const expected = error instanceof AppError;
        result = { ok: false, error: expected ? error.userMessage : MESSAGES.failed };
        errorCode = expected ? error.code : "failed";
        if (!expected) console.error(`[ai] La herramienta ${name} ha fallado: ${safeErrorMessage(error)}`);
      }
    }
  }

  const ok = result.ok !== false;
  await writeAudit({
    actor: "ai",
    action: "ai.tool_called",
    targetType: context.conversationId ? "conversation" : "agent",
    targetId: context.conversationId ?? context.agentId,
    metadata: {
      tool: name,
      ...(tool ? {} : { requested: requested.slice(0, MAX_REQUESTED_NAME_CHARS) }),
      ok,
      mode: context.mode,
      agentId: context.agentId,
      ...(errorCode ? { error: errorCode } : {}),
    },
  });

  return {
    record: { id: call.id, name, arguments: args, ok, result },
    message: toolMessage(call.id, result, tool?.maxResultChars),
    ...(ok && reply ? { reply } : {}),
  };
}

/** Why calls of one answer are not run: too many at once, or the conversation was already handed to a person. */
export type SkippedToolCallsReason = "too_many" | "handed_off";

const SKIPPED_MESSAGES: Record<SkippedToolCallsReason, string> = {
  too_many: "No ejecutada: demasiadas herramientas en una sola respuesta.",
  handed_off: "No ejecutada: la conversación ya ha pasado a una persona.",
};

/**
 * Calls of one answer that are not run: each gets a short error for the model (every call needs its answer) and
 * one activity-log entry covers them all, so a misbehaving model cannot fill the log ([HER-03], [SEG-10]).
 */
export async function skipToolCalls(calls: readonly ToolCall[], reason: SkippedToolCallsReason, context: ToolContext): Promise<ToolMessage[]> {
  if (calls.length === 0) return [];
  await writeAudit({
    actor: "ai",
    action: "ai.tool_calls_skipped",
    targetType: context.conversationId ? "conversation" : "agent",
    targetId: context.conversationId ?? context.agentId,
    metadata: { reason, count: calls.length, mode: context.mode, agentId: context.agentId },
  });
  return calls.map((call) => toolMessage(call.id, { ok: false, error: SKIPPED_MESSAGES[reason] }));
}
