// Canales: the parts every channel type shares ([CAN-01]–[CAN-08], [CAN-16], [CAN-17]) and the web chat's own CRUD
// ([WEB-01], [WEB-02], [WEB-07], [WEB-10]). Seeing channels is owner, admin and Solo lectura (never credentials);
// changing them, owner and admin. Secrets never leave the server: only `hasSecrets` says whether there are any.
import "server-only";
import { asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import {
  agents,
  channelMembers,
  channels,
  consents,
  conversations,
  notifications,
  oauthStates,
  userRoles,
  webhookEvents,
  whatsappTemplates,
  type ChannelHealth,
} from "@/db/schema";
import { OFF_HOURS_BEHAVIORS, REPLY_MODES, type ChannelStatus, type ChannelType, type OffHoursBehavior, type ReplyMode } from "@/lib/enums";
import { channelFilter, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema, optionalText } from "@/lib/validation";
import { readWebchatConfig, webchatConfigSchema, type WebchatConfig } from "@/lib/webchat-config";
import { isValidFileKey } from "@/server/adapters/file-storage";
import { defaultCapabilitiesOf } from "@/server/channels/capabilities";
import type { ChannelCapabilities } from "@/server/channels/types";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";

export const MAX_TEST_ALLOWLIST = 100;
const MAX_NAME = 80;

export type ChannelListItem = {
  id: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  isDemo: boolean;
  activeAgent: { id: string; name: string } | null;
  aiEnabled: boolean;
  testMode: boolean;
  replyMode: ReplyMode;
  lastInboundAt: Date | null;
  capabilities: ChannelCapabilities;
};

/** Canales: every channel with its state, active agent and AI switch ([CAN-01]). */
export async function listChannels(actor: Actor): Promise<ChannelListItem[]> {
  assertCan(actor, PERMISSIONS.channels.view);
  const rows = await db
    .select({ channel: channels, agentName: agents.name })
    .from(channels)
    .leftJoin(agents, eq(agents.id, channels.activeAgentId))
    .orderBy(asc(channels.name));
  return rows.map(({ channel, agentName }) => ({
    id: channel.id,
    type: channel.type,
    name: channel.name,
    status: channel.status,
    isDemo: channel.isDemo,
    activeAgent: channel.activeAgentId && agentName ? { id: channel.activeAgentId, name: agentName } : null,
    aiEnabled: channel.aiEnabled,
    testMode: channel.testMode,
    replyMode: channel.replyMode,
    lastInboundAt: channel.lastInboundAt,
    capabilities: defaultCapabilitiesOf(channel),
  }));
}

/** Names of the channels whose inbox the person sees, for the inbox filter (Supervisor too, [PER-04]). */
export async function listInboxChannels(actor: Actor): Promise<{ id: string; name: string; type: ChannelType }[]> {
  assertCan(actor, PERMISSIONS.inbox.view);
  const scoped = channelFilter(actor);
  if (scoped && scoped.length === 0) return [];
  return db
    .select({ id: channels.id, name: channels.name, type: channels.type })
    .from(channels)
    .where(scoped ? inArray(channels.id, [...scoped]) : undefined)
    .orderBy(asc(channels.name));
}

export type ChannelDetail = ChannelListItem & {
  /** Non-secret settings of the type (the web chat's look, email addresses…). */
  config: Record<string, unknown>;
  /** Only for web chats: the settings with their defaults. */
  webchat: WebchatConfig | null;
  testAllowlist: string[];
  disclosureMessage: string | null;
  offHoursBehavior: OffHoursBehavior;
  lastHealth: ChannelHealth | null;
  /** Agents limited to this channel ([USU-17]). */
  memberIds: string[];
  /** Whether credentials are stored; they are never returned ([CAN-17], [SEG-02]). */
  hasSecrets: boolean;
  createdAt: Date;
};

async function loadChannel(executor: Executor, channelId: unknown) {
  const id = idSchema.safeParse(channelId);
  if (!id.success) throw new NotFoundError("No se ha encontrado el canal.");
  const [row] = await executor.select().from(channels).where(eq(channels.id, id.data));
  if (!row) throw new NotFoundError("No se ha encontrado el canal.");
  return row;
}

export async function getChannel(actor: Actor, channelId: string): Promise<ChannelDetail> {
  assertCan(actor, PERMISSIONS.channels.view);
  const channel = await loadChannel(db, channelId);
  const [agent] = channel.activeAgentId ? await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.id, channel.activeAgentId)) : [];
  const members = await db.select({ userId: channelMembers.userId }).from(channelMembers).where(eq(channelMembers.channelId, channel.id));
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    status: channel.status,
    isDemo: channel.isDemo,
    activeAgent: agent ?? null,
    aiEnabled: channel.aiEnabled,
    testMode: channel.testMode,
    replyMode: channel.replyMode,
    lastInboundAt: channel.lastInboundAt,
    capabilities: defaultCapabilitiesOf(channel),
    config: channel.config,
    webchat: channel.type === "webchat" ? readWebchatConfig(channel.config) : null,
    testAllowlist: channel.testAllowlist,
    disclosureMessage: channel.disclosureMessage,
    offHoursBehavior: channel.offHoursBehavior,
    lastHealth: channel.lastHealth,
    memberIds: members.map((member) => member.userId),
    hasSecrets: Boolean(channel.secretsEnc),
    createdAt: channel.createdAt,
  };
}

// ─── Web chat ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The web chat settings sent by a form. The logo is never chosen by key: it only changes by uploading a file
 * (src/data/webchat-logo.ts), so a key typed into a request can never make another file the chat's public logo
 * ([MED-08]). `currentLogoKey` is the one the chat already has (null for a new chat).
 */
function parseWebchatConfig(input: unknown, currentLogoKey: string | null): WebchatConfig {
  const config = parseInput(webchatConfigSchema, input ?? {});
  if (config.logoFileKey && (config.logoFileKey !== currentLogoKey || !isValidFileKey(config.logoFileKey))) {
    throw new ValidationError(undefined, { logoFileKey: ["Logo no válido."] });
  }
  return config;
}

async function assertAgentExists(executor: Executor, agentId: string | null | undefined): Promise<void> {
  if (!agentId) return;
  const [agent] = await executor.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new ValidationError(undefined, { activeAgentId: ["Ese agente no existe."] });
}

export const createWebchatSchema = z
  .object({
    name: z.string().trim().min(1, "Escribe el nombre.").max(MAX_NAME, `Como mucho ${MAX_NAME} caracteres.`),
    activeAgentId: idSchema.nullable().optional(),
    aiEnabled: z.boolean().default(true),
    config: z.unknown().optional(),
  })
  .strict();

/** A new web chat, ready to paste in the business's site ([WEB-01]); automatic replies by default ([CAN-07]). */
export async function createWebchatChannel(actor: Actor, input: unknown): Promise<{ id: string }> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const data = parseInput(createWebchatSchema, input);
  const config = parseWebchatConfig(data.config, null);
  return db.transaction(async (tx) => {
    await assertAgentExists(tx, data.activeAgentId);
    const [row] = await tx
      .insert(channels)
      .values({ type: "webchat", name: data.name, status: "connected", config, activeAgentId: data.activeAgentId ?? null, aiEnabled: data.aiEnabled, replyMode: "auto" })
      .returning({ id: channels.id });
    await writeAudit({ actor, action: "channel.created", targetType: "channel", targetId: row.id, metadata: { type: "webchat" } }, tx);
    return row;
  });
}

/** The web chat's look, texts, domains and optional voice and images ([WEB-02], [WEB-07], [WEB-10]). */
export async function updateWebchatConfig(actor: Actor, channelId: string, input: unknown): Promise<WebchatConfig> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadChannel(db, channelId);
  if (channel.type !== "webchat") throw new ValidationError("Este canal no es un chat web.");
  const logoFileKey = readWebchatConfig(channel.config).logoFileKey;
  // The logo stays as it is: it only changes through saveWebchatLogo / removeWebchatLogo.
  const config = { ...parseWebchatConfig(input, logoFileKey), logoFileKey };
  await db.update(channels).set({ config: { ...channel.config, ...config }, updatedAt: new Date() }).where(eq(channels.id, channel.id));
  await writeAudit({ actor, action: "channel.configured", targetType: "channel", targetId: channel.id, metadata: { fields: Object.keys(config) } });
  return config;
}

// ─── Common settings of every channel ────────────────────────────────────────────────────────────────────

export const channelUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Escribe el nombre.").max(MAX_NAME, `Como mucho ${MAX_NAME} caracteres.`).optional(),
    /** false = «Desactivado»: it neither answers nor sends and keeps its history ([CAN-16]). */
    enabled: z.boolean().optional(),
    aiEnabled: z.boolean().optional(),
    testMode: z.boolean().optional(),
    testAllowlist: z.array(z.string().trim().min(1).max(254)).max(MAX_TEST_ALLOWLIST, `Como mucho ${MAX_TEST_ALLOWLIST} contactos.`).optional(),
    replyMode: z.enum(REPLY_MODES).optional(),
    disclosureMessage: optionalText(1_000),
    offHoursBehavior: z.enum(OFF_HOURS_BEHAVIORS).optional(),
  })
  .strict();
export type ChannelUpdateInput = z.input<typeof channelUpdateSchema>;

/** Name, on/off, AI switch, test mode and its list, reply mode, AI notice and off-hours behaviour ([CAN-04]–[CAN-08]). */
export async function updateChannel(actor: Actor, channelId: string, input: unknown): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  const channel = await loadChannel(db, channelId);
  const { enabled, testAllowlist, ...data } = parseInput(channelUpdateSchema, input);
  const status: ChannelStatus | undefined =
    enabled === undefined ? undefined : !enabled ? "disabled" : channel.status !== "disabled" ? channel.status : channel.type === "webchat" || channel.isDemo ? "connected" : "connecting";
  const values = {
    ...data,
    ...(testAllowlist !== undefined ? { testAllowlist: [...new Set(testAllowlist)] } : {}),
    ...(status !== undefined ? { status } : {}),
  };
  if (Object.keys(values).length === 0) return;
  await db.update(channels).set({ ...values, updatedAt: new Date() }).where(eq(channels.id, channel.id));
  await writeAudit({ actor, action: "channel.updated", targetType: "channel", targetId: channel.id, metadata: { fields: Object.keys(values) } });
}

// ─── Active agent ([CAN-03]–[CAN-05], [AGE-10]) ─────────────────────────────────────────────────────────

/** Writes the channel's active agent and logs it. Shared by the channel card and the agent's Canales tab. */
export async function applyActiveAgent(tx: Executor, actor: Actor, channelId: string, previousAgentId: string | null, nextAgentId: string | null): Promise<void> {
  if (previousAgentId === nextAgentId) return;
  await tx.update(channels).set({ activeAgentId: nextAgentId, updatedAt: new Date() }).where(eq(channels.id, channelId));
  await writeAudit(
    { actor, action: "channel.agent_changed", targetType: "channel", targetId: channelId, metadata: { agentId: nextAgentId, previousAgentId } },
    tx,
  );
}

export const setActiveAgentSchema = z
  .object({
    channelId: idSchema,
    /** null = no agent: only people answer ([CAN-03]). */
    agentId: idSchema.nullable(),
    /** The person confirmed «Sustituirá a …». */
    confirmReplace: z.boolean().optional(),
  })
  .strict();

export type SetActiveAgentResult =
  /** Another agent answers here: nothing changed until the person confirms. */
  | { status: "needs_confirmation"; previousAgent: { id: string; name: string } }
  | { status: "changed" | "unchanged"; previousAgent: { id: string; name: string } | null };

/**
 * At most one active agent per channel. Replacing one returns it first so the screen can ask «Sustituirá a …»; with
 * `confirmReplace` it changes. Only messages that arrive afterwards are affected ([CAN-05]).
 */
export async function setActiveAgent(actor: Actor, input: unknown): Promise<SetActiveAgentResult> {
  const data = parseInput(setActiveAgentSchema, input);
  assertCan(actor, PERMISSIONS.channels.manage, { channelId: data.channelId });
  return db.transaction(async (tx): Promise<SetActiveAgentResult> => {
    const channel = await loadChannel(tx, data.channelId);
    await assertAgentExists(tx, data.agentId);
    const [previous] = channel.activeAgentId ? await tx.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.id, channel.activeAgentId)) : [];
    if (channel.activeAgentId === data.agentId) return { status: "unchanged", previousAgent: previous ?? null };
    if (previous && data.agentId && !data.confirmReplace) return { status: "needs_confirmation", previousAgent: previous };
    await applyActiveAgent(tx, actor, channel.id, channel.activeAgentId, data.agentId);
    return { status: "changed", previousAgent: previous ?? null };
  });
}

// ─── Members ([USU-17], [PER-02]) ───────────────────────────────────────────────────────────────────────

export const setChannelMembersSchema = z.object({ channelId: idSchema, userIds: z.array(idSchema).max(200) }).strict();

/** The people with the Agent role limited to this channel. Other roles see every channel anyway. */
export async function setChannelMembers(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(setChannelMembersSchema, input);
  assertCan(actor, PERMISSIONS.channels.manage);
  assertCan(actor, PERMISSIONS.settings.users);
  const userIds = [...new Set(data.userIds)];
  await db.transaction(async (tx) => {
    const channel = await loadChannel(tx, data.channelId);
    if (userIds.length > 0) {
      const roles = await tx.select({ userId: userRoles.userId, role: userRoles.role }).from(userRoles).where(inArray(userRoles.userId, userIds));
      if (roles.length !== userIds.length || roles.some((row) => row.role !== "agent")) {
        throw new ValidationError(undefined, { userIds: ["Solo se asignan canales a personas con el rol Agente."] });
      }
    }
    await tx.delete(channelMembers).where(eq(channelMembers.channelId, channel.id));
    if (userIds.length > 0) await tx.insert(channelMembers).values(userIds.map((userId) => ({ userId, channelId: channel.id })));
    await writeAudit({ actor, action: "channel.members_changed", targetType: "channel", targetId: channel.id, metadata: { members: userIds.length } }, tx);
  });
}

// ─── Delete ([CAN-16]) ──────────────────────────────────────────────────────────────────────────────────

/** Only a channel without conversations can be deleted; the others are disconnected or disabled. */
export async function deleteChannel(actor: Actor, channelId: string): Promise<void> {
  assertCan(actor, PERMISSIONS.channels.manage);
  await db.transaction(async (tx) => {
    const channel = await loadChannel(tx, channelId);
    const [{ n }] = await tx.select({ n: count() }).from(conversations).where(eq(conversations.channelId, channel.id));
    if (n > 0) throw new ConflictError("Este canal tiene conversaciones: desactívalo en lugar de borrarlo, así conservas su historial.");
    // Children first: nothing relies on cascades.
    await tx.delete(channelMembers).where(eq(channelMembers.channelId, channel.id));
    await tx.delete(whatsappTemplates).where(eq(whatsappTemplates.channelId, channel.id));
    await tx.update(webhookEvents).set({ channelId: null }).where(eq(webhookEvents.channelId, channel.id));
    await tx.update(notifications).set({ channelId: null }).where(eq(notifications.channelId, channel.id));
    await tx.update(consents).set({ channelId: null }).where(eq(consents.channelId, channel.id));
    await tx.update(oauthStates).set({ channelId: null }).where(eq(oauthStates.channelId, channel.id));
    await tx.delete(channels).where(eq(channels.id, channel.id));
    await writeAudit({ actor, action: "channel.deleted", targetType: "channel", targetId: channel.id, metadata: { type: channel.type } }, tx);
  });
}

