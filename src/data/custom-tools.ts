// Custom HTTP tools ([HER-11]–[HER-14], [AGE-08]): list, create, edit, delete, «Probar» and which agents use each one.
// Only owner and admin ([PER-01], spec «Agentes: herramientas HTTP personalizadas»). The secret headers are encrypted
// before they touch the database and only ever come back masked («••••1234», [PER-07]); a saved value is sent only to
// the address it was saved for: any change of the address needs it typed again (docs/security.md «Secretos del
// negocio»). Deleting deletes the agents' links first (nothing relies on cascades).
import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db, isUniqueViolation } from "@/db";
import { agentCustomTools, agents, customTools } from "@/db/schema";
import type { HttpMethod } from "@/lib/enums";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter, type RateLimiter } from "@/server/adapters/rate-limiter";
import { allowsLocalHttpTools, serverProblem, type HttpToolDeps } from "@/server/ai/tools/http-tool";
import { httpToolAuditDetails, readSecretHeaders, runStoredHttpTool, type StoredHttpTool } from "@/server/ai/tools/http-tool-agent";
import {
  httpToolArgumentsSchema,
  httpToolInputSchema,
  parametersFromJsonSchema,
  parametersToJsonSchema,
  templateOrigin,
  urlTemplateProblems,
  type HttpToolInput,
  type HttpToolParameter,
} from "@/server/ai/tools/http-tool-definition";
import { encryptSecret, maskSecret } from "@/server/crypto";
import { ConflictError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

const NOT_FOUND = "No se ha encontrado la herramienta.";
const AGENT_NOT_FOUND = "No se ha encontrado el agente.";
const NAME_TAKEN = "Ya hay una herramienta con ese nombre.";
const VALUE_MISSING = "Escribe el valor de la cabecera.";
const VALUE_AGAIN = "Has cambiado la dirección: vuelve a escribir el valor de esta cabecera.";
const VALUE_UNREADABLE = "El valor guardado no se puede leer (ha cambiado la clave de cifrado): vuelve a escribirlo.";
/** «Probar» calls an outside service: per person and minute ([SEG-07]). */
export const HTTP_TOOL_TEST_LIMIT = 20;
const TEST_WINDOW_MS = 60_000;
const TEST_LIMITED = "Has probado muchas veces seguidas. Espera un minuto y vuelve a intentarlo.";

export type CustomToolAgentRef = { id: string; name: string };
export type CustomToolHeaderView = { name: string; /** «••••1234», never the value. */ masked: string };

export type CustomToolSummary = {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  host: string | null;
  parameterCount: number;
  headerNames: string[];
  /** False when the saved headers cannot be read (the encryption key changed) ([SEG-03]). */
  headersReadable: boolean;
  /** Agents that use it ([AGE-08]). */
  agents: CustomToolAgentRef[];
  updatedAt: Date;
};

export type CustomToolDetail = {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  timeoutSeconds: number;
  parameters: HttpToolParameter[];
  headers: CustomToolHeaderView[];
  headersReadable: boolean;
  agents: CustomToolAgentRef[];
  /** Changes on every save: the form is re-created with what was saved (the new masks). */
  updatedAt: Date;
};

export type CustomToolTestResult = {
  ok: boolean;
  status: number | null;
  durationMs: number;
  /** Spanish explanation when it failed. */
  error: string | null;
  /** The answer, compact, cut short and without the secret headers (JSON pretty-printed). */
  response: string | null;
  truncated: boolean;
};

type ToolRow = typeof customTools.$inferSelect;

// ─── Reading ────────────────────────────────────────────────────────────────────────────────────────────

async function loadTool(toolId: unknown): Promise<ToolRow> {
  const id = idSchema.safeParse(toolId);
  if (!id.success) throw new NotFoundError(NOT_FOUND);
  const [row] = await db.select().from(customTools).where(eq(customTools.id, id.data));
  if (!row) throw new NotFoundError(NOT_FOUND);
  return row;
}

async function agentsByTool(toolIds: readonly string[]): Promise<Map<string, CustomToolAgentRef[]>> {
  const byTool = new Map<string, CustomToolAgentRef[]>();
  if (toolIds.length === 0) return byTool;
  const rows = await db
    .select({ toolId: agentCustomTools.customToolId, id: agents.id, name: agents.name })
    .from(agentCustomTools)
    .innerJoin(agents, eq(agents.id, agentCustomTools.agentId))
    .where(inArray(agentCustomTools.customToolId, [...toolIds]))
    .orderBy(asc(agents.name));
  for (const row of rows) {
    const list = byTool.get(row.toolId) ?? [];
    list.push({ id: row.id, name: row.name });
    byTool.set(row.toolId, list);
  }
  return byTool;
}

function storedTool(row: ToolRow): StoredHttpTool {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    method: row.method,
    url: row.url,
    timeoutMs: row.timeoutMs,
    parameters: parametersFromJsonSchema(row.parameters) ?? [],
    secretHeadersEnc: row.secretHeadersEnc,
  };
}

/** Herramientas HTTP: every tool with the agents that use it. */
export async function listCustomTools(actor: Actor): Promise<CustomToolSummary[]> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const rows = await db.select().from(customTools).orderBy(asc(customTools.name));
  const users = await agentsByTool(rows.map((row) => row.id));
  return rows.map((row) => {
    const headers = readSecretHeaders(row.secretHeadersEnc);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      method: row.method,
      url: row.url,
      host: templateOrigin(row.url)?.host ?? null,
      parameterCount: parametersFromJsonSchema(row.parameters)?.length ?? 0,
      headerNames: headers ? Object.keys(headers) : [],
      headersReadable: headers !== null,
      agents: users.get(row.id) ?? [],
      updatedAt: row.updatedAt,
    };
  });
}

/** One tool for its form: the secret headers only masked ([PER-07]). */
export async function getCustomTool(actor: Actor, toolId: unknown): Promise<CustomToolDetail> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const row = await loadTool(toolId);
  const headers = readSecretHeaders(row.secretHeadersEnc);
  const users = await agentsByTool([row.id]);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    method: row.method,
    url: row.url,
    timeoutSeconds: Math.round(row.timeoutMs / 1000),
    parameters: parametersFromJsonSchema(row.parameters) ?? [],
    headers: Object.entries(headers ?? {}).map(([name, value]) => ({ name, masked: maskSecret(value) })),
    headersReadable: headers !== null,
    agents: users.get(row.id) ?? [],
    updatedAt: row.updatedAt,
  };
}

// ─── Saving ─────────────────────────────────────────────────────────────────────────────────────────────

/** Zod errors keyed by their full path («parameters.0.name»), so each shows next to its row. */
function parseToolInput(input: unknown): HttpToolInput {
  const result = httpToolInputSchema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(undefined, fieldErrors);
}

/** The address rules that need the server's settings: https outside local development and a public server ([HER-14]). */
function assertValidAddress(data: HttpToolInput): void {
  const allowLocal = allowsLocalHttpTools();
  const problems = urlTemplateProblems(data.url, data.parameters, { allowLocal });
  const server = problems.length === 0 ? serverProblem(data.url, allowLocal) : null;
  if (server) problems.push(server);
  if (problems.length > 0) throw new ValidationError(undefined, { url: problems });
}

async function assertNameFree(name: string, exceptId: string | null): Promise<void> {
  const [taken] = await db
    .select({ id: customTools.id })
    .from(customTools)
    .where(exceptId ? and(eq(customTools.name, name), ne(customTools.id, exceptId)) : eq(customTools.name, name));
  if (taken) throw new ValidationError(undefined, { name: [NAME_TAKEN] });
}

/**
 * The secret headers to save: a new value replaces; a row without one keeps the saved value it points to (`keep`),
 * only if the address stays exactly the same and the saved value can be read ([HER-12], [SEG-03]). Any change of the
 * address (scheme, server, port, path or query) needs the value typed again: on a shared server another path may be
 * someone else's endpoint.
 */
function nextSecretHeaders(data: HttpToolInput, current: { url: string; secretHeadersEnc: string | null } | null): Record<string, string> {
  const saved = current ? readSecretHeaders(current.secretHeadersEnc) : {};
  const sameAddress = current !== null && current.url === data.url;
  const next: Record<string, string> = {};
  const errors: Record<string, string[]> = {};
  data.headers.forEach((header, index) => {
    if (header.value) {
      next[header.name] = header.value;
      return;
    }
    const key = `headers.${index}.value`;
    if (!current || header.keep === undefined) {
      errors[key] = [VALUE_MISSING];
      return;
    }
    if (saved === null) {
      errors[key] = [VALUE_UNREADABLE];
      return;
    }
    const kept = saved[header.keep];
    if (kept === undefined) errors[key] = [VALUE_MISSING];
    else if (!sameAddress) errors[key] = [VALUE_AGAIN];
    else next[header.name] = kept;
  });
  if (Object.keys(errors).length > 0) throw new ValidationError(undefined, errors);
  return next;
}

function rowValues(data: HttpToolInput, headers: Record<string, string>) {
  return {
    name: data.name,
    description: data.description,
    parameters: parametersToJsonSchema(data.parameters),
    method: data.method,
    url: data.url,
    timeoutMs: data.timeoutSeconds * 1000,
    secretHeadersEnc: Object.keys(headers).length > 0 ? encryptSecret(JSON.stringify(headers)) : null,
  };
}

/** What the log keeps of a saved tool: never the headers' values, the address' path or the descriptions. */
function auditOf(data: HttpToolInput): Record<string, string | number | null> {
  return { name: data.name, method: data.method, host: templateOrigin(data.url)?.host ?? null, parameters: data.parameters.length, headers: data.headers.length };
}

/** «Nueva herramienta» ([HER-11]). */
export async function createCustomTool(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const data = parseToolInput(input);
  assertValidAddress(data);
  const headers = nextSecretHeaders(data, null);
  await assertNameFree(data.name, null);
  try {
    const [row] = await db.insert(customTools).values(rowValues(data, headers)).returning({ id: customTools.id });
    await writeAudit({ actor, action: "custom_tool.created", targetType: "custom_tool", targetId: row.id, metadata: auditOf(data) });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError(undefined, { name: [NAME_TAKEN] });
    throw error;
  }
}

/** Saves the form of a tool ([HER-11], [HER-12]). */
export async function updateCustomTool(actor: Actor, toolId: unknown, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const current = await loadTool(toolId);
  const data = parseToolInput(input);
  assertValidAddress(data);
  const headers = nextSecretHeaders(data, current);
  await assertNameFree(data.name, current.id);
  try {
    await db
      .update(customTools)
      .set({ ...rowValues(data, headers), updatedAt: new Date() })
      .where(eq(customTools.id, current.id));
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError(undefined, { name: [NAME_TAKEN] });
    throw error;
  }
  const retyped = data.headers.filter((header) => Boolean(header.value)).length;
  await writeAudit({ actor, action: "custom_tool.updated", targetType: "custom_tool", targetId: current.id, metadata: { ...auditOf(data), headersRetyped: retyped } });
}

/**
 * Deletes a tool. While agents use it, it is refused unless `confirmInUse` says the person saw which ones: they stop
 * having it.
 */
export async function deleteCustomTool(actor: Actor, toolId: unknown, options: { confirmInUse?: boolean } = {}): Promise<void> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const tool = await loadTool(toolId);
  await db.transaction(async (tx) => {
    const users = await tx
      .select({ name: agents.name })
      .from(agentCustomTools)
      .innerJoin(agents, eq(agents.id, agentCustomTools.agentId))
      .where(eq(agentCustomTools.customToolId, tool.id))
      .orderBy(asc(agents.name));
    if (users.length > 0 && !options.confirmInUse) {
      throw new ConflictError(`La usan ${users.map((user) => user.name).join(", ")}. Si la borras, esos agentes dejarán de tenerla.`);
    }
    await tx.delete(agentCustomTools).where(eq(agentCustomTools.customToolId, tool.id));
    await tx.delete(customTools).where(eq(customTools.id, tool.id));
    await writeAudit({ actor, action: "custom_tool.deleted", targetType: "custom_tool", targetId: tool.id, metadata: { name: tool.name, agents: users.length } }, tx);
  });
}

// ─── «Probar» ───────────────────────────────────────────────────────────────────────────────────────────

function responseText(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

/**
 * «Probar» with sample values: validated like the model's arguments, run on the server with the saved configuration
 * and the secret headers, and answered with the status, the time and the answer cut short, without the secrets.
 * Logged like the calls of the agents ([HER-03]).
 */
export async function testCustomTool(actor: Actor, toolId: unknown, args: unknown, deps: HttpToolDeps = {}, limiter: RateLimiter = getRateLimiter()): Promise<CustomToolTestResult> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const tool = storedTool(await loadTool(toolId));
  const parsed = httpToolArgumentsSchema(tool.parameters).safeParse(args);
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (errors[String(issue.path[0] ?? "_form")] ??= []).push(issue.message);
    throw new ValidationError(undefined, errors);
  }
  const limit = await limiter.hit(`http_tool:test:${actor.userId}`, HTTP_TOOL_TEST_LIMIT, TEST_WINDOW_MS);
  if (!limit.allowed) throw new RateLimitError(TEST_LIMITED);
  const outcome = await runStoredHttpTool(tool, parsed.data, deps);
  await writeAudit({ actor, action: "custom_tool.tested", targetType: "custom_tool", targetId: tool.id, metadata: httpToolAuditDetails(tool, outcome) });
  return {
    ok: outcome.ok,
    status: outcome.status,
    durationMs: outcome.durationMs,
    error: outcome.error?.message ?? null,
    response: responseText(outcome.data),
    truncated: outcome.truncated,
  };
}

// ─── Agents ↔ tools ([AGE-08]) ──────────────────────────────────────────────────────────────────────────

export type AgentCustomToolRow = { id: string; name: string; description: string; method: HttpMethod; host: string | null; attached: boolean };

async function assertAgentExists(agentId: string): Promise<void> {
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new NotFoundError(AGENT_NOT_FOUND);
}

/** Every tool, and whether this agent uses it (the agent's Herramientas tab). */
export async function listAgentCustomTools(actor: Actor, agentId: unknown): Promise<AgentCustomToolRow[]> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const id = idSchema.safeParse(agentId);
  if (!id.success) throw new NotFoundError(AGENT_NOT_FOUND);
  await assertAgentExists(id.data);
  const [tools, attached] = await Promise.all([
    db
      .select({ id: customTools.id, name: customTools.name, description: customTools.description, method: customTools.method, url: customTools.url })
      .from(customTools)
      .orderBy(asc(customTools.name)),
    db.select({ toolId: agentCustomTools.customToolId }).from(agentCustomTools).where(eq(agentCustomTools.agentId, id.data)),
  ]);
  const used = new Set(attached.map((row) => row.toolId));
  return tools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    method: tool.method,
    host: templateOrigin(tool.url)?.host ?? null,
    attached: used.has(tool.id),
  }));
}

export const agentCustomToolSchema = z.object({ agentId: idSchema, toolId: idSchema, attached: z.boolean({ error: "Datos no válidos." }) });

/** Switches one tool on or off for one agent ([AGE-08]); runAgent offers it from the next message. */
export async function setAgentCustomTool(actor: Actor, input: unknown): Promise<{ toolName: string }> {
  assertCan(actor, PERMISSIONS.agents.customTools);
  const parsed = agentCustomToolSchema.safeParse(input);
  if (!parsed.success) throw new NotFoundError(NOT_FOUND);
  const { agentId, toolId, attached } = parsed.data;
  await assertAgentExists(agentId);
  const tool = await loadTool(toolId);
  await db.transaction(async (tx) => {
    if (attached) await tx.insert(agentCustomTools).values({ agentId, customToolId: tool.id }).onConflictDoNothing();
    else await tx.delete(agentCustomTools).where(and(eq(agentCustomTools.agentId, agentId), eq(agentCustomTools.customToolId, tool.id)));
    await writeAudit({ actor, action: "agent.custom_tools_changed", targetType: "agent", targetId: agentId, metadata: { tool: tool.name, attached } }, tx);
  });
  return { toolName: tool.name };
}
