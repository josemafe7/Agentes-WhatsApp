// Messages of a conversation and a person's replies ([BAN-05]–[BAN-08], [BAN-11], [BAN-13], [TRA-06], [MED-08]).
// Replying from the inbox pauses the AI in that conversation for the business's hours (12 by default) and fills the
// first human response time of an open hand-off. Agents only reach their channels ([PER-02]); Solo lectura only reads.
import "server-only";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { aiRuns, channels, conversations, messageRetrievals, messages, type MessageError, type MessageReaction } from "@/db/schema";
import type { MessageContentType, MessageDirection, MessageStatus, SenderType } from "@/lib/enums";
import { whatsappWindowState } from "@/lib/meta/window";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import { getJobQueue } from "@/server/adapters/job-queue";
import { defaultCapabilitiesOf } from "@/server/channels/capabilities";
import { replyDedupeKey } from "@/server/engine/schedule";
import { AuthError, ConflictError, parseInput, ValidationError } from "@/server/errors";
import { recordFirstHumanResponse } from "@/server/handoff/service";
import { mediaMetadataOf } from "@/server/media/metadata";
import { storeInboundMedia } from "@/server/media/store";
import { resendOutbound, sendDraft, sendOutbound, type SendOutboundResult } from "@/server/outbound/send";
import { publishConversationEvent } from "@/server/realtime/events";
import { jsonTextContains } from "@/server/sql-helpers";
import { writeAudit } from "./audit";
import { detectLogoFormat, fileUrl } from "./business";
import { loadConversationFor } from "./conversation-scope";

/** Longest text a person sends from the inbox (WhatsApp's limit for a text message). */
export const MAX_HUMAN_TEXT = 4_096;
const DEFAULT_PAGE = 50;
const HOUR_MS = 60 * 60_000;

export type MessageItem = {
  id: string;
  direction: MessageDirection;
  senderType: SenderType;
  /** Person's name, agent's name, or null for the customer and the system ([BAN-05]). */
  authorName: string | null;
  contentType: MessageContentType;
  text: string | null;
  transcript: string | null;
  /** The voice note could not be transcribed: the inbox says «No se pudo transcribir» ([MED-03]). */
  transcriptionFailed: boolean;
  /** Served only through /api/files, with permission on this conversation ([MED-08]). */
  media: { url: string | null; mimeType: string | null; size: number | null; fileName: string | null; downloadStatus: string | null } | null;
  /** The daily clean-up removed its file ([CUM-05]); a voice note keeps its transcript. */
  mediaRemoved: boolean;
  status: MessageStatus;
  error: MessageError | null;
  reactions: MessageReaction[];
  simulated: boolean;
  /** For «¿Por qué respondió esto?» (knowledge phase). */
  aiRunId: string | null;
  /** WhatsApp: Meta's pricing of the sent message and its estimated cost in USD ([WA-47]); null until it arrives. */
  pricing?: { type: string | null; category: string | null; costEstimate: number | null } | null;
  createdAt: Date;
  sentAt: Date | null;
};

export const listMessagesSchema = z
  .object({ conversationId: idSchema, before: idSchema.optional(), limit: z.number().int().min(1).max(200).default(DEFAULT_PAGE) })
  .strict();

/** The last messages of a conversation, oldest first; `before` pages back ([BAN-05]). */
export async function listMessages(actor: Actor, input: unknown): Promise<{ items: MessageItem[]; hasMore: boolean }> {
  const data = parseInput(listMessagesSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, data.conversationId);
  const conditions: SQL[] = [eq(messages.conversationId, conversation.id)];
  if (data.before) {
    const [anchor] = await db.select({ createdAt: messages.createdAt }).from(messages).where(and(eq(messages.id, data.before), eq(messages.conversationId, conversation.id)));
    if (anchor) conditions.push(or(lt(messages.createdAt, anchor.createdAt), and(eq(messages.createdAt, anchor.createdAt), lt(messages.id, data.before))) as SQL);
  }
  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(data.limit + 1);
  const items = rows.slice(0, data.limit).reverse().map(toItem);
  return { items, hasMore: rows.length > data.limit };
}

function toItem(row: typeof messages.$inferSelect): MessageItem {
  const media = row.media;
  return {
    id: row.id,
    direction: row.direction,
    senderType: row.senderType,
    authorName: row.senderType === "human" ? row.senderName : row.senderType === "ai" ? row.agentName : null,
    contentType: row.contentType,
    text: row.text,
    transcript: row.transcript,
    transcriptionFailed: mediaMetadataOf(row.metadata).transcriptionFailed,
    media: media
      ? {
          url: media.fileKey ? fileUrl(media.fileKey) : null,
          mimeType: media.mimeType ?? null,
          size: media.size ?? null,
          fileName: media.fileName ?? null,
          downloadStatus: media.downloadStatus ?? null,
        }
      : null,
    mediaRemoved: !media && typeof row.metadata.mediaDeletedAt === "string",
    status: row.status,
    error: row.error,
    reactions: row.reactions,
    simulated: row.simulated,
    aiRunId: typeof row.metadata.aiRunId === "string" ? row.metadata.aiRunId : null,
    pricing: row.pricingType || row.pricingCategory ? { type: row.pricingType, category: row.pricingCategory, costEstimate: row.costEstimate } : null,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

export const sendHumanMessageSchema = z
  .object({
    conversationId: idSchema,
    text: z.string().trim().min(1, "Escribe un mensaje.").max(MAX_HUMAN_TEXT, `Como mucho ${MAX_HUMAN_TEXT} caracteres.`),
  })
  .strict();

/**
 * A disabled channel sends nothing ([CAN-16]); outside WhatsApp's 24 h window only a template goes ([BAN-08]). The window
 * counts from the customer's last message, and a 131047 from Meta closes it until the customer writes again ([WA-43]).
 */
async function assertCanSendNow(conversation: { channelId: string; lastInboundAt: Date | null; metadata: Record<string, unknown> }, now: Date): Promise<void> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  if (!channel || channel.status === "disabled") throw new ConflictError("El canal está desactivado: no se pueden enviar mensajes.");
  if (defaultCapabilitiesOf(channel).window24h && !whatsappWindowState(conversation.lastInboundAt, now, conversation.metadata).open) {
    throw new ConflictError("Han pasado más de 24 horas desde el último mensaje del cliente: solo puedes enviar una plantilla aprobada.");
  }
}

export type SendHumanResult =Pick<SendOutboundResult, "messageId" | "status" | "error"> & { aiPausedUntil: Date | null };

/**
 * A person replies from the inbox. The AI of the conversation pauses for the business's hours ([BAN-11]) with the
 * reason, a pending AI reply is dropped, and the first reply after a hand-off is timed ([TRA-06]).
 */
export async function sendHumanMessage(actor: Actor, input: unknown): Promise<SendHumanResult> {
  const data = parseInput(sendHumanMessageSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.reply, data.conversationId);
  const now = new Date();
  await assertCanSendNow(conversation, now);

  const sent = await sendOutbound({ conversationId: conversation.id, sender: { type: "human", userId: actor.userId, name: actor.name }, text: data.text, now });
  const aiPausedUntil = await afterHumanReply(actor, conversation, sent.messageId, now);
  return { messageId: sent.messageId, status: sent.status, error: sent.error, aiPausedUntil };
}

/**
 * What every reply of a person does: AI paused with the reason, read, first response timed, pending reply dropped.
 * Also used by the WhatsApp templates a person sends (src/data/whatsapp-send.ts).
 */
export async function afterHumanReply(actor: Actor, conversation: { id: string; channelId: string; aiMode: string }, messageId: string, now: Date): Promise<Date | null> {
  const { aiPauseHours } = await loadBusinessSettings();
  const aiPausedUntil = conversation.aiMode === "ai" ? new Date(now.getTime() + aiPauseHours * HOUR_MS) : null;
  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({
        unreadCount: 0,
        ...(aiPausedUntil ? { aiPausedUntil, pauseReason: `Ha respondido ${actor.name}` } : {}),
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    await recordFirstHumanResponse(tx, conversation.id, messageId, now);
    await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: conversation.channelId, change: "ai" }, { executor: tx });
  });
  await getJobQueue().cancel({ dedupeKey: replyDedupeKey(conversation.id) });
  return aiPausedUntil;
}

// ─── Files from the inbox ([BAN-14]) ────────────────────────────────────────────────────────────────────

/** Under Server Actions' body limit (next.config.ts, 4 MB with the form's own bytes) and Vercel's 4.5 MB. */
export const MAX_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;
/** WhatsApp's limit for the text that goes with a file. */
export const MAX_ATTACHMENT_CAPTION = 1_024;

export const sendAttachmentSchema = z
  .object({
    conversationId: idSchema,
    text: z.string().trim().max(MAX_ATTACHMENT_CAPTION, `Como mucho ${MAX_ATTACHMENT_CAPTION} caracteres con un archivo.`).optional(),
  })
  .strict();

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** An image (PNG, JPG or WebP) or a PDF, told by its first bytes: the name and declared type are never trusted. */
export function detectAttachment(bytes: Uint8Array): { kind: "image" | "document"; mimeType: string } | null {
  const image = detectLogoFormat(bytes);
  if (image) return { kind: "image", mimeType: image.contentType };
  if (bytes.length >= PDF_SIGNATURE.length && PDF_SIGNATURE.every((value, index) => bytes[index] === value)) return { kind: "document", mimeType: "application/pdf" };
  return null;
}

/**
 * A person sends a file (with an optional text) from the inbox, when the channel takes that kind of file ([BAN-14],
 * [CAN-14], [SEG-13]): checked by content and size, stored privately and sent like any reply, so it also pauses the AI.
 */
export async function sendHumanAttachment(
  actor: Actor,
  input: unknown,
  file: { bytes: Uint8Array; fileName: string },
  options: { storage?: FileStorage } = {},
): Promise<SendHumanResult> {
  const data = parseInput(sendAttachmentSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.reply, data.conversationId);
  const now = new Date();
  await assertCanSendNow(conversation, now);
  if (file.bytes.byteLength === 0) throw new ValidationError(undefined, { file: ["Elige un archivo."] });
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new ValidationError(undefined, { file: ["El archivo es demasiado grande. Como mucho, 3,5 MB."] });
  const detected = detectAttachment(file.bytes);
  if (!detected) throw new ValidationError(undefined, { file: ["Solo se pueden adjuntar imágenes (JPG, PNG o WebP) y documentos PDF."] });
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  const capabilities = defaultCapabilitiesOf(channel);
  if (detected.kind === "image" ? !capabilities.images : !capabilities.documents) {
    throw new ValidationError(undefined, { file: [detected.kind === "image" ? "Este canal no admite imágenes." : "Este canal no admite documentos."] });
  }

  const storage = options.storage ?? getFileStorage();
  const media = await storeInboundMedia({ bytes: file.bytes, mimeType: detected.mimeType, fileName: file.fileName }, { now, storage });
  // A person may write to a customer who opted out of the channel, files included ([CUM-03], [CUM-04]).
  const sent = await sendOutbound({
    conversationId: conversation.id,
    sender: { type: "human", userId: actor.userId, name: actor.name },
    text: data.text || null,
    contentType: detected.kind,
    media,
    now,
  });
  const aiPausedUntil = await afterHumanReply(actor, conversation, sent.messageId, now);
  return { messageId: sent.messageId, status: sent.status, error: sent.error, aiPausedUntil };
}

/** «Reintentar» on a failed message of the business ([BAN-13]). */
export async function retryFailedMessage(actor: Actor, messageId: string): Promise<Pick<SendOutboundResult, "messageId" | "status" | "error">> {
  assertMessageId(messageId);
  const [row] = await db
    .select({ id: messages.id, conversationId: messages.conversationId, status: messages.status, direction: messages.direction })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!row) throw new AuthError("forbidden");
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.reply, row.conversationId);
  if (row.direction !== "outbound" || row.status !== "failed") throw new ConflictError("Solo se reintentan los mensajes que no se pudieron enviar.");
  const [channel] = await db.select({ status: channels.status }).from(channels).where(eq(channels.id, conversation.channelId));
  if (!channel || channel.status === "disabled") throw new ConflictError("El canal está desactivado: no se pueden enviar mensajes.");
  const sent = await resendOutbound(row.id);
  return { messageId: sent.messageId, status: sent.status, error: sent.error };
}

// ─── Drafts of the AI ([CAN-07], [MOT-14]) ──────────────────────────────────────────────────────────────

/** The draft with its conversation, if `actor` may review drafts there; anything else is «sin permiso». */
async function loadDraftFor(actor: Actor, messageId: string) {
  assertMessageId(messageId);
  const [row] = await db
    .select({ id: messages.id, conversationId: messages.conversationId, status: messages.status, text: messages.text })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!row) throw new AuthError("forbidden");
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.drafts, row.conversationId);
  if (row.status !== "draft") throw new ConflictError("Este borrador ya no está pendiente: alguien lo ha enviado o descartado.");
  return { draft: row, conversation };
}

export const approveDraftSchema = z
  .object({
    messageId: idSchema,
    /** Edited before approving; without it the draft goes as the AI wrote it. */
    text: z.string().trim().min(1, "Escribe el mensaje.").max(MAX_HUMAN_TEXT, `Como mucho ${MAX_HUMAN_TEXT} caracteres.`).optional(),
  })
  .strict();

/**
 * «Aprobar» (or «Editar» and then approve) a reply the AI left as a draft: it leaves through the channel, still signed
 * by its agent, with who approved it in its metadata. It does not pause the AI: the words are the agent's.
 */
export async function approveDraft(actor: Actor, input: unknown): Promise<Pick<SendOutboundResult, "messageId" | "status" | "error">> {
  const data = parseInput(approveDraftSchema, input);
  const { draft, conversation } = await loadDraftFor(actor, data.messageId);
  const now = new Date();
  await assertCanSendNow(conversation, now);
  const sent = await sendDraft(draft.id, { text: data.text, approvedBy: { userId: actor.userId, name: actor.name }, now });
  await writeAudit({
    actor,
    action: "message.draft_approved",
    targetType: "conversation",
    targetId: conversation.id,
    metadata: { messageId: draft.id, edited: data.text !== undefined && data.text !== draft.text },
  });
  return { messageId: sent.messageId, status: sent.status, error: sent.error };
}

export const discardDraftSchema = z.object({ messageId: idSchema }).strict();

/** «Descartar»: the draft is removed and never reaches the customer; its AI run stays for the costs ([INF-07]). */
export async function discardDraft(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(discardDraftSchema, input);
  const { draft, conversation } = await loadDraftFor(actor, data.messageId);
  const removed = await db.transaction(async (tx) => {
    // Children first: foreign keys are not relied on to cascade (docs/architecture.md).
    await tx.update(aiRuns).set({ messageId: null }).where(eq(aiRuns.messageId, draft.id));
    await tx.delete(messageRetrievals).where(eq(messageRetrievals.messageId, draft.id));
    const deleted = await tx
      .delete(messages)
      .where(and(eq(messages.id, draft.id), eq(messages.status, "draft")))
      .returning({ id: messages.id });
    if (deleted.length === 0) return false;
    await publishConversationEvent({ type: "conversation.updated", conversationId: conversation.id, channelId: conversation.channelId, change: "outbound" }, { executor: tx });
    return true;
  });
  if (!removed) throw new ConflictError("Este borrador ya no está pendiente: alguien lo ha enviado o descartado.");
  await writeAudit({ actor, action: "message.draft_discarded", targetType: "conversation", targetId: conversation.id, metadata: { messageId: draft.id } });
}

function assertMessageId(messageId: string): void {
  if (!idSchema.safeParse(messageId).success) throw new AuthError("forbidden");
}

/** /api/files: a message file is served to whoever may see its conversation ([MED-08]). */
export async function canViewMessageMedia(actor: Actor, fileKey: string): Promise<boolean> {
  if (!can(actor, PERMISSIONS.inbox.view)) return false;
  // LIKE only narrows the candidates; the key must then be exactly the message's own.
  const rows = await db
    .select({ media: messages.media, channelId: conversations.channelId, isTest: conversations.isTest })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(jsonTextContains(messages.media, JSON.stringify(fileKey)))
    .limit(20);
  const row = rows.find((candidate) => candidate.media?.fileKey === fileKey);
  return Boolean(row?.channelId && !row.isTest && can(actor, PERMISSIONS.inbox.view, { channelId: row.channelId }));
}
