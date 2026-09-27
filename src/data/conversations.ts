// Bandeja (reads): the conversations of every channel the person may see, with filters, search and unread counts
// ([BAN-01]–[BAN-03], [BAN-10], [BAN-12], [TRA-07]), and one conversation with what its header needs. Agents only
// see their channels ([PER-02]); «Probar agente» conversations never appear ([PRU-05]). Changes are in
// conversation-actions.ts.
import "server-only";
import { aliasedTable, and, count, desc, eq, exists, gt, inArray, isNotNull, isNull, like, lt, lte, ne, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents, channels, contacts, conversations, handoffEvents, messages, user } from "@/db/schema";
import { CONVERSATION_STATUSES, type ChannelType, type ConversationStatus, type HandoffTrigger, type MessageContentType, type SenderType, type Urgency } from "@/lib/enums";
import { channelFilter, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema, labelSchema, MAX_LABELS } from "@/lib/validation";
import { defaultCapabilitiesOf } from "@/server/channels/capabilities";
import type { ChannelCapabilities } from "@/server/channels/types";
import { WINDOW_24H_MS } from "@/server/engine/checks";
import { parseInput } from "@/server/errors";
import { listActiveTeam } from "@/server/team";
import { eligibleAssignees, openHandoffOf } from "@/server/handoff/service";
import { loadConversationFor } from "./conversation-scope";
import { assertCan } from "./guard";

const PREVIEW_CHARS = 140;
const DEFAULT_PAGE_SIZE = 30;

export const conversationFiltersSchema = z
  .object({
    channelId: idSchema.optional(),
    status: z.enum(CONVERSATION_STATUSES).optional(),
    /** «me», «unassigned» or a person's id. */
    assignee: z.union([z.literal("me"), z.literal("unassigned"), idSchema]).optional(),
    /** ai = the AI answers now; human = a person (AI off or hand-off); paused = AI paused for a while ([BAN-02]). */
    mode: z.enum(["ai", "human", "paused"]).optional(),
    unread: z.boolean().optional(),
    /** Any of these labels. */
    labels: z.array(labelSchema).max(MAX_LABELS).optional(),
    /** Contact name, phone or email, or message text. */
    search: z.string().trim().max(100, "Como mucho 100 caracteres.").optional(),
    /** From the previous page. */
    cursor: z
      .string()
      .regex(/^\d{1,15}:[0-9a-f-]{36}$/)
      .optional(),
    limit: z.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  })
  .strict();
export type ConversationFilters = z.input<typeof conversationFiltersSchema>;

export type ChannelRef = { id: string; name: string; type: ChannelType };
export type PersonRef = { id: string; name: string };

export type ConversationListItem = {
  id: string;
  channel: ChannelRef;
  contact: { id: string; name: string | null } | null;
  status: ConversationStatus;
  /** Effective mode: «human» while handed off or with the AI off. */
  aiMode: "ai" | "human";
  /** Only while the pause lasts ([BAN-11]). */
  aiPausedUntil: Date | null;
  pauseReason: string | null;
  assignedUser: PersonRef | null;
  labels: string[];
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessage: { preview: string | null; contentType: MessageContentType; direction: "inbound" | "outbound"; senderType: SenderType; createdAt: Date } | null;
  /** Open urgent hand-off: highlighted in the list ([TRA-07]). */
  urgent: boolean;
};

export type ConversationPage = { items: ConversationListItem[]; nextCursor: string | null };

const assignee = aliasedTable(user, "assignee");

function scopeConditions(actor: Actor): SQL[] | null {
  const scoped = channelFilter(actor);
  if (scoped && scoped.length === 0) return null;
  return [eq(conversations.isTest, false), isNotNull(conversations.channelId), ...(scoped ? [inArray(conversations.channelId, [...scoped])] : [])];
}

function modeCondition(mode: "ai" | "human" | "paused", now: Date): SQL | undefined {
  if (mode === "paused") return and(eq(conversations.aiMode, "ai"), gt(conversations.aiPausedUntil, now));
  if (mode === "human") return or(eq(conversations.aiMode, "human"), eq(conversations.status, "pending_human"));
  return and(eq(conversations.aiMode, "ai"), ne(conversations.status, "pending_human"), or(isNull(conversations.aiPausedUntil), lte(conversations.aiPausedUntil, now)));
}

/** Labels are a JSON array in text: a quoted label inside it matches (portable LIKE, no JSON functions). */
const hasLabel = (label: string) => like(conversations.labels, `%${JSON.stringify(label)}%`);

function searchCondition(search: string): SQL | undefined {
  const pattern = `%${search}%`;
  return or(
    like(contacts.name, pattern),
    like(contacts.phone, pattern),
    like(contacts.email, pattern),
    exists(db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conversations.id), like(messages.text, pattern)))),
  );
}

function preview(text: string | null): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

/** Bandeja: one page of conversations, newest activity first ([BAN-01], [BAN-02]). */
export async function listConversations(actor: Actor, input: unknown = {}): Promise<ConversationPage> {
  assertCan(actor, PERMISSIONS.inbox.view);
  const filters = parseInput(conversationFiltersSchema, input);
  const scope = scopeConditions(actor);
  if (!scope) return { items: [], nextCursor: null };
  const now = new Date();
  const conditions: SQL[] = [...scope];
  if (filters.channelId) conditions.push(eq(conversations.channelId, filters.channelId));
  if (filters.status) conditions.push(eq(conversations.status, filters.status));
  if (filters.assignee === "me") conditions.push(eq(conversations.assignedUserId, actor.userId));
  else if (filters.assignee === "unassigned") conditions.push(isNull(conversations.assignedUserId));
  else if (filters.assignee) conditions.push(eq(conversations.assignedUserId, filters.assignee));
  if (filters.mode) conditions.push(modeCondition(filters.mode, now) as SQL);
  if (filters.unread) conditions.push(gt(conversations.unreadCount, 0));
  if (filters.labels?.length) conditions.push(or(...filters.labels.map(hasLabel)) as SQL);
  if (filters.search) conditions.push(searchCondition(filters.search) as SQL);
  if (filters.cursor) {
    const [at, id] = [Number(filters.cursor.slice(0, filters.cursor.indexOf(":"))), filters.cursor.slice(filters.cursor.indexOf(":") + 1)];
    const atDate = new Date(at);
    conditions.push(or(lt(conversations.lastMessageAt, atDate), and(eq(conversations.lastMessageAt, atDate), lt(conversations.id, id))) as SQL);
  }

  const rows = await db
    .select({
      id: conversations.id,
      channelId: channels.id,
      channelName: channels.name,
      channelType: channels.type,
      contactId: contacts.id,
      contactName: contacts.name,
      status: conversations.status,
      aiMode: conversations.aiMode,
      aiPausedUntil: conversations.aiPausedUntil,
      pauseReason: conversations.pauseReason,
      assignedUserId: assignee.id,
      assignedUserName: assignee.name,
      labels: conversations.labels,
      unreadCount: conversations.unreadCount,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(assignee, eq(assignee.id, conversations.assignedUserId))
    .where(and(...conditions))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(filters.limit + 1);

  const page = rows.slice(0, filters.limit);
  const ids = page.map((row) => row.id);
  const [lastMessages, urgent] = await Promise.all([
    Promise.all(
      ids.map(async (id) => {
        const [last] = await db
          .select({ text: messages.text, contentType: messages.contentType, direction: messages.direction, senderType: messages.senderType, createdAt: messages.createdAt })
          .from(messages)
          .where(eq(messages.conversationId, id))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(1);
        return [id, last] as const;
      }),
    ),
    ids.length > 0
      ? db
          .select({ conversationId: handoffEvents.conversationId })
          .from(handoffEvents)
          .where(
            and(inArray(handoffEvents.conversationId, ids), eq(handoffEvents.urgency, "high"), isNull(handoffEvents.firstHumanResponseAt), isNull(handoffEvents.closedAt)),
          )
      : Promise.resolve([]),
  ]);
  const lastById = new Map(lastMessages);
  const urgentIds = new Set(urgent.map((row) => row.conversationId));

  const items: ConversationListItem[] = page.map((row) => {
    const last = lastById.get(row.id);
    const paused = row.aiPausedUntil && row.aiPausedUntil > now ? row.aiPausedUntil : null;
    return {
      id: row.id,
      channel: { id: row.channelId, name: row.channelName, type: row.channelType },
      contact: row.contactId ? { id: row.contactId, name: row.contactName } : null,
      status: row.status,
      aiMode: row.aiMode === "human" || row.status === "pending_human" ? "human" : "ai",
      aiPausedUntil: paused,
      pauseReason: paused || row.aiMode === "human" || row.status === "pending_human" ? row.pauseReason : null,
      assignedUser: row.assignedUserId && row.assignedUserName ? { id: row.assignedUserId, name: row.assignedUserName } : null,
      labels: row.labels,
      unreadCount: row.unreadCount,
      lastMessageAt: row.lastMessageAt,
      lastMessage: last ? { ...last, preview: preview(last.text) } : null,
      urgent: urgentIds.has(row.id),
    };
  });
  const lastRow = page.at(-1);
  const nextCursor = rows.length > filters.limit && lastRow?.lastMessageAt ? `${lastRow.lastMessageAt.getTime()}:${lastRow.id}` : null;
  return { items, nextCursor };
}

export type InboxCounts = {
  /** Conversations with unread messages ([BAN-03]). */
  unreadConversations: number;
  pendingHuman: number;
  /** Assigned to me and not resolved. */
  mine: number;
};

/** Counters of the inbox tabs and the menu badge. */
export async function getInboxCounts(actor: Actor): Promise<InboxCounts> {
  assertCan(actor, PERMISSIONS.inbox.view);
  const scope = scopeConditions(actor);
  if (!scope) return { unreadConversations: 0, pendingHuman: 0, mine: 0 };
  const countWhere = async (condition: SQL) => {
    const [row] = await db.select({ n: count() }).from(conversations).where(and(...scope, condition));
    return row?.n ?? 0;
  };
  const [unreadConversations, pendingHuman, mine] = await Promise.all([
    countWhere(gt(conversations.unreadCount, 0)),
    countWhere(eq(conversations.status, "pending_human")),
    countWhere(and(eq(conversations.assignedUserId, actor.userId), ne(conversations.status, "resolved")) as SQL),
  ]);
  return { unreadConversations, pendingHuman, mine };
}

export type OpenHandoff = { id: string; trigger: HandoffTrigger; rule: string | null; reason: string | null; summary: string | null; urgency: Urgency; requestedAt: Date };

export type ConversationDetail = Omit<ConversationListItem, "lastMessage" | "urgent"> & {
  channel: ChannelRef & { status: string; capabilities: ChannelCapabilities; isDemo: boolean };
  contact: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  /** Agent that answers here: the conversation's own ([AGE-14]) or the channel's active one. */
  agent: PersonRef | null;
  agentOverride: PersonRef | null;
  /** The hand-off waiting for a person: reason, summary and urgency ([TRA-07]). */
  openHandoff: OpenHandoff | null;
  /** WhatsApp 24 h window ([BAN-08]); null when the channel has none. */
  window: { open: boolean; closesAt: Date | null } | null;
  summary: string | null;
  lastInboundAt: Date | null;
  createdAt: Date;
};

/** One conversation for its screen. «Sin permiso» when it does not exist or is not the person's ([PER-02]). */
export async function getConversation(actor: Actor, conversationId: string): Promise<ConversationDetail> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, conversationId);
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  const [contact] = conversation.contactId
    ? await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email }).from(contacts).where(eq(contacts.id, conversation.contactId))
    : [];
  const [assigned] = conversation.assignedUserId
    ? await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, conversation.assignedUserId))
    : [];
  const effectiveAgentId = conversation.agentOverrideId ?? channel.activeAgentId;
  const agentRows = effectiveAgentId
    ? await db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, [effectiveAgentId, conversation.agentOverrideId ?? effectiveAgentId]))
    : [];
  const [openHandoff] = await db
    .select({
      id: handoffEvents.id,
      trigger: handoffEvents.trigger,
      rule: handoffEvents.rule,
      reason: handoffEvents.reason,
      summary: handoffEvents.summary,
      urgency: handoffEvents.urgency,
      requestedAt: handoffEvents.requestedAt,
    })
    .from(handoffEvents)
    .where(openHandoffOf(conversation.id))
    .orderBy(desc(handoffEvents.requestedAt))
    .limit(1);

  const now = new Date();
  const capabilities = defaultCapabilitiesOf(channel);
  const closesAt = conversation.lastInboundAt ? new Date(conversation.lastInboundAt.getTime() + WINDOW_24H_MS) : null;
  const paused = conversation.aiPausedUntil && conversation.aiPausedUntil > now ? conversation.aiPausedUntil : null;
  const human = conversation.aiMode === "human" || conversation.status === "pending_human";
  return {
    id: conversation.id,
    channel: { id: channel.id, name: channel.name, type: channel.type, status: channel.status, capabilities, isDemo: channel.isDemo },
    contact: contact ?? null,
    status: conversation.status,
    aiMode: human ? "human" : "ai",
    aiPausedUntil: paused,
    pauseReason: paused || human ? conversation.pauseReason : null,
    assignedUser: assigned ?? null,
    labels: conversation.labels,
    unreadCount: conversation.unreadCount,
    lastMessageAt: conversation.lastMessageAt,
    agent: agentRows.find((row) => row.id === effectiveAgentId) ?? null,
    agentOverride: conversation.agentOverrideId ? (agentRows.find((row) => row.id === conversation.agentOverrideId) ?? null) : null,
    openHandoff: openHandoff ?? null,
    window: capabilities.window24h ? { open: closesAt !== null && closesAt > now, closesAt } : null,
    summary: conversation.summary,
    lastInboundAt: conversation.lastInboundAt,
    createdAt: conversation.createdAt,
  };
}

/** People a conversation can be assigned to: those who may answer its channel, never Solo lectura ([TRA-04]). */
export async function listAssignableUsers(actor: Actor, conversationId: string): Promise<PersonRef[]> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.assign, conversationId);
  return eligibleAssignees(await listActiveTeam(), conversation.channelId).map((member) => ({ id: member.userId, name: member.name }));
}
