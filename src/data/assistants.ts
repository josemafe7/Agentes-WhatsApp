// «Asistentes» ([INT-05]–[INT-12], docs/decisions/0027): the internal agents a person of the team may use and the
// conversations they have with them. Every function works for the signed-in person only: there is no way here to
// read, continue or delete a conversation of somebody else, whatever their role ([INT-09]).
// The answer is produced inside the person's request, like «Probar agente»: no channel, no queue, no webhook.
import "server-only";
import { and, asc, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentMembers, agents, assistantChats, assistantMessages, knowledgeBases, type AssistantSource } from "@/db/schema";
import type { AssistantMessageRole } from "@/lib/enums";
import { toSingleLine } from "@/lib/format";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getRateLimiter, type RateLimiter } from "@/server/adapters/rate-limiter";
import { AiNotConfiguredError } from "@/server/ai/errors";
import { DEFAULT_HISTORY_MESSAGES } from "@/server/ai/prompt";
import { runAgent, TEAM_REFUSAL_REPLY, type AgentRetrieval, type RunAgentDeps } from "@/server/ai/run-agent";
import { NotFoundError, parseInput, RateLimitError } from "@/server/errors";
import { storableText } from "@/server/storable-text";
import { seesInternalAgents } from "./agent-audience";
import { canUseInternalAgent, type Agent } from "./agents";
import { assertCan } from "./guard";
import { isAiConfigured } from "./settings";

const ASSISTANT_NOT_FOUND = "No se ha encontrado el asistente.";
const CHAT_NOT_FOUND = "No se ha encontrado la conversación.";

/** Longest question a person can send. */
export const MAX_QUESTION_CHARS = 4_000;
const MAX_TITLE_CHARS = 80;
/** Conversations listed per assistant at a time, newest first; «Cargar más» brings the next ones ([INT-10]). */
export const CHATS_PAGE_SIZE = 50;
/** Messages of a conversation shown at a time, the last ones first; «Cargar mensajes anteriores» brings the rest. */
export const MESSAGES_PAGE_SIZE = 200;

/** Questions per person ([INT-12]): each one spends AI ([SEG-07]). */
export const ASSISTANT_LIMITS = {
  perMinute: { limit: 20, windowMs: 60_000 },
  perDay: { limit: 200, windowMs: 24 * 60 * 60_000 },
} as const;
const TOO_FAST = "Has hecho muchas preguntas seguidas. Espera un minuto y vuelve a intentarlo.";
const DAILY_LIMIT = "Has llegado al máximo de preguntas de hoy a los asistentes. Mañana podrás seguir.";

/** The limit of the day ([INT-12]): unlike the one of the minute, asking again in a while does not help. */
export class AssistantDailyLimitError extends RateLimitError {
  constructor() {
    super(DAILY_LIMIT);
  }
}

export type AssistantItem = { id: string; name: string; description: string | null; avatarFileKey: string | null };
export type AssistantChatItem = { id: string; title: string; updatedAt: Date };
export type AssistantMessageItem = { id: string; role: AssistantMessageRole; content: string; sources: AssistantSource[]; createdAt: Date };
/** A page of a person's conversations with one assistant; `hasMore`: there are older ones to ask for. */
export type AssistantChatPage = { chats: AssistantChatItem[]; hasMore: boolean };
/** A page of a conversation's messages, oldest first; `hasEarlier`: there are messages before these. */
export type AssistantMessagePage = { messages: AssistantMessageItem[]; hasEarlier: boolean };

const toItem = (agent: Pick<Agent, "id" | "name" | "description" | "avatarFileKey">): AssistantItem => ({
  id: agent.id,
  name: agent.name,
  description: agent.description,
  avatarFileKey: agent.avatarFileKey,
});

// ─── Which assistants ([INT-05], [INT-06]) ──────────────────────────────────────────────────────────────

/** The internal agents this person may use, by name. */
export async function listMyAssistants(actor: Actor): Promise<AssistantItem[]> {
  assertCan(actor, PERMISSIONS.internal.use);
  const columns = { id: agents.id, name: agents.name, description: agents.description, avatarFileKey: agents.avatarFileKey };
  if (seesInternalAgents(actor)) {
    return db.select(columns).from(agents).where(eq(agents.audience, "team")).orderBy(asc(agents.name));
  }
  const mine = db.select({ agentId: agentMembers.agentId }).from(agentMembers).where(eq(agentMembers.userId, actor.userId));
  return db
    .select(columns)
    .from(agents)
    .where(and(eq(agents.audience, "team"), or(eq(agents.teamAccess, "everyone"), inArray(agents.id, mine))))
    .orderBy(asc(agents.name));
}

/** Whether «Asistentes» has anything for this person: the section is in their menu only then ([INT-06]). */
export async function hasAssistants(actor: Actor): Promise<boolean> {
  if (!can(actor, PERMISSIONS.internal.use)) return false;
  return (await listMyAssistants(actor)).length > 0;
}

/**
 * The internal agent, only if this person may use it. One they were not given does not exist for them: «not found»,
 * so its address says nothing ([INT-06]).
 */
async function loadUsableAgent(actor: Actor, agentId: unknown): Promise<Agent> {
  assertCan(actor, PERMISSIONS.internal.use);
  const id = idSchema.safeParse(agentId);
  if (!id.success) throw new NotFoundError(ASSISTANT_NOT_FOUND);
  const [agent] = await db.select().from(agents).where(eq(agents.id, id.data));
  if (!agent || !(await canUseInternalAgent(actor, agent))) throw new NotFoundError(ASSISTANT_NOT_FOUND);
  return agent;
}

export async function getMyAssistant(actor: Actor, agentId: unknown): Promise<AssistantItem> {
  return toItem(await loadUsableAgent(actor, agentId));
}

// ─── The person's conversations ([INT-09], [INT-10]) ────────────────────────────────────────────────────

/**
 * This person's conversations with one assistant, newest first and a page at a time ([INT-10]): `before` is the last
 * one already listed (one of theirs, or «not found»). However many there are, all can be reached, and so deleted.
 */
export async function listMyAssistantChats(actor: Actor, agentId: unknown, before?: unknown): Promise<AssistantChatPage> {
  const agent = await loadUsableAgent(actor, agentId);
  let older: SQL | undefined;
  if (before !== undefined) {
    const last = await loadMyChat(actor, before);
    if (last.agentId !== agent.id) throw new NotFoundError(CHAT_NOT_FOUND);
    older =or(lt(assistantChats.updatedAt, last.updatedAt), and(eq(assistantChats.updatedAt, last.updatedAt), lt(assistantChats.id, last.id)));
  }
  const rows = await db
    .select({ id: assistantChats.id, title: assistantChats.title, updatedAt: assistantChats.updatedAt })
    .from(assistantChats)
    .where(and(eq(assistantChats.agentId, agent.id), eq(assistantChats.userId, actor.userId), older))
    .orderBy(desc(assistantChats.updatedAt), desc(assistantChats.id))
    .limit(CHATS_PAGE_SIZE + 1);
  return { chats: rows.slice(0, CHATS_PAGE_SIZE), hasMore: rows.length > CHATS_PAGE_SIZE };
}

/** A conversation of this person, and never one of somebody else: the owner is part of the query ([INT-09]). */
async function loadMyChat(actor: Actor, chatId: unknown) {
  assertCan(actor, PERMISSIONS.internal.use);
  const id = idSchema.safeParse(chatId);
  if (!id.success) throw new NotFoundError(CHAT_NOT_FOUND);
  const [chat] = await db
    .select()
    .from(assistantChats)
    .where(and(eq(assistantChats.id, id.data), eq(assistantChats.userId, actor.userId)));
  if (!chat) throw new NotFoundError(CHAT_NOT_FOUND);
  return chat;
}

/** The last `limit` messages of a conversation, or the last ones before `before`; oldest first. */
async function lastMessages(chatId: string, limit: number, before?: { id: string; createdAt: Date }): Promise<AssistantMessageItem[]> {
  const earlier = before
    ? or(lt(assistantMessages.createdAt, before.createdAt), and(eq(assistantMessages.createdAt, before.createdAt), lt(assistantMessages.id, before.id)))
    : undefined;
  const rows = await db
    .select({
      id: assistantMessages.id,
      role: assistantMessages.role,
      content: assistantMessages.content,
      sources: assistantMessages.sources,
      createdAt: assistantMessages.createdAt,
    })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.chatId, chatId), earlier))
    .orderBy(desc(assistantMessages.createdAt), desc(assistantMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** A page of a conversation for the screen: one message more is read to know whether there are earlier ones. */
async function messagesPage(chatId: string, before?: { id: string; createdAt: Date }): Promise<AssistantMessagePage> {
  const rows = await lastMessages(chatId, MESSAGES_PAGE_SIZE + 1, before);
  return { messages: rows.slice(-MESSAGES_PAGE_SIZE), hasEarlier: rows.length > MESSAGES_PAGE_SIZE };
}

export type AssistantChatDetail = AssistantChatItem & { agentId: string } & AssistantMessagePage;

/**
 * One conversation of this person with its last messages. Without access to its assistant any more, it is not shown
 * ([INT-10]).
 */
export async function getMyAssistantChat(actor: Actor, chatId: unknown): Promise<AssistantChatDetail> {
  const chat = await loadMyChat(actor, chatId);
  await loadUsableAgent(actor, chat.agentId);
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, agentId: chat.agentId, ...(await messagesPage(chat.id)) };
}

/** The messages of one of this person's conversations that come before `before`, a message of it already shown ([INT-10]). */
export async function listEarlierAssistantMessages(actor: Actor, chatId: unknown, before: unknown): Promise<AssistantMessagePage> {
  const chat = await loadMyChat(actor, chatId);
  await loadUsableAgent(actor, chat.agentId);
  const id = idSchema.safeParse(before);
  if (!id.success) throw new NotFoundError(CHAT_NOT_FOUND);
  const [from] = await db
    .select({ id: assistantMessages.id, createdAt: assistantMessages.createdAt })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.id, id.data), eq(assistantMessages.chatId, chat.id)));
  if (!from) throw new NotFoundError(CHAT_NOT_FOUND);
  return messagesPage(chat.id, from);
}

/** Deletes one conversation of this person, with its messages ([INT-10]). */
export async function deleteMyAssistantChat(actor: Actor, chatId: unknown): Promise<void> {
  const chat = await loadMyChat(actor, chatId);
  await db.transaction(async (tx) => {
    await tx.delete(assistantMessages).where(eq(assistantMessages.chatId, chat.id));
    await tx.delete(assistantChats).where(eq(assistantChats.id, chat.id));
  });
}

// ─── Asking ([INT-07], [INT-11], [INT-12]) ──────────────────────────────────────────────────────────────

export const askAssistantSchema = z
  .object({
    agentId: idSchema,
    /** The conversation it continues; null or missing starts a new one. */
    chatId: idSchema.nullable().optional(),
    text: z
      .string({ error: "Escribe tu pregunta." })
      .trim()
      .min(1, "Escribe tu pregunta.")
      .max(MAX_QUESTION_CHARS, `Como mucho ${MAX_QUESTION_CHARS.toLocaleString("es")} caracteres.`),
  })
  .strict();

async function enforceQuestionLimits(userId: string, limiter: RateLimiter): Promise<void> {
  const minute = await limiter.hit(`ai:assistant:${userId}`, ASSISTANT_LIMITS.perMinute.limit, ASSISTANT_LIMITS.perMinute.windowMs);
  if (!minute.allowed) throw new RateLimitError(TOO_FAST);
  const day = await limiter.hit(`ai:assistant_day:${userId}`, ASSISTANT_LIMITS.perDay.limit, ASSISTANT_LIMITS.perDay.windowMs);
  if (!day.allowed) throw new AssistantDailyLimitError();
}

/** The fragments of the answer as the person sees them: document, section and page, each once ([INT-07]). */
async function sourcesOf(retrievals: readonly AgentRetrieval[]): Promise<AssistantSource[]> {
  if (retrievals.length === 0) return [];
  const kbIds = [...new Set(retrievals.map((retrieval) => retrieval.kbId).filter((id): id is string => Boolean(id)))];
  const bases = kbIds.length > 0 ? await db.select({ id: knowledgeBases.id, name: knowledgeBases.name }).from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds)) : [];
  const names = new Map(bases.map((base) => [base.id, base.name]));
  const seen = new Set<string>();
  const sources: AssistantSource[] = [];
  for (const retrieval of [...retrievals].sort((a, b) => a.rank - b.rank)) {
    const source = { title: retrieval.title, section: retrieval.section, page: retrieval.page, knowledgeBase: retrieval.kbId ? (names.get(retrieval.kbId) ?? null) : null };
    const key = JSON.stringify(source);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

export type AskAssistantResult = { chat: AssistantChatItem; question: AssistantMessageItem; answer: AssistantMessageItem };
export type AskAssistantDeps = RunAgentDeps & { limiter?: RateLimiter };

/**
 * One question of this person to an internal agent and its one answer ([INT-07]). Nothing is stored unless there is
 * an answer: without a key ([INT-11]), over the limits ([INT-12]) or when the AI fails, the question is not sent and
 * the conversation stays as it was. Throws AiNotConfiguredError, RateLimitError or AgentRunError for those.
 */
export async function askAssistant(actor: Actor, input: unknown, deps: AskAssistantDeps = {}): Promise<AskAssistantResult> {
  const data = parseInput(askAssistantSchema, input);
  const agent = await loadUsableAgent(actor, data.agentId);
  const existing = data.chatId ? await loadMyChat(actor, data.chatId) : null;
  if (existing && existing.agentId !== agent.id) throw new NotFoundError(CHAT_NOT_FOUND);
  // Without a key the question is not sent and does not use up the person's limit ([INT-11]).
  if (!(await isAiConfigured())) throw new AiNotConfiguredError();
  await enforceQuestionLimits(actor.userId, deps.limiter ?? getRateLimiter());

  const text = storableText(data.text);
  const chatId = existing?.id ?? crypto.randomUUID();
  const earlier = existing ? await lastMessages(existing.id, DEFAULT_HISTORY_MESSAGES) : [];
  const result = await runAgent(
    {
      agent,
      history: [...earlier.map((message) => ({ role: message.role === "user" ? ("contact" as const) : ("ai" as const), text: message.content })), { role: "contact" as const, text }],
      mode: "live",
      // Whole pairs: the earlier questions with their answers and the new question, so what is sent never starts
      // with an answer whose question was left out.
      context: { sessionId: chatId, maxHistoryMessages: earlier.length + 1 },
    },
    deps,
  );
  // The model refused to answer: whatever it had looked up, the reply the person reads comes from no document.
  const sources = result.text === TEAM_REFUSAL_REPLY ? [] : await sourcesOf(result.retrievals);

  const askedAt = deps.now ?? new Date();
  // One millisecond later, so the pair keeps its order whatever the clock's precision.
  const answeredAt = new Date(askedAt.getTime() + 1);
  const title = existing?.title ?? (toSingleLine(text, MAX_TITLE_CHARS) || "Conversación");
  const [question, answer] = await db.transaction(async (tx) => {
    if (existing) {
      const kept = await tx.update(assistantChats).set({ updatedAt: answeredAt }).where(eq(assistantChats.id, chatId)).returning({ id: assistantChats.id });
      // Deleted while the answer was being written (another tab): there is nowhere to keep it.
      if (kept.length === 0) throw new NotFoundError(CHAT_NOT_FOUND);
    } else {
      await tx.insert(assistantChats).values({ id: chatId, agentId: agent.id, userId: actor.userId, title, createdAt: askedAt, updatedAt: answeredAt });
    }
    return tx
      .insert(assistantMessages)
      .values([
        { chatId, role: "user", content: text, sources: [], createdAt: askedAt, updatedAt: askedAt },
        { chatId, role: "assistant", content: result.text, sources, aiRunId: result.runId, createdAt: answeredAt, updatedAt: answeredAt },
      ])
      .returning({
        id: assistantMessages.id,
        role: assistantMessages.role,
        content: assistantMessages.content,
        sources: assistantMessages.sources,
        createdAt: assistantMessages.createdAt,
      });
  });
  return { chat: { id: chatId, title, updatedAt: answeredAt }, question, answer };
}
