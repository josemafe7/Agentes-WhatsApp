// Every message the business sends (AI replies, people's replies, hand-off notices) goes through here: stored first
// as «en cola» (or as a draft), then handed to the channel's adapter, retried once on a transient error, and marked
// «fallido» with its Spanish error otherwise ([WA-46], [BAN-13]). Replies to simulated messages never leave the app
// ([AJU-13]). Nothing reaches a customer who opted out of the channel ([CUM-03]): a person's message is refused with
// the reason, and what the platform sends on its own stays as not sent, with it. System code: callers check permissions.
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages, type MessageError, type MessageMedia } from "@/db/schema";
import type { MessageContentType, MessageStatus } from "@/lib/enums";
import { getSendAdapter } from "@/server/channels/registry";
import { ChannelSendError, type ChannelRecord, type OutboundRecipient } from "@/server/channels/types";
import { isOptedOut, OPTED_OUT_MESSAGE_ERROR, OptedOutError } from "@/server/compliance/opt-out";
import { newestInbound } from "@/server/engine/pending";
import { ConflictError, NotFoundError } from "@/server/errors";
import { messageSearchText } from "@/server/inbound/message-search";
import { publishConversationEvent } from "@/server/realtime/events";
import { safeErrorMessage } from "@/server/redact";

export type OutboundSender =
  | { type: "ai"; agentId: string; agentName: string }
  | { type: "human"; userId: string; name: string }
  | { type: "system" };

export type SendOutboundInput = {
  conversationId: string;
  sender: OutboundSender;
  text: string | null;
  contentType?: MessageContentType;
  media?: MessageMedia | null;
  metadata?: Record<string, unknown>;
  /** «Borrador para revisar»: stored as a draft, not sent ([MOT-14]). */
  draft?: boolean;
  now?: Date;
  /** Wait before the one retry of a transient error (tests pass 0). */
  retryDelayMs?: number;
  /** Only the one confirmation of an opt-out reaches a customer who opted out of the channel ([CUM-03]). */
  allowOptedOut?: boolean;
};

export type SendOutboundResult = { messageId: string; status: MessageStatus; error: MessageError | null; simulated: boolean };

/** Default wait before retrying a transient channel error once. */
export const SEND_RETRY_DELAY_MS = 2_000;
const UNEXPECTED_SEND_ERROR = "No se ha podido enviar el mensaje por un error inesperado.";

type Target = {
  channel: ChannelRecord;
  conversation: typeof conversations.$inferSelect;
  recipient: OutboundRecipient;
};

async function loadTarget(conversationId: string): Promise<Target> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation?.channelId) throw new NotFoundError("No se ha encontrado la conversación.");
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  if (!channel) throw new NotFoundError("No se ha encontrado el canal.");
  const recipient: OutboundRecipient = { externalIds: [], phone: null, email: null, name: null };
  if (conversation.contactId) {
    const [contact] = await db.select({ name: contacts.name, phone: contacts.phone, email: contacts.email }).from(contacts).where(eq(contacts.id, conversation.contactId));
    const identities = await db
      .select({ externalId: contactIdentities.externalId, phone: contactIdentities.phone })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelType, channel.type)))
      .orderBy(asc(contactIdentities.createdAt));
    recipient.externalIds = identities.map((identity) => identity.externalId);
    recipient.phone = identities.find((identity) => identity.phone)?.phone ?? contact?.phone ?? null;
    recipient.email = contact?.email ?? null;
    recipient.name = contact?.name ?? null;
  }
  return { channel, conversation, recipient };
}

/** A conversation started by the simulator, or whose last customer message was simulated, never goes out. */
async function isSimulated(conversation: Target["conversation"]): Promise<boolean> {
  if (conversation.metadata.simulated === true) return true;
  return (await newestInbound(conversation.id))?.simulated === true;
}

const wait = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

async function attemptSend(target: Target, row: typeof messages.$inferSelect, simulated: boolean, retryDelayMs: number) {
  const adapter = getSendAdapter(target.channel, simulated);
  const outbound = {
    messageId: row.id,
    conversationId: row.conversationId,
    recipient: target.recipient,
    threadId: target.conversation.externalThreadId,
    contentType: row.contentType,
    text: row.text,
    media: row.media,
    metadata: row.metadata,
  };
  for (let attempt = 1; ; attempt++) {
    try {
      return { ok: true as const, result: await adapter.send(target.channel, outbound) };
    } catch (error) {
      const known = error instanceof ChannelSendError ? error : null;
      if (known?.retryable && attempt === 1) {
        await wait(retryDelayMs);
        continue;
      }
      if (!known) console.error(`[outbound] Envío fallido: ${safeErrorMessage(error)}`);
      const failure: MessageError = known ? { code: known.channelCode, message: known.userMessage } : { message: UNEXPECTED_SEND_ERROR };
      return { ok: false as const, error: failure };
    }
  }
}

/** Hands a stored message to the channel and records the outcome. */
async function deliver(target: Target, row: typeof messages.$inferSelect, simulated: boolean, retryDelayMs: number): Promise<SendOutboundResult> {
  const outcome = await attemptSend(target, row, simulated, retryDelayMs);
  const now = new Date();
  const status: MessageStatus = outcome.ok ? outcome.result.status : "failed";
  const error = outcome.ok ? null : outcome.error;
  await db
    .update(messages)
    .set({
      status,
      error,
      ...(outcome.ok ? { externalId: outcome.result.externalId, sentAt: outcome.result.sentAt ?? now } : {}),
      statusUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(messages.id, row.id));
  await publishConversationEvent(
    { type: "message.status", conversationId: row.conversationId, channelId: target.channel.id, messageId: row.id, status },
    { channelType: target.channel.type },
  );
  return { messageId: row.id, status, error, simulated };
}

/**
 * Stores and sends one message of the business in a conversation. Throws NotFoundError without conversation, and
 * OptedOutError for a person's message to a customer who opted out of the channel ([CUM-03]).
 */
export async function sendOutbound(input: SendOutboundInput): Promise<SendOutboundResult> {
  const target = await loadTarget(input.conversationId);
  const simulated = await isSimulated(target.conversation);
  const now = input.now ?? new Date();
  const optedOut = !input.draft && !input.allowOptedOut && (await isOptedOut(target.conversation.contactId, target.channel.id));
  if (optedOut && input.sender.type === "human") throw new OptedOutError();
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(messages)
      .values({
        conversationId: target.conversation.id,
        channelId: target.channel.id,
        direction: "outbound",
        senderType: input.sender.type,
        senderUserId: input.sender.type === "human" ? input.sender.userId : null,
        senderName: input.sender.type === "human" ? input.sender.name : null,
        agentId: input.sender.type === "ai" ? input.sender.agentId : null,
        agentName: input.sender.type === "ai" ? input.sender.agentName : null,
        contentType: input.contentType ?? "text",
        text: input.text,
        searchText: messageSearchText(input.text),
        media: input.media ?? null,
        status: input.draft ? "draft" : optedOut ? "failed" : "queued",
        ...(optedOut ? { error: OPTED_OUT_MESSAGE_ERROR, statusUpdatedAt: now } : {}),
        simulated,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx
      .update(conversations)
      .set({ ...(input.draft || optedOut ? {} : { lastOutboundAt: now }), lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, target.conversation.id));
    await publishConversationEvent(
      { type: "message.created", conversationId: created.conversationId, channelId: target.channel.id, messageId: created.id, direction: "outbound", senderType: created.senderType },
      { channelType: target.channel.type, executor: tx },
    );
    await publishConversationEvent(
      { type: "conversation.updated", conversationId: created.conversationId, channelId: target.channel.id, change: "outbound" },
      { channelType: target.channel.type, executor: tx },
    );
    return created;
  });
  if (input.draft) return { messageId: row.id, status: "draft", error: null, simulated };
  if (optedOut) return { messageId: row.id, status: "failed", error: OPTED_OUT_MESSAGE_ERROR, simulated };
  return deliver(target, row, simulated, input.retryDelayMs ?? SEND_RETRY_DELAY_MS);
}

/** Sends again a message that failed, or one left «en cola» by a process that stopped ([BAN-13]). */
export async function resendOutbound(messageId: string, options: { retryDelayMs?: number } = {}): Promise<SendOutboundResult> {
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!row || row.direction !== "outbound") throw new NotFoundError("No se ha encontrado el mensaje.");
  const target = await loadTarget(row.conversationId);
  const now = new Date();
  // While the customer stays opted out of the channel it stays not sent, with the reason ([CUM-03]); only the
  // confirmation of the opt-out itself may go again.
  const optOutConfirmation = typeof row.metadata.optOutConfirmation === "string";
  if (!optOutConfirmation && (await isOptedOut(target.conversation.contactId, target.channel.id))) {
    await db.update(messages).set({ status: "failed", error: OPTED_OUT_MESSAGE_ERROR, statusUpdatedAt: now, updatedAt: now }).where(eq(messages.id, row.id));
    await publishConversationEvent(
      { type: "message.status", conversationId: row.conversationId, channelId: target.channel.id, messageId: row.id, status: "failed" },
      { channelType: target.channel.type },
    );
    return { messageId: row.id, status: "failed", error: OPTED_OUT_MESSAGE_ERROR, simulated: row.simulated };
  }
  const [queued] = await db
    .update(messages)
    .set({ status: "queued", error: null, statusUpdatedAt: now, updatedAt: now })
    .where(eq(messages.id, row.id))
    .returning();
  return deliver(target, queued, row.simulated, options.retryDelayMs ?? SEND_RETRY_DELAY_MS);
}

export type SendDraftOptions = {
  /** The text a person edited before approving; the draft's own text otherwise. */
  text?: string;
  approvedBy: { userId: string; name: string };
  now?: Date;
  retryDelayMs?: number;
};

/**
 * «Aprobar» a draft of the AI ([CAN-07], [MOT-14]): the same message (still signed by its agent) leaves as it is or
 * as the person edited it. Only a draft that is still a draft moves on, so two people approving at once send it once.
 * A person approves it: for a customer who opted out of the channel it is refused with the reason ([CUM-03]).
 */
export async function sendDraft(messageId: string, options: SendDraftOptions): Promise<SendOutboundResult> {
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!row || row.direction !== "outbound") throw new NotFoundError("No se ha encontrado el mensaje.");
  const target = await loadTarget(row.conversationId);
  if (await isOptedOut(target.conversation.contactId, target.channel.id)) throw new OptedOutError();
  const now = options.now ?? new Date();
  const text = options.text ?? row.text;
  const [queued] = await db
    .update(messages)
    .set({
      text,
      searchText: messageSearchText(text),
      status: "queued",
      metadata: {
        ...row.metadata,
        approvedByUserId: options.approvedBy.userId,
        approvedByName: options.approvedBy.name,
        approvedAt: now.toISOString(),
        ...(text !== row.text ? { editedBeforeSending: true } : {}),
      },
      statusUpdatedAt: now,
      updatedAt: now,
    })
    .where(and(eq(messages.id, row.id), eq(messages.status, "draft")))
    .returning();
  if (!queued) throw new ConflictError("Este borrador ya no está pendiente: alguien lo ha enviado o descartado.");
  await db.update(conversations).set({ lastOutboundAt: now, updatedAt: now }).where(eq(conversations.id, row.conversationId));
  return deliver(target, queued, row.simulated, options.retryDelayMs ?? SEND_RETRY_DELAY_MS);
}
