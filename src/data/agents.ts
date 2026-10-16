// Agents ([AGE-01]–[AGE-15], [MOD-05]–[MOD-07]): list, create (blank or from a sector template), edit, versions
// (every save is a snapshot; restoring saves a new one), duplicate, delete and avatar. Permissions from
// «Quién puede hacer qué»: see = owner, admin, supervisor and viewer; change = owner and admin; test = owner, admin
// and supervisor. Agents are configuration only: no secrets here.
// Internal agents ([INT-01]–[INT-05], [INT-15]) are rows of the same table with audience = team: only owner and
// admin see and configure them, and each has its list of who may use it (src/data/assistants.ts is where they answer).
import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import {
  agentContextFiles,
  agentCustomTools,
  agentKnowledgeBases,
  agentMembers,
  agents,
  agentVersions,
  aiRuns,
  assistantChats,
  assistantMessages,
  channels,
  conversations,
  messages,
  user,
  userRoles,
  type AgentHandoffConfig,
  type AgentInstructions,
} from "@/db/schema";
import { agentCreateSchema, agentInputFromTemplate, agentUpdateSchema } from "@/lib/agent-input";
import { DEFAULT_SYSTEM_TOOLS } from "@/lib/agent-tools";
import { TEAM_ACCESS_MODES, type Audience, type ChannelType, type Role, type Sector, type TeamAccess } from "@/lib/enums";
import { defaultFallbackFor } from "@/lib/openrouter/default-models";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { idSchema } from "@/lib/validation";
import { generateFileKey, getFileStorage, readAll, safeExtension, type FileStorage } from "@/server/adapters/file-storage";
import { catalogForValidation, validateModelChoice } from "@/server/ai/models";
import { resolveDefaultModels } from "@/server/ai/openrouter";
import type { AgentRunConfig } from "@/server/ai/run-agent";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { AGENT_NOT_FOUND, agentAction, assertAgentAudience, seesInternalAgents } from "./agent-audience";
import { writeAudit } from "./audit";
import { detectLogoFormat, MAX_LOGO_BYTES } from "./business";
import { deleteUnusedContextOriginals } from "./knowledge-context-files";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

export type Agent = typeof agents.$inferSelect;

const NOT_FOUND = AGENT_NOT_FOUND;
/** Prefix of avatar keys; served only to who may see agents (src/app/api/files). */
export const AVATAR_KEY_PREFIX = "avatars";

/** Fields of an agent that make up its configuration: what a version stores and a restore brings back. */
const CONFIG_FIELDS = [
  "name",
  "description",
  "avatarFileKey",
  "language",
  "tone",
  "instructions",
  "model",
  "fallbackModel",
  "temperature",
  "reasoningEffort",
  "maxOutputTokens",
  "knowledgeMode",
  "handoff",
  "systemTools",
] as const;
type ConfigField = (typeof CONFIG_FIELDS)[number];
export type AgentConfig = Pick<Agent, ConfigField>;

function configOf(agent: AgentConfig): AgentConfig {
  return Object.fromEntries(CONFIG_FIELDS.map((field) => [field, agent[field]])) as AgentConfig;
}

// ─── Validation ─────────────────────────────────────────────────────────────────────────────────────────

/** Zod errors keyed by their full path ("instructions.role"), so each shows next to its field ([AGE-15]). */
function parseAgentInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(undefined, fieldErrors);
}

/** Drops empty guided fields (the form sends "" or null for them). */
function cleanInstructions(value: Record<string, string | null | undefined>): AgentInstructions {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
}

function cleanHandoff(value: z.output<typeof agentUpdateSchema>["handoff"]): AgentHandoffConfig {
  if (!value) return {};
  const cleaned: AgentHandoffConfig = {};
  if (value.keywords) cleaned.keywords = value.keywords;
  if (value.sensitiveTopics) cleaned.sensitiveTopics = value.sensitiveTopics;
  if (value.unknownThreshold !== undefined) cleaned.unknownThreshold = value.unknownThreshold;
  if (value.messageInHours) cleaned.messageInHours = value.messageInHours;
  if (value.messageOffHours) cleaned.messageOffHours = value.messageOffHours;
  if (value.notifyUserIds) cleaned.notifyUserIds = [...new Set(value.notifyUserIds)];
  return cleaned;
}

/** Changes for the agents table from validated input (only the fields sent). */
function changesFrom(data: z.output<typeof agentUpdateSchema>): Partial<AgentConfig> {
  const changes: Partial<AgentConfig> = {};
  if (data.name !== undefined) changes.name = data.name;
  if (data.description !== undefined) changes.description = data.description ?? null;
  if (data.language !== undefined) changes.language = data.language;
  if (data.tone !== undefined) changes.tone = data.tone ?? null;
  if (data.instructions !== undefined) changes.instructions = cleanInstructions(data.instructions);
  if (data.model !== undefined) changes.model = data.model;
  if (data.fallbackModel !== undefined) changes.fallbackModel = data.fallbackModel;
  if (data.temperature !== undefined) changes.temperature = data.temperature;
  if (data.reasoningEffort !== undefined) changes.reasoningEffort = data.reasoningEffort;
  if (data.maxOutputTokens !== undefined) changes.maxOutputTokens = data.maxOutputTokens;
  if (data.knowledgeMode !== undefined) changes.knowledgeMode = data.knowledgeMode;
  if (data.handoff !== undefined) changes.handoff = cleanHandoff(data.handoff);
  if (data.systemTools !== undefined) changes.systemTools = data.systemTools;
  return changes;
}

type ModelFields = { model: boolean; fallbackModel: boolean };

/**
 * The model pair ([MOD-05]): different providers always; against the model list (the saved one or, if none was
 * saved yet, OpenRouter's) only the models being chosen now, so a model that starts to expire is flagged but never
 * blocks other edits ([MOD-06]). `fromDefaults` names the fields filled from Ajustes › IA: the person did not choose
 * them, so their problem is explained as a message of the form, not of a field they cannot see.
 */
async function assertValidModels(
  next: AgentConfig,
  previous: AgentConfig | null,
  chosen: ModelFields,
  fromDefaults: ModelFields = { model: false, fallbackModel: false },
): Promise<void> {
  const [catalog, settings] = await Promise.all([catalogForValidation(), loadBusinessSettings()]);
  const errors = validateModelChoice(next.model, next.fallbackModel, catalog?.models ?? null, {
    checkCatalog: { model: chosen.model && next.model !== previous?.model, fallbackModel: chosen.fallbackModel && next.fallbackModel !== previous?.fallbackModel },
    timeZone: settings.timezone,
  });
  if (!errors) return;
  const defaultField = (["model", "fallbackModel"] as const).find((field) => errors[field] && fromDefaults[field]);
  const problem = defaultField ? (errors[defaultField]?.[0] ?? "") : "";
  const message = defaultField
    ? `El modelo por defecto de Ajustes › IA (${next[defaultField]}) no sirve para un agente: ${problem.charAt(0).toLocaleLowerCase("es")}${problem.slice(1)} Cámbialo en Ajustes › IA.`
    : undefined;
  throw new ValidationError(message, errors);
}

/** «A quién avisar» only lists active people of this installation who can act on a hand-off (never «Solo lectura»). */
async function assertNotifiableUsers(handoff: AgentHandoffConfig): Promise<void> {
  const ids = handoff.notifyUserIds ?? [];
  if (ids.length === 0) return;
  const found = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(inArray(userRoles.userId, ids), isNull(userRoles.disabledAt), ne(userRoles.role, "viewer")));
  if (found.length !== ids.length) {
    throw new ValidationError(undefined, {
      "handoff.notifyUserIds": ["Alguna de las personas elegidas ya no existe, está desactivada o solo tiene acceso de lectura."],
    });
  }
}

// ─── Versions ───────────────────────────────────────────────────────────────────────────────────────────

async function insertVersion(tx: Executor, agentId: string, version: number, config: AgentConfig, actor: Actor): Promise<void> {
  await tx.insert(agentVersions).values({
    agentId,
    version,
    snapshot: configOf(config) as unknown as Record<string, unknown>,
    createdBy: actor.userId,
    createdByName: actor.name,
  });
}

async function loadAgent(executor: Executor, agentId: string): Promise<Agent> {
  const id = idSchema.safeParse(agentId);
  if (!id.success) throw new NotFoundError(NOT_FOUND);
  const [row] = await executor.select().from(agents).where(eq(agents.id, id.data));
  if (!row) throw new NotFoundError(NOT_FOUND);
  return row;
}

/**
 * The agent, for a person who already passed the area's permission: an internal one only exists for who manages
 * internal agents ([INT-15]).
 */
async function loadAgentFor(actor: Actor, agentId: string): Promise<Agent> {
  const agent = await loadAgent(db, agentId);
  assertAgentAudience(actor, agent);
  return agent;
}

/** Saves new values of an existing agent as a new version, in one transaction ([AGE-12]). */
async function saveNewVersion(actor: Actor, agentId: string, changes: Partial<AgentConfig>, action: string, metadata: Record<string, unknown>): Promise<Agent> {
  return db.transaction(async (tx) => {
    const current = await loadAgent(tx, agentId);
    const version = current.currentVersion + 1;
    const [updated] = await tx
      .update(agents)
      .set({ ...changes, currentVersion: version, updatedAt: new Date() })
      .where(eq(agents.id, current.id))
      .returning();
    await insertVersion(tx, updated.id, version, updated, actor);
    await writeAudit({ actor, action, targetType: "agent", targetId: updated.id, metadata: { ...metadata, version } }, tx);
    return updated;
  });
}

// ─── Read ───────────────────────────────────────────────────────────────────────────────────────────────

export type AgentChannelRef = { id: string; name: string; type: ChannelType };
export type AgentListItem = Pick<
  Agent,
  "id" | "audience" | "teamAccess" | "name" | "description" | "avatarFileKey" | "model" | "fallbackModel" | "templateSector" | "currentVersion" | "updatedAt"
> & {
  /** Channels where it is the active agent ([AGE-01], [AGE-11]). */
  activeChannels: AgentChannelRef[];
  /** Internal agents: the people listed in its Acceso tab who can still use it ([INT-05]); 0 for the rest. */
  accessPeople: number;
};

/**
 * Agents with their model and the channels where they are active ([AGE-01]). By default only those that answer
 * customers, which is what every agent picker of a channel or a conversation needs ([INT-03]); `all` adds the
 * internal ones for who may see them ([INT-15]).
 */
export async function listAgents(actor: Actor, options: { audience?: "customers" | "all" } = {}): Promise<AgentListItem[]> {
  assertCan(actor, PERMISSIONS.agents.view);
  const withInternal = options.audience === "all" && seesInternalAgents(actor);
  const rows = await db
    .select()
    .from(agents)
    .where(withInternal ? undefined : eq(agents.audience, "customers"))
    .orderBy(asc(agents.name));
  const active = await db
    .select({ id: channels.id, name: channels.name, type: channels.type, agentId: channels.activeAgentId })
    .from(channels)
    .orderBy(asc(channels.name));
  // Who each internal agent was given to, counted as the Acceso tab lists them: active supervisors and agents.
  const listed = withInternal
    ? await db
        .select({ agentId: agentMembers.agentId, people: count() })
        .from(agentMembers)
        .innerJoin(userRoles, eq(userRoles.userId, agentMembers.userId))
        .where(and(inArray(userRoles.role, [...MEMBER_ROLES]), isNull(userRoles.disabledAt)))
        .groupBy(agentMembers.agentId)
    : [];
  const peopleOf = new Map(listed.map((row) => [row.agentId, row.people]));
  return rows.map((row) => ({
    id: row.id,
    audience: row.audience,
    teamAccess: row.teamAccess,
    accessPeople: peopleOf.get(row.id) ?? 0,
    name: row.name,
    description: row.description,
    avatarFileKey: row.avatarFileKey,
    model: row.model,
    fallbackModel: row.fallbackModel,
    templateSector: row.templateSector,
    currentVersion: row.currentVersion,
    updatedAt: row.updatedAt,
    activeChannels: active.filter((channel) => channel.agentId === row.id).map(({ id, name, type }) => ({ id, name, type })),
  }));
}

/** The editor: the whole configuration (read-only for supervisor and viewer). */
export async function getAgent(actor: Actor, agentId: string): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.view);
  return loadAgentFor(actor, agentId);
}

/** What runAgent needs ([PRU-01]): the saved configuration of an agent that the actor may test. */
export async function getAgentForTesting(actor: Actor, agentId: string): Promise<AgentRunConfig> {
  assertCan(actor, PERMISSIONS.agents.test);
  return loadAgentFor(actor, agentId);
}

/**
 * System: the saved configuration for the reply engine, or null when the agent no longer exists. Never an internal
 * agent: whatever a channel or a conversation points to, only an agent for customers answers a customer ([INT-03]).
 */
export async function loadAgentForRun(agentId: string): Promise<AgentRunConfig | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.audience, "customers")));
  return row ?? null;
}

// ─── Create and edit ────────────────────────────────────────────────────────────────────────────────────

/**
 * A new agent, blank or with the given starting values ([AGE-02]). Models default to Settings › IA. Version 1.
 * `audience: "team"` makes it an internal agent ([INT-01]): blank, with no tools, hand-off or channels, and used by
 * nobody but owner and admins until its access is chosen ([INT-05]).
 */
export async function createAgent(actor: Actor, input: unknown, options: { templateSector?: Sector | null } = {}): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const data = parseAgentInput(agentCreateSchema, input);
  const audience: Audience = data.audience ?? "customers";
  assertCan(actor, agentAction(audience, PERMISSIONS.agents.manage));
  const internal = audience === "team";
  if (internal && options.templateSector) throw new ValidationError("Un agente interno se crea en blanco, sin plantilla de sector.");
  const defaults = await resolveDefaultModels();
  const model = data.model ?? defaults.chat;
  const config: AgentConfig = {
    name: data.name,
    description: data.description ?? null,
    avatarFileKey: null,
    language: data.language ?? "es",
    tone: data.tone ?? null,
    instructions: cleanInstructions(data.instructions ?? {}),
    model,
    fallbackModel: data.fallbackModel ?? defaultFallbackFor(model, defaults.fallback),
    temperature: data.temperature ?? null,
    reasoningEffort: data.reasoningEffort ?? null,
    maxOutputTokens: data.maxOutputTokens ?? null,
    knowledgeMode: data.knowledgeMode ?? "auto",
    handoff: internal ? {} : cleanHandoff(data.handoff),
    systemTools: internal ? [] : (data.systemTools ?? [...DEFAULT_SYSTEM_TOOLS]),
  };
  // A new agent is a new choice: both models are checked, also those that come from Ajustes › IA ([MOD-05]).
  await assertValidModels(
    config,
    null,
    { model: true, fallbackModel: true },
    { model: data.model === undefined, fallbackModel: data.fallbackModel === undefined },
  );
  await assertNotifiableUsers(config.handoff);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agents)
      .values({ ...config, audience, teamAccess: internal ? "selected" : "everyone", templateSector: options.templateSector ?? null, currentVersion: 1, createdBy: actor.userId })
      .returning();
    await insertVersion(tx, created.id, 1, created, actor);
    await writeAudit(
      { actor, action: "agent.created", targetType: "agent", targetId: created.id, metadata: { template: options.templateSector ?? null, audience } },
      tx,
    );
    return created;
  });
}

/** An agent from the template of a sector, every field editable afterwards ([AGE-02], [ASI-08]). */
export async function createAgentFromTemplate(actor: Actor, sector: Sector, overrides: Record<string, unknown> = {}): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const template = getSectorPreset(sector).agentTemplate;
  return createAgent(actor, { ...agentInputFromTemplate(template), ...overrides }, { templateSector: sector });
}

/** Saves any subset of the editor's fields as a new version ([AGE-12], [AGE-15], [MOD-05]). */
export async function updateAgent(actor: Actor, agentId: string, input: unknown): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const data = parseAgentInput(agentUpdateSchema, input);
  const changes = changesFrom(data);
  const current = await loadAgentFor(actor, agentId);
  const next: AgentConfig = { ...configOf(current), ...changes };
  await assertValidModels(next, current, { model: data.model !== undefined, fallbackModel: data.fallbackModel !== undefined });
  if (changes.handoff) await assertNotifiableUsers(changes.handoff);
  return saveNewVersion(actor, current.id, changes, "agent.updated", { fields: Object.keys(changes) });
}

// ─── Versions ───────────────────────────────────────────────────────────────────────────────────────────

export type AgentVersionItem = { version: number; createdAt: Date; createdByName: string | null; current: boolean };

/** Versiones: number, date and author, newest first ([AGE-12]). */
export async function listAgentVersions(actor: Actor, agentId: string): Promise<AgentVersionItem[]> {
  assertCan(actor, PERMISSIONS.agents.view);
  const agent = await loadAgentFor(actor, agentId);
  const rows = await db
    .select({ version: agentVersions.version, createdAt: agentVersions.createdAt, createdByName: agentVersions.createdByName })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agent.id))
    .orderBy(desc(agentVersions.version));
  return rows.map((row) => ({ ...row, current: row.version === agent.currentVersion }));
}

const VERSION_NOT_FOUND = "No se ha encontrado esa versión.";

async function loadVersion(agentId: string, version: unknown): Promise<{ number: number; config: AgentConfig }> {
  const number = z.number().int().min(1).safeParse(version);
  if (!number.success) throw new NotFoundError(VERSION_NOT_FOUND);
  const [row] = await db
    .select({ snapshot: agentVersions.snapshot })
    .from(agentVersions)
    .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.version, number.data)));
  if (!row) throw new NotFoundError(VERSION_NOT_FOUND);
  return { number: number.data, config: row.snapshot as unknown as AgentConfig };
}

/** «Ver» a version: its saved configuration. */
export async function getAgentVersion(actor: Actor, agentId: string, version: unknown): Promise<AgentConfig> {
  assertCan(actor, PERMISSIONS.agents.view);
  const agent = await loadAgentFor(actor, agentId);
  return (await loadVersion(agent.id, version)).config;
}

/**
 * «Restaurar»: brings back an old configuration, saved as a new version ([AGE-12]) with the checks of any save: the
 * models that change ([MOD-05]) and «a quién avisar» ([AGE-09]). An avatar replaced since then no longer has its
 * file, so the current one stays.
 */
export async function restoreAgentVersion(actor: Actor, agentId: string, version: unknown, storage: FileStorage = getFileStorage()): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const agent = await loadAgentFor(actor, agentId);
  const old = await loadVersion(agent.id, version);
  // Fields added after that version was saved keep their current value.
  const restored = configOf({ ...configOf(agent), ...old.config });
  try {
    await assertValidModels(restored, agent, { model: true, fallbackModel: true });
    await assertNotifiableUsers(restored.handoff);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const reason = Object.values(error.fieldErrors ?? {}).flat()[0] ?? error.userMessage;
    throw new ValidationError(`No se puede recuperar la versión ${old.number}: ${reason.charAt(0).toLocaleLowerCase("es")}${reason.slice(1)}`, error.fieldErrors);
  }
  if (restored.avatarFileKey && restored.avatarFileKey !== agent.avatarFileKey && !(await storage.exists(restored.avatarFileKey))) {
    restored.avatarFileKey = agent.avatarFileKey;
  }
  return saveNewVersion(actor, agent.id, restored, "agent.version_restored", { restoredVersion: old.number });
}

// ─── Duplicate and delete ───────────────────────────────────────────────────────────────────────────────

/** A file of its own for the copy's avatar: deleting or changing one agent's avatar never breaks the other's. */
async function copyAvatar(storage: FileStorage, key: string): Promise<string | null> {
  try {
    const file = await storage.get(key);
    if (!file) return null;
    const copyKey = generateFileKey(AVATAR_KEY_PREFIX, safeExtension(key));
    await storage.put(copyKey, await readAll(file.stream), file.contentType);
    return copyKey;
  } catch (error) {
    // The copy goes on with the initials instead of the picture.
    console.error(`[agents] No se ha podido copiar el avatar: ${safeErrorMessage(error)}`);
    return null;
  }
}

/** A copy named «Copia de …» with its context files and knowledge bases, starting at version 1. */
export async function duplicateAgent(actor: Actor, agentId: string, storage: FileStorage = getFileStorage()): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const source = await loadAgentFor(actor, agentId);
  const name = `Copia de ${source.name}`.slice(0, 80);
  const avatarFileKey = source.avatarFileKey ? await copyAvatar(storage, source.avatarFileKey) : null;
  try {
    return await insertCopy(actor, source, name, avatarFileKey);
  } catch (error) {
    if (avatarFileKey) await deleteQuietly(storage, avatarFileKey);
    throw error;
  }
}

async function insertCopy(actor: Actor, source: Agent, name: string, avatarFileKey: string | null): Promise<Agent> {
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(agents)
      .values({
        ...configOf(source),
        // The copy of an internal agent is internal too, with the same access ([INT-01]).
        audience: source.audience,
        teamAccess: source.teamAccess,
        name,
        avatarFileKey,
        templateSector: source.templateSector,
        currentVersion: 1,
        createdBy: actor.userId,
      })
      .returning();
    await insertVersion(tx, copy.id, 1, copy, actor);
    const files = await tx.select().from(agentContextFiles).where(eq(agentContextFiles.agentId, source.id));
    if (files.length > 0) {
      await tx.insert(agentContextFiles).values(
        files.map((file) => ({
          agentId: copy.id,
          title: file.title,
          contentMd: file.contentMd,
          tokenCount: file.tokenCount,
          sourceFileKey: file.sourceFileKey,
          sourceFileName: file.sourceFileName,
          sourceMimeType: file.sourceMimeType,
        })),
      );
    }
    const bases = await tx.select({ id: agentKnowledgeBases.knowledgeBaseId }).from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, source.id));
    if (bases.length > 0) await tx.insert(agentKnowledgeBases).values(bases.map((base) => ({ agentId: copy.id, knowledgeBaseId: base.id })));
    const tools = await tx.select({ id: agentCustomTools.customToolId }).from(agentCustomTools).where(eq(agentCustomTools.agentId, source.id));
    if (tools.length > 0) await tx.insert(agentCustomTools).values(tools.map((tool) => ({ agentId: copy.id, customToolId: tool.id })));
    const members = await tx.select({ userId: agentMembers.userId }).from(agentMembers).where(eq(agentMembers.agentId, source.id));
    if (members.length > 0) await tx.insert(agentMembers).values(members.map((member) => ({ agentId: copy.id, userId: member.userId })));
    await writeAudit({ actor, action: "agent.duplicated", targetType: "agent", targetId: copy.id, metadata: { from: source.id } }, tx);
    return copy;
  });
}

/**
 * Deletes an agent ([AGE-13]). While it is the active agent of a channel it is refused unless `confirmActiveChannels`
 * says the person accepted that those channels stay without an agent. Old messages keep its name (agent_name).
 * Children are deleted first: nothing relies on cascades.
 */
export async function deleteAgent(
  actor: Actor,
  agentId: string,
  options: { confirmActiveChannels?: boolean; storage?: FileStorage } = {},
): Promise<{ detachedChannelIds: string[] }> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const agent = await loadAgentFor(actor, agentId);
  const contextOriginals = await db.select({ key: agentContextFiles.sourceFileKey }).from(agentContextFiles).where(eq(agentContextFiles.agentId, agent.id));
  const detached = await db.transaction(async (tx) => {
    const activeIn = await tx.select({ id: channels.id, name: channels.name }).from(channels).where(eq(channels.activeAgentId, agent.id));
    if (activeIn.length > 0 && !options.confirmActiveChannels) {
      throw new ConflictError(
        `«${agent.name}» está activo en ${activeIn.map((channel) => channel.name).join(", ")}. Si lo borras, esos canales se quedarán sin agente.`,
      );
    }
    await tx.update(channels).set({ activeAgentId: null, updatedAt: new Date() }).where(eq(channels.activeAgentId, agent.id));
    await tx.update(channels).set({ offHoursAgentId: null, updatedAt: new Date() }).where(eq(channels.offHoursAgentId, agent.id));
    await tx.update(conversations).set({ agentOverrideId: null, updatedAt: new Date() }).where(eq(conversations.agentOverrideId, agent.id));
    await tx.update(messages).set({ agentId: null }).where(eq(messages.agentId, agent.id));
    await tx.update(aiRuns).set({ agentId: null }).where(eq(aiRuns.agentId, agent.id));
    await tx.delete(agentVersions).where(eq(agentVersions.agentId, agent.id));
    await tx.delete(agentContextFiles).where(eq(agentContextFiles.agentId, agent.id));
    await tx.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agent.id));
    await tx.delete(agentCustomTools).where(eq(agentCustomTools.agentId, agent.id));
    // An internal agent takes with it who could use it and every conversation the team had with it ([INT-10]).
    await tx.delete(agentMembers).where(eq(agentMembers.agentId, agent.id));
    const chats = tx.select({ id: assistantChats.id }).from(assistantChats).where(eq(assistantChats.agentId, agent.id));
    await tx.delete(assistantMessages).where(inArray(assistantMessages.chatId, chats));
    await tx.delete(assistantChats).where(eq(assistantChats.agentId, agent.id));
    await tx.delete(agents).where(eq(agents.id, agent.id));
    await writeAudit(
      { actor, action: "agent.deleted", targetType: "agent", targetId: agent.id, metadata: { name: agent.name, detachedChannels: activeIn.length } },
      tx,
    );
    return activeIn.map((channel) => channel.id);
  });
  const storage = options.storage ?? getFileStorage();
  if (agent.avatarFileKey) await deleteQuietly(storage, agent.avatarFileKey);
  // Originals of its context files, unless a duplicated copy still uses them.
  await deleteUnusedContextOriginals(contextOriginals.map((row) => row.key), storage);
  return { detachedChannelIds: detached };
}

// ─── Avatar ─────────────────────────────────────────────────────────────────────────────────────────────

async function deleteQuietly(storage: FileStorage, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    // Nothing points to it any more: an orphan file is harmless and never served.
    console.error(`[agents] No se ha podido borrar el avatar anterior: ${safeErrorMessage(error)}`);
  }
}

/** New avatar (PNG, JPG or WebP checked by content, [SEG-13]); saved as a new version. The old file is deleted. */
export async function saveAgentAvatar(actor: Actor, agentId: string, upload: { bytes: Uint8Array }, storage: FileStorage = getFileStorage()): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const agent = await loadAgentFor(actor, agentId);
  if (upload.bytes.byteLength > MAX_LOGO_BYTES) throw new ValidationError(undefined, { avatar: ["La imagen puede ocupar como mucho 512 KB."] });
  const format = detectLogoFormat(upload.bytes);
  if (!format) throw new ValidationError(undefined, { avatar: ["La imagen tiene que ser PNG, JPG o WebP."] });
  const key = generateFileKey(AVATAR_KEY_PREFIX, format.extension);
  await storage.put(key, upload.bytes, format.contentType);
  let updated: Agent;
  try {
    updated = await saveNewVersion(actor, agent.id, { avatarFileKey: key }, "agent.avatar_updated", {});
  } catch (error) {
    await deleteQuietly(storage, key);
    throw error;
  }
  if (agent.avatarFileKey) await deleteQuietly(storage, agent.avatarFileKey);
  return updated;
}

export async function removeAgentAvatar(actor: Actor, agentId: string, storage: FileStorage = getFileStorage()): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const agent = await loadAgentFor(actor, agentId);
  if (!agent.avatarFileKey) return agent;
  const updated = await saveNewVersion(actor, agent.id, { avatarFileKey: null }, "agent.avatar_removed", {});
  await deleteQuietly(storage, agent.avatarFileKey);
  return updated;
}

/** For /api/files: whether `key` is the avatar of an agent the actor may see. */
export async function canViewAgentAvatar(actor: Actor, key: string): Promise<boolean> {
  if (!key.startsWith(`${AVATAR_KEY_PREFIX}/`)) return false;
  const [row] = await db.select({ id: agents.id, audience: agents.audience, teamAccess: agents.teamAccess }).from(agents).where(eq(agents.avatarFileKey, key));
  if (!row) return false;
  if (row.audience === "customers") return can(actor, PERMISSIONS.agents.view);
  // An internal agent's picture: who configures it, or who may use it in «Asistentes» ([INT-06]).
  return seesInternalAgents(actor) || canUseInternalAgent(actor, row);
}

// ─── Access to an internal agent ([INT-05]) ─────────────────────────────────────────────────────────────

/** Roles that use an internal agent only when it was given to them; owner and admin use them all, a viewer none. */
const MEMBER_ROLES: readonly Role[] = ["supervisor", "agent"];

async function isAgentMember(agentId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agentMembers.id })
    .from(agentMembers)
    .where(and(eq(agentMembers.agentId, agentId), eq(agentMembers.userId, userId)));
  return Boolean(row);
}

/**
 * Whether `actor` may use this internal agent in «Asistentes» ([INT-05]): never a viewer; owner and admin, all;
 * supervisor and agent, those open to the whole team or where they are listed.
 */
export async function canUseInternalAgent(actor: Actor, agent: { id: string; audience: Audience; teamAccess: TeamAccess }): Promise<boolean> {
  if (agent.audience !== "team" || !can(actor, PERMISSIONS.internal.use)) return false;
  if (seesInternalAgents(actor) || agent.teamAccess === "everyone") return true;
  return isAgentMember(agent.id, actor.userId);
}

export type AgentAccessPerson = { id: string; name: string; role: Role; member: boolean };
export type AgentAccess = {
  teamAccess: TeamAccess;
  /** Active supervisors and agents: the people an internal agent can be given to one by one. */
  people: AgentAccessPerson[];
};

/** The Acceso tab of an internal agent: who may use it ([INT-05]). */
export async function getAgentAccess(actor: Actor, agentId: string): Promise<AgentAccess> {
  assertCan(actor, PERMISSIONS.internal.agents);
  const agent = await loadAgent(db, agentId);
  if (agent.audience !== "team") throw new NotFoundError(NOT_FOUND);
  const [people, members] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, role: userRoles.role })
      .from(user)
      .innerJoin(userRoles, eq(userRoles.userId, user.id))
      .where(and(inArray(userRoles.role, [...MEMBER_ROLES]), isNull(userRoles.disabledAt)))
      .orderBy(asc(user.name)),
    db.select({ userId: agentMembers.userId }).from(agentMembers).where(eq(agentMembers.agentId, agent.id)),
  ]);
  const listed = new Set(members.map((member) => member.userId));
  return { teamAccess: agent.teamAccess, people: people.map((person) => ({ ...person, member: listed.has(person.id) })) };
}

export const agentAccessSchema = z
  .object({
    teamAccess: z.enum(TEAM_ACCESS_MODES, { error: "Elige «Todo el equipo» o «Personas concretas»." }),
    userIds: z.array(idSchema).max(500, "Demasiadas personas."),
  })
  .strict();

/**
 * Who may use an internal agent ([INT-05]). The list is kept while the access is «Todo el equipo», so switching back
 * to «Personas concretas» brings the same people. Only active supervisors and agents can be listed, and only they
 * are changed: somebody deactivated (or with another role for now) is not on the screen, so saving it neither adds
 * nor removes them, and they find their assistants again when they come back.
 */
export async function setAgentAccess(actor: Actor, agentId: string, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.internal.agents);
  const data = parseInput(agentAccessSchema, input);
  const wanted = [...new Set(data.userIds)];
  await db.transaction(async (tx) => {
    const agent = await loadAgent(tx, agentId);
    if (agent.audience !== "team") throw new NotFoundError(NOT_FOUND);
    // The people the Acceso tab lists.
    const listable = tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(inArray(userRoles.role, [...MEMBER_ROLES]), isNull(userRoles.disabledAt)));
    const valid = wanted.length > 0 ? await tx.select({ userId: userRoles.userId }).from(userRoles).where(and(inArray(userRoles.userId, wanted), inArray(userRoles.userId, listable))) : [];
    if (valid.length !== wanted.length) {
      throw new ValidationError(undefined, { userIds: ["Alguna de las personas elegidas ya no existe, está desactivada o no puede usar agentes internos."] });
    }
    await tx.delete(agentMembers).where(and(eq(agentMembers.agentId, agent.id), inArray(agentMembers.userId, listable)));
    if (wanted.length > 0) await tx.insert(agentMembers).values(wanted.map((userId) => ({ agentId: agent.id, userId })));
    await tx.update(agents).set({ teamAccess: data.teamAccess, updatedAt: new Date() }).where(eq(agents.id, agent.id));
    // Without names: how many people, never who.
    await writeAudit({ actor, action: "agent.access_changed", targetType: "agent", targetId: agent.id, metadata: { teamAccess: data.teamAccess, people: wanted.length } }, tx);
  });
}
