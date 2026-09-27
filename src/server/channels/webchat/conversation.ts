// The visitor's side of the web chat ([WEB-04], [WEB-06], [WEB-11]): their conversation is always found from the
// visitor id of their signed token (never from an id the browser sends), and only what reached them is shown:
// their own messages and the business's sent replies (no drafts, failed sends, notes or internal data).
import "server-only";
import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { getPublicBusinessInfo } from "@/data/business";
import { db } from "@/db";
import { contactIdentities, conversations, jobs, messages } from "@/db/schema";
import { getRealtime } from "@/server/adapters/realtime";
import { replyDedupeKey } from "@/server/engine/schedule";
import { widgetTopic } from "@/server/realtime/events";
import type { ChannelRecord } from "../types";
import { issueVisitorToken, verifyVisitorToken } from "./tokens";

/** Messages shown when the chat opens; older ones stay in the inbox. */
export const WIDGET_HISTORY_LIMIT = 50;
/** Business messages the visitor has received (queued, draft and failed ones never reached them). */
const DELIVERED = ["sent", "delivered", "read", "played"] as const;
const AI_AUTHOR = "Asistente IA";
const TEAM_AUTHOR = "Equipo";

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

export type WidgetMessage = {
  id: string;
  /** The id the widget chose for the visitor's own message (to match its bubble); null for the business's. */
  clientId: string | null;
  from: "visitor" | "business";
  /** «Asistente IA», the person's name, or the business for system messages; null for the visitor. */
  author: string | null;
  kind: "text" | "image" | "audio" | "file";
  text: string | null;
  /** Opened through /api/widget/<channel>/media/<key> with the visitor's token. */
  media: { key: string; mimeType: string } | null;
  createdAt: string;
};

export type WidgetState = {
  /** A reply is on its way («Escribiendo…»). */
  typing: boolean;
  /** Waiting for a person after a hand-off («Una persona te atenderá pronto»). */
  handedOff: boolean;
};

const IDLE: WidgetState = { typing: false, handedOff: false };

const visibleToVisitor = or(eq(messages.direction, "inbound"), and(eq(messages.direction, "outbound"), inArray(messages.status, [...DELIVERED])));

/** The visitor's conversation in this channel (one per channel and contact, [CAN-12]), or null before they write. */
export async function findVisitorConversation(channelId: string, visitorId: string): Promise<ConversationRow | null> {
  const [row] = await db
    .select({ conversation: conversations })
    .from(contactIdentities)
    .innerJoin(conversations, and(eq(conversations.contactId, contactIdentities.contactId), eq(conversations.channelId, channelId), eq(conversations.isTest, false)))
    .where(and(eq(contactIdentities.channelType, "webchat"), eq(contactIdentities.externalId, visitorId)))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  return row?.conversation ?? null;
}

function kindOf(row: Pick<MessageRow, "contentType" | "media">): WidgetMessage["kind"] {
  if (!row.media?.fileKey) return "text";
  if (row.contentType === "image" || row.contentType === "sticker") return "image";
  if (row.contentType === "audio") return "audio";
  return "file";
}

function authorOf(row: Pick<MessageRow, "direction" | "senderType" | "senderName">, businessName: string): string | null {
  if (row.direction === "inbound") return null;
  if (row.senderType === "ai") return AI_AUTHOR;
  if (row.senderType === "human") return row.senderName?.trim() || TEAM_AUTHOR;
  return businessName;
}

function toWidgetMessage(row: MessageRow, businessName: string): WidgetMessage {
  const media = row.media?.fileKey && row.media.downloadStatus !== "failed" ? { key: row.media.fileKey, mimeType: row.media.mimeType ?? "application/octet-stream" } : null;
  return {
    id: row.id,
    clientId: row.direction === "inbound" ? row.externalId : null,
    from: row.direction === "inbound" ? "visitor" : "business",
    author: authorOf(row, businessName),
    kind: kindOf(row),
    text: row.text,
    media,
    createdAt: row.createdAt.toISOString(),
  };
}

async function toWidgetMessages(rows: MessageRow[]): Promise<WidgetMessage[]> {
  if (rows.length === 0) return [];
  const businessName = (await getPublicBusinessInfo()).name.trim();
  return rows.map((row) => toWidgetMessage(row, businessName));
}

/** The latest messages the visitor can see, oldest first. */
async function history(conversationId: string): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), visibleToVisitor))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(WIDGET_HISTORY_LIMIT);
  return rows.reverse();
}

/** «Escribiendo…» while the AI may answer and its reply job is waiting or running; the hand-off notice. */
export async function conversationState(channel: ChannelRecord, conversation: ConversationRow, now: Date): Promise<WidgetState> {
  const [lastReply] = await db
    .select({ senderType: messages.senderType })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "outbound"), inArray(messages.status, [...DELIVERED])))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  const handedOff = conversation.status === "pending_human" && lastReply?.senderType !== "human";

  const paused = conversation.aiPausedUntil !== null && conversation.aiPausedUntil.getTime() > now.getTime();
  const aiMayAnswer =
    channel.aiEnabled && Boolean(conversation.agentOverrideId ?? channel.activeAgentId) && conversation.status !== "pending_human" && conversation.aiMode === "ai" && !paused;
  if (!aiMayAnswer) return { typing: false, handedOff };
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.dedupeKey, replyDedupeKey(conversation.id)), inArray(jobs.status, ["pending", "running"])))
    .limit(1);
  return { typing: Boolean(job), handedOff };
}

export type VisitorSession = { visitorId: string; token: string; cursor: string; messages: WidgetMessage[]; state: WidgetState };

/**
 * Opens the chat: with a valid token, the same visitor and their latest messages ([WEB-04]); otherwise a new
 * anonymous visitor created here (nothing is stored until they write). The cursor is read before the history, so
 * polling never misses a message (it may repeat one, and the widget merges by id).
 */
export async function openVisitorSession(channel: ChannelRecord, token: unknown, now: Date = new Date()): Promise<VisitorSession> {
  const known = verifyVisitorToken(token, channel.id, now);
  const visitorId = known?.visitorId ?? crypto.randomUUID();
  const { cursor } = await getRealtime().poll(null, []);
  const conversation = known ? await findVisitorConversation(channel.id, visitorId) : null;
  return {
    visitorId,
    token: issueVisitorToken({ channelId: channel.id, visitorId }, now),
    cursor,
    messages: conversation ? await toWidgetMessages(await history(conversation.id)) : [],
    state: conversation ? await conversationState(channel, conversation, now) : IDLE,
  };
}

const messageEvent = z.object({ messageId: z.string() });

export type VisitorPoll = { cursor: string; messages: WidgetMessage[]; state: WidgetState };

/** What changed in the visitor's conversation after `cursor` (new messages and replies that were sent). */
export async function pollVisitor(channel: ChannelRecord, visitorId: string, cursor: string, now: Date = new Date()): Promise<VisitorPoll> {
  const conversation = await findVisitorConversation(channel.id, visitorId);
  if (!conversation) return { cursor, messages: [], state: IDLE };
  const result = await getRealtime().poll(cursor, [widgetTopic(conversation.id)]);
  const ids = [...new Set(result.events.map((event) => messageEvent.safeParse(event.payload)).flatMap((parsed) => (parsed.success ? [parsed.data.messageId] : [])))];
  const rows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(messages)
          .where(and(eq(messages.conversationId, conversation.id), inArray(messages.id, ids), visibleToVisitor))
          .orderBy(asc(messages.createdAt), asc(messages.id));
  return { cursor: result.cursor, messages: await toWidgetMessages(rows), state: await conversationState(channel, conversation, now) };
}

/** One of the visitor's own messages, for the answer to sending it. */
export async function visitorMessage(conversationId: string, messageId: string): Promise<WidgetMessage | null> {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
  return row ? (await toWidgetMessages([row]))[0] : null;
}

/** Whether `key` is a file of a message the visitor can see in their own conversation ([WEB-11], [MED-08]). */
export async function visitorCanReadFile(channelId: string, visitorId: string, key: string): Promise<boolean> {
  const conversation = await findVisitorConversation(channelId, visitorId);
  if (!conversation) return false;
  const rows = await db
    .select({ media: messages.media })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), visibleToVisitor, like(messages.media, `%${JSON.stringify(key)}%`)));
  // LIKE only narrows the search: the key must be exactly the message's file.
  return rows.some((row) => row.media?.fileKey === key);
}

