// Agents ([AGE-01]–[AGE-15], [MOD-05]–[MOD-07]): list, create (blank or from a sector template), edit, versions
// (every save is a snapshot; restoring saves a new one), duplicate, delete and avatar. Permissions from
// «Quién puede hacer qué»: see = owner, admin, supervisor and viewer; change = owner and admin; test = owner, admin
// and supervisor. Agents are configuration only: no secrets here.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import {
  agentContextFiles,
  agentCustomTools,
  agentKnowledgeBases,
  agents,
  agentVersions,
  aiRuns,
  channels,
  conversations,
  messages,
  userRoles,
  type AgentHandoffConfig,
  type AgentInstructions,
} from "@/db/schema";
import { agentCreateSchema, agentInputFromTemplate, agentUpdateSchema } from "@/lib/agent-input";
import { DEFAULT_SYSTEM_TOOLS } from "@/lib/agent-tools";
import type { ChannelType, Sector } from "@/lib/enums";
import { defaultFallbackFor } from "@/lib/openrouter/default-models";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { idSchema } from "@/lib/validation";
import { generateFileKey, getFileStorage, readAll, safeExtension, type FileStorage } from "@/server/adapters/file-storage";
import { catalogForValidation, validateModelChoice } from "@/server/ai/models";
import { resolveDefaultModels } from "@/server/ai/openrouter";
import type { AgentRunConfig } from "@/server/ai/run-agent";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { writeAudit } from "./audit";
import { detectLogoFormat, MAX_LOGO_BYTES } from "./business";
import { deleteUnusedContextOriginals } from "./knowledge-context-files";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

export type Agent = typeof agents.$inferSelect;

const NOT_FOUND = "No se ha encontrado el agente.";
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
  "id" | "name" | "description" | "avatarFileKey" | "model" | "fallbackModel" | "templateSector" | "currentVersion" | "updatedAt"
> & {
  /** Channels where it is the active agent ([AGE-01], [AGE-11]). */
  activeChannels: AgentChannelRef[];
};

/** Agentes: every agent with its model and the channels where it is active ([AGE-01]). */
export async function listAgents(actor: Actor): Promise<AgentListItem[]> {
  assertCan(actor, PERMISSIONS.agents.view);
  const rows = await db.select().from(agents).orderBy(asc(agents.name));
  const active = await db
    .select({ id: channels.id, name: channels.name, type: channels.type, agentId: channels.activeAgentId })
    .from(channels)
    .orderBy(asc(channels.name));
  return rows.map((row) => ({
    id: row.id,
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
  return loadAgent(db, agentId);
}

/** What runAgent needs ([PRU-01]): the saved configuration of an agent that the actor may test. */
export async function getAgentForTesting(actor: Actor, agentId: string): Promise<AgentRunConfig> {
  assertCan(actor, PERMISSIONS.agents.test);
  return loadAgent(db, agentId);
}

/** System: the saved configuration for the reply engine, or null when the agent no longer exists. */
export async function loadAgentForRun(agentId: string): Promise<AgentRunConfig | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  return row ?? null;
}

// ─── Create and edit ────────────────────────────────────────────────────────────────────────────────────

/** A new agent, blank or with the given starting values ([AGE-02]). Models default to Settings › IA. Version 1. */
export async function createAgent(actor: Actor, input: unknown, options: { templateSector?: Sector | null } = {}): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const data = parseAgentInput(agentCreateSchema, input);
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
    handoff: cleanHandoff(data.handoff),
    systemTools: data.systemTools ?? [...DEFAULT_SYSTEM_TOOLS],
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
      .values({ ...config, templateSector: options.templateSector ?? null, currentVersion: 1, createdBy: actor.userId })
      .returning();
    await insertVersion(tx, created.id, 1, created, actor);
    await writeAudit(
      { actor, action: "agent.created", targetType: "agent", targetId: created.id, metadata: { template: options.templateSector ?? null } },
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
  const current = await loadAgent(db, agentId);
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
  const agent = await loadAgent(db, agentId);
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
  const agent = await loadAgent(db, agentId);
  return (await loadVersion(agent.id, version)).config;
}

/**
 * «Restaurar»: brings back an old configuration, saved as a new version ([AGE-12]) with the checks of any save: the
 * models that change ([MOD-05]) and «a quién avisar» ([AGE-09]). An avatar replaced since then no longer has its
 * file, so the current one stays.
 */
export async function restoreAgentVersion(actor: Actor, agentId: string, version: unknown, storage: FileStorage = getFileStorage()): Promise<Agent> {
  assertCan(actor, PERMISSIONS.agents.manage);
  const agent = await loadAgent(db, agentId);
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
  const source = await loadAgent(db, agentId);
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
      .values({ ...configOf(source), name, avatarFileKey, templateSector: source.templateSector, currentVersion: 1, createdBy: actor.userId })
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
  const agent = await loadAgent(db, agentId);
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
  const agent = await loadAgent(db, agentId);
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
  const agent = await loadAgent(db, agentId);
  if (!agent.avatarFileKey) return agent;
  const updated = await saveNewVersion(actor, agent.id, { avatarFileKey: null }, "agent.avatar_removed", {});
  await deleteQuietly(storage, agent.avatarFileKey);
  return updated;
}

/** For /api/files: whether `key` is the avatar of an agent the actor may see. */
export async function canViewAgentAvatar(actor: Actor, key: string): Promise<boolean> {
  if (!key.startsWith(`${AVATAR_KEY_PREFIX}/`)) return false;
  if (!can(actor, PERMISSIONS.agents.view)) return false;
  const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.avatarFileKey, key));
  return Boolean(row);
}
