// What the three connectors do with each email they read, after classifying it ([COR-16]–[COR-20]):
// - a customer's email → the common ingest pipeline (contact by the sender's address, one conversation per thread,
//   stored once, reply scheduled, [CAN-09]–[CAN-13]) as its text (quotes and signature removed, [COR-19]) plus one
//   message per attachment (images and PDFs go to the model, audio to transcription through src/server/media), then
//   the daily caps ([COR-17]). Each one keeps whether the server that received it vouched for its From ([COR-25]);
// - a person's reply from the mailbox → stored in its conversation as the person's message and the AI pauses there
//   ([COR-20], [BAN-11]);
// - our own sent copy → a mailbox draft the person sent from Gmail or Outlook is marked as sent ([COR-15]).
// Never calls the AI ([CAN-10]). System code.
import "server-only";
import { and, eq } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { conversations, messages, type MessageMedia } from "@/db/schema";
import type { MessageContentType } from "@/lib/enums";
import type { FileStorage } from "@/server/adapters/file-storage";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { replyDedupeKey } from "@/server/engine/schedule";
import { recordFirstHumanResponse } from "@/server/handoff/service";
import { ingestEvents } from "@/server/inbound/ingest";
import { messageSearchText } from "@/server/inbound/message-search";
import { baseMimeType, isPdf } from "@/server/media/limits";
import { MediaRejectedError, storeInboundMedia } from "@/server/media/store";
import { publishConversationEvent } from "@/server/realtime/events";
import type { ChannelRecord, InboundMessageEvent } from "../types";
import { senderVerification } from "./auth-results";
import { enforceDailyCaps, type DailyCap } from "./caps";
import { updateEmailConfig } from "./config";
import { MAX_EMAIL_TEXT, MAX_ORIGINAL_TEXT } from "./constants";
import type { EmailMetadataInput } from "./metadata";
import type { ParsedEmail } from "./parse";
import { stripQuotesAndSignature } from "./quotes";

const HOUR_MS = 60 * 60_000;
/** A Date header this far in the future is not trusted: the arrival time is used. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const MAILBOX_PAUSE_REASON = "Ha respondido una persona desde el buzón";
export const TOO_LARGE_TEXT = "Este correo es demasiado grande para leerlo aquí. Ábrelo en el buzón.";
export const DROPPED_NOTE = "[Adjuntos que no se han podido guardar por su tamaño o número]";

/** An email as a connector read it. */
export type IncomingEmail = {
  /** Unique in the channel: Gmail id, Graph immutable id, IMAP key. */
  providerId: string;
  threadId: string;
  parsed: ParsedEmail;
  receivedAt: Date;
  /** Outlook's uniqueBody: the text without the quoted history ([F44]). */
  quoteFreeText?: string | null;
  imap?: { folder: string; uid: number; uidValidity: string } | null;
  /** Only its headers were read (bigger than MAX_EMAIL_BYTES). */
  tooLarge?: boolean;
};

export type EmailIngestDeps = { now?: Date; storage?: FileStorage; queue?: JobQueue };

export type EmailIngestOutcome =
  | { kind: "ingested"; conversationId: string; messageIds: string[]; capped: DailyCap | null }
  | { kind: "duplicate" };

/** Whether a message of the channel already has this provider id ([CAN-11]). */
export async function isEmailStored(channelId: string, providerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.externalId, providerId)))
    .limit(1);
  return Boolean(row);
}

function sentAtOf(email: IncomingEmail, now: Date): Date {
  const date = email.parsed.date;
  return date && date.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS ? date : email.receivedAt;
}

/** The text the model and the inbox get, and whether it was cleaned or cut ([COR-19]). */
export function emailText(
  email: Pick<IncomingEmail, "parsed" | "quoteFreeText" | "tooLarge">,
  options: { subjectLine?: boolean } = {},
): { text: string; quotedRemoved: boolean; truncated: boolean } {
  if (email.tooLarge) return { text: TOO_LARGE_TEXT, quotedRemoved: false, truncated: true };
  const source = email.quoteFreeText?.trim() ? email.quoteFreeText : email.parsed.text;
  const stripped = stripQuotesAndSignature(source);
  const quotedRemoved = stripped.removed || Boolean(email.quoteFreeText?.trim());
  const truncated = stripped.text.length > MAX_EMAIL_TEXT;
  let text = truncated ? `${stripped.text.slice(0, MAX_EMAIL_TEXT)}\n[…]` : stripped.text;
  // The first email of a thread brings its subject: often the question itself.
  const startsThread = !email.parsed.inReplyTo && email.parsed.references.length === 0;
  if ((options.subjectLine ?? true) && startsThread && email.parsed.subject) text = text ? `Asunto: ${email.parsed.subject}\n\n${text}` : `Asunto: ${email.parsed.subject}`;
  return { text, quotedRemoved, truncated };
}

export function emailMetadataOf(email: IncomingEmail, extra: Partial<EmailMetadataInput> = {}): EmailMetadataInput {
  const { parsed } = email;
  return {
    providerId: email.providerId,
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
    from: parsed.from,
    replyTo: parsed.replyTo,
    to: parsed.to.slice(0, 100),
    cc: parsed.cc.slice(0, 100),
    ...(email.imap ? { imap: email.imap } : {}),
    ...extra,
  };
}

function attachmentContentType(mimeType: string, fileName: string | null): MessageContentType {
  const base = baseMimeType(mimeType);
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("audio/")) return "audio";
  if (base.startsWith("video/")) return "video";
  if (isPdf(base, fileName)) return "document";
  return "document";
}

type StoredAttachment = { contentType: MessageContentType; media: MessageMedia };

async function storeAttachments(email: IncomingEmail, deps: EmailIngestDeps): Promise<{ stored: StoredAttachment[]; dropped: string[] }> {
  const stored: StoredAttachment[] = [];
  const dropped = [...email.parsed.droppedAttachments];
  for (const attachment of email.parsed.attachments) {
    try {
      const media = await storeInboundMedia({ bytes: attachment.content, mimeType: attachment.contentType, fileName: attachment.fileName }, { storage: deps.storage, now: deps.now });
      stored.push({ contentType: attachmentContentType(media.mimeType, attachment.fileName), media });
    } catch (error) {
      // Empty or above the storage limit: named, never stored ([COR-19]).
      if (!(error instanceof MediaRejectedError)) throw error;
      dropped.push(attachment.fileName ?? attachment.contentType);
    }
  }
  return { stored, dropped };
}

/** A customer's email into the inbox and the reply engine. */
export async function ingestInboundEmail(channel: ChannelRecord, email: IncomingEmail, deps: EmailIngestDeps = {}): Promise<EmailIngestOutcome> {
  const now = deps.now ?? new Date();
  if (await isEmailStored(channel.id, email.providerId)) return { kind: "duplicate" };
  const from = email.parsed.from;
  if (!from) return { kind: "duplicate" };
  const { text: body, quotedRemoved, truncated } = emailText(email);
  const { stored, dropped } = await storeAttachments(email, deps);
  // Files that could not be kept are said, so the AI can ask for them another way ([COR-19]).
  const text = dropped.length > 0 ? `${body}\n\n${DROPPED_NOTE}: ${dropped.slice(0, 10).join(", ")}` : body;
  const sentAt = sentAtOf(email, now);
  const sender = { externalIds: [from.address], email: from.address, displayName: from.name };
  const subject = email.parsed.subject ? { subject: email.parsed.subject } : {};
  const original = quotedRemoved || truncated ? { originalText: email.parsed.text.slice(0, MAX_ORIGINAL_TEXT) } : {};
  // Anyone can write any From: only the receiving server's Authentication-Results vouches for it ([COR-25]).
  const senderVerified = senderVerification(email.parsed.headers, from.address, email.parsed.fromCount).verified;
  const events: InboundMessageEvent[] = [
    {
      kind: "inbound_message",
      externalId: email.providerId,
      sender,
      threadId: email.threadId,
      contentType: "text",
      text,
      sentAt,
      metadata: {
        ...subject,
        email: emailMetadataOf(email, { quotedRemoved, senderVerified, ...(truncated ? { truncated } : {}), ...original, ...(dropped.length ? { droppedAttachments: dropped.slice(0, 100) } : {}) }),
      },
    },
    ...stored.map(
      (attachment, index): InboundMessageEvent => ({
        kind: "inbound_message",
        externalId: `${email.providerId}#${index + 1}`,
        sender,
        threadId: email.threadId,
        contentType: attachment.contentType,
        text: null,
        media: attachment.media,
        sentAt,
        metadata: { ...subject, email: { providerId: `${email.providerId}#${index + 1}`, messageId: null, attachmentOf: email.providerId, from: email.parsed.from, senderVerified } },
      }),
    ),
  ];
  const result = await ingestEvents(channel, events, { now, queue: deps.queue });
  const fresh = result.messages.filter((message) => !message.duplicate && message.messageId && message.conversationId);
  const conversationId = fresh[0]?.conversationId ?? result.messages[0]?.conversationId ?? null;
  if (!conversationId || fresh.length === 0) return { kind: "duplicate" };
  if (email.parsed.subject) await rememberSubject(conversationId, email.parsed.subject);
  const capped = await enforceDailyCaps(channel, conversationId, { now, queue: deps.queue });
  return { kind: "ingested", conversationId, messageIds: fresh.map((message) => message.messageId as string), capped };
}

/** The thread's subject on the conversation, for the inbox list ([BAN-09]). */
async function rememberSubject(conversationId: string, subject: string): Promise<void> {
  const [row] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId));
  if (!row || typeof row.metadata.subject === "string") return;
  await db.update(conversations).set({ metadata: { ...row.metadata, subject } }).where(eq(conversations.id, conversationId));
}

export type MailboxReplyOutcome = { kind: "recorded"; conversationId: string; messageId: string } | { kind: "no_conversation" } | { kind: "duplicate" };

/**
 * A person answered the thread from the mailbox ([COR-20]): their message joins the conversation and the AI pauses
 * there for the business's pause hours ([BAN-11]); a pending AI reply is dropped and the first human reply is timed.
 */
export async function recordMailboxReply(channel: ChannelRecord, email: IncomingEmail, deps: EmailIngestDeps = {}): Promise<MailboxReplyOutcome> {
  const now = deps.now ?? new Date();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.channelId, channel.id), eq(conversations.externalThreadId, email.threadId)))
    .limit(1);
  if (!conversation) return { kind: "no_conversation" };
  if (await isEmailStored(channel.id, email.providerId)) return { kind: "duplicate" };
  const { aiPauseHours } = await loadBusinessSettings();
  const aiPausedUntil = conversation.aiMode === "ai" ? new Date(now.getTime() + aiPauseHours * HOUR_MS) : null;
  const { text, quotedRemoved } = emailText(email, { subjectLine: false });
  const sentAt = sentAtOf(email, now);
  const messageId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        channelId: channel.id,
        direction: "outbound",
        senderType: "human",
        senderName: email.parsed.from?.name ?? email.parsed.from?.address ?? null,
        externalId: email.providerId,
        contentType: "text",
        text,
        searchText: messageSearchText(text),
        status: "sent",
        metadata: { ...(email.parsed.subject ? { subject: email.parsed.subject } : {}), email: emailMetadataOf(email, { quotedRemoved, fromMailbox: true }) },
        sentAt,
        statusUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
      .returning({ id: messages.id });
    if (!row) return null;
    await tx
      .update(conversations)
      .set({
        lastOutboundAt: sentAt,
        lastMessageAt: now,
        ...(aiPausedUntil && (!conversation.aiPausedUntil || conversation.aiPausedUntil < aiPausedUntil) ? { aiPausedUntil, pauseReason: MAILBOX_PAUSE_REASON } : {}),
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    await recordFirstHumanResponse(tx, conversation.id, row.id, now);
    await publishConversationEvent(
      { type: "message.created", conversationId: conversation.id, channelId: channel.id, messageId: row.id, direction: "outbound", senderType: "human" },
      { channelType: channel.type, executor: tx },
    );
    await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: channel.id, change: "ai" }, { channelType: channel.type, executor: tx });
    return row.id;
  });
  if (!messageId) return { kind: "duplicate" };
  await (deps.queue ?? getJobQueue()).cancel({ dedupeKey: replyDedupeKey(conversation.id) });
  return { kind: "recorded", conversationId: conversation.id, messageId };
}

/**
 * Our own message (`ourMessageId`) seen again in the mailbox's sent mail. If it was still a draft here, the person sent
 * the mailbox draft from Gmail or Outlook (maybe after editing it): it is marked as sent with the text that left
 * ([COR-15]). Returns whether a draft was marked.
 */
export async function recordOwnSentEmail(channel: ChannelRecord, email: IncomingEmail, ourMessageId: string, now: Date = new Date()): Promise<boolean> {
  const { text } = emailText(email, { subjectLine: false });
  const [row] = await db
    .update(messages)
    .set({ status: "sent", externalId: email.providerId, text, searchText: messageSearchText(text), sentAt: email.parsed.date ?? now, statusUpdatedAt: now, updatedAt: now })
    .where(and(eq(messages.id, ourMessageId), eq(messages.channelId, channel.id), eq(messages.status, "draft")))
    .returning({ id: messages.id, conversationId: messages.conversationId });
  if (!row) return false;
  await updateEmailConfig(channel.id, (current) => {
    const drafts = { ...current.mailboxDrafts };
    delete drafts[row.id];
    return { mailboxDrafts: drafts };
  });
  await db.update(conversations).set({ lastOutboundAt: now, updatedAt: now }).where(eq(conversations.id, row.conversationId));
  await publishConversationEvent({ type: "message.status", conversationId: row.conversationId, channelId: channel.id, messageId: row.id, status: "sent" }, { channelType: channel.type });
  return true;
}
