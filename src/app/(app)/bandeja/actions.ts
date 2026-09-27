"use server";
// Server Actions of the inbox ([BAN-*], [TRA-*], [AGE-14]). Thin: session and the area permission here, the input
// validated with the same Zod schemas as src/data, which checks the permission again on the conversation's channel
// ([SEG-04], [PER-02]); Solo lectura only reads ([PER-03]). Changes refresh the conversation on screen; the list and
// the other tabs catch up through /api/realtime.
import { refresh } from "next/cache";
import { z } from "zod";
import {
  assignConversationSchema,
  assignConversation,
  handOffConversation,
  handOffConversationSchema,
  markConversationRead,
  setConversationAgent,
  setConversationAgentSchema,
  setConversationAi,
  setConversationAiSchema,
  setConversationLabels,
  setConversationLabelsSchema,
  setConversationStatus,
  setConversationStatusSchema,
  takeConversation,
} from "@/data/conversation-actions";
import { conversationFiltersSchema, getInboxCounts, listConversations, type ConversationPage, type InboxCounts } from "@/data/conversations";
import { listMessageSources, type MessageSourcesByMessage } from "@/data/message-sources";
import {
  approveDraft,
  approveDraftSchema,
  discardDraft,
  discardDraftSchema,
  listMessages,
  MAX_ATTACHMENT_BYTES,
  retryFailedMessage,
  sendAttachmentSchema,
  sendHumanAttachment,
  sendHumanMessage,
  sendHumanMessageSchema,
  type MessageItem,
} from "@/data/messages";
import { addNote, addNoteSchema } from "@/data/notes";
import type { MessageStatus } from "@/lib/enums";
import { fail, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS, type Action } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado la conversación.";
const conversationIdSchema = z.object({ conversationId: idSchema }).strict();

/** Runs a change with the area permission and refreshes the screen; expected errors come back as a result. */
async function change<T>(action: Action, run: (actor: Awaited<ReturnType<typeof requirePermission>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const actor = await requirePermission(action);
    const result = await run(actor);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────────────────────────────────

export type InboxData = { page: ConversationPage; counts: InboxCounts };

/** The list with its filters and the counters of the tabs ([BAN-01]–[BAN-03]). */
export async function loadInboxAction(input: unknown): Promise<ActionResult<InboxData>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.view);
    const parsed = conversationFiltersSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error, "Revisa los filtros.");
    const [page, counts] = await Promise.all([listConversations(actor, parsed.data), getInboxCounts(actor)]);
    return ok({ page, counts });
  } catch (error) {
    return toActionFailure(error);
  }
}

const olderMessagesSchema = z.object({ conversationId: idSchema, before: idSchema }).strict();

export type OlderMessages = { items: MessageItem[]; hasMore: boolean; sources: MessageSourcesByMessage };

/** «Cargar anteriores»: the previous page of messages with the sources of its AI answers ([BAN-05], [BAN-07]). */
export async function loadOlderMessagesAction(input: unknown): Promise<ActionResult<OlderMessages>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.view);
    const parsed = olderMessagesSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    const { items, hasMore } = await listMessages(actor, parsed.data);
    const aiIds = items.filter((item) => item.senderType === "ai").map((item) => item.id);
    const sources = await listMessageSources(actor, { conversationId: parsed.data.conversationId, messageIds: aiIds });
    return ok({ items, hasMore, sources });
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Opening a conversation marks it read ([BAN-04]); for Solo lectura it changes nothing. No refresh: the list hears it. */
export async function markReadAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.view);
    const parsed = conversationIdSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    return ok({ changed: await markConversationRead(actor, parsed.data.conversationId) });
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Replies and notes ([BAN-07], [BAN-11], [BAN-13]) ───────────────────────────────────────────────────

export type SentMessage = { status: MessageStatus; aiPausedUntil: Date | null };

export async function sendMessageAction(input: unknown): Promise<ActionResult<SentMessage>> {
  return change(PERMISSIONS.inbox.reply, async (actor) => {
    const parsed = sendHumanMessageSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const sent = await sendHumanMessage(actor, parsed.data);
    return ok({ status: sent.status, aiPausedUntil: sent.aiPausedUntil });
  });
}

export async function addNoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return change(PERMISSIONS.inbox.notes, async (actor) => {
    const parsed = addNoteSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const note = await addNote(actor, parsed.data);
    return ok({ id: note.id });
  });
}

const retrySchema = z.object({ messageId: idSchema }).strict();

export async function retryMessageAction(input: unknown): Promise<ActionResult<{ status: MessageStatus }>> {
  return change(PERMISSIONS.inbox.reply, async (actor) => {
    const parsed = retrySchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado el mensaje.");
    const sent = await retryFailedMessage(actor, parsed.data.messageId);
    return ok({ status: sent.status });
  });
}

/**
 * A file (image or PDF) with an optional text, when the channel takes it ([BAN-14]). The permission is checked before
 * the file is read; the data layer checks the channel, the content and the size again.
 */
export async function sendAttachmentAction(formData: FormData): Promise<ActionResult<SentMessage>> {
  return change(PERMISSIONS.inbox.reply, async (actor) => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Revisa los campos marcados.", { file: ["Elige un archivo."] });
    if (file.size > MAX_ATTACHMENT_BYTES) return fail("Revisa los campos marcados.", { file: ["El archivo es demasiado grande. Como mucho, 3,5 MB."] });
    const text = formData.get("text");
    const parsed = sendAttachmentSchema.safeParse({
      conversationId: formData.get("conversationId"),
      ...(typeof text === "string" && text.trim() ? { text } : {}),
    });
    if (!parsed.success) return fromZodError(parsed.error);
    const sent = await sendHumanAttachment(actor, parsed.data, { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    return ok({ status: sent.status, aiPausedUntil: sent.aiPausedUntil });
  });
}

/** «Aprobar» or «Editar» and send a draft of the AI ([CAN-07], [MOT-14]). */
export async function approveDraftAction(input: unknown): Promise<ActionResult<{ status: MessageStatus }>> {
  return change(PERMISSIONS.inbox.drafts, async (actor) => {
    const parsed = approveDraftSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const sent = await approveDraft(actor, parsed.data);
    return ok({ status: sent.status });
  });
}

/** «Descartar» a draft of the AI: it never reaches the customer. */
export async function discardDraftAction(input: unknown): Promise<ActionResult> {
  return change(PERMISSIONS.inbox.drafts, async (actor) => {
    const parsed = discardDraftSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado el mensaje.");
    await discardDraft(actor, parsed.data);
    return ok();
  });
}

// ─── The conversation's AI, hand-off, status, labels, assignment and agent ──────────────────────────────

/** IA on, off, or paused until a time, with the reason ([BAN-10]). */
export async function setAiAction(input: unknown): Promise<ActionResult> {
  return change(PERMISSIONS.inbox.pauseAi, async (actor) => {
    const parsed = setConversationAiSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setConversationAi(actor, parsed.data);
    return ok();
  });
}

/** «Pasar a una persona» by hand ([TRA-01]–[TRA-03]). */
export async function handOffAction(input: unknown): Promise<ActionResult> {
  return change(PERMISSIONS.inbox.manage, async (actor) => {
    const parsed = handOffConversationSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await handOffConversation(actor, parsed.data);
    return ok(undefined, "Conversación pasada a una persona.");
  });
}

/** Abierta, pendiente de humano (a manual hand-off) or resuelta, which gives the AI back ([BAN-12], [TRA-08]). */
export async function setStatusAction(input: unknown): Promise<ActionResult> {
  return change(PERMISSIONS.inbox.manage, async (actor) => {
    const parsed = setConversationStatusSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setConversationStatus(actor, parsed.data);
    return ok();
  });
}

export async function setLabelsAction(input: unknown): Promise<ActionResult<{ labels: string[] }>> {
  return change(PERMISSIONS.inbox.manage, async (actor) => {
    const parsed = setConversationLabelsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok({ labels: await setConversationLabels(actor, parsed.data) });
  });
}

/** Assign to anyone who can answer the channel, or unassign (not for Agents) ([TRA-04]). */
export async function assignAction(input: unknown): Promise<ActionResult> {
  return change(PERMISSIONS.inbox.assign, async (actor) => {
    const parsed = assignConversationSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await assignConversation(actor, parsed.data);
    return ok();
  });
}

/** «Tomar»: for oneself; an Agent only an unassigned one of their channels. */
export async function takeAction(input: unknown): Promise<ActionResult> {
  return change(PERMISSIONS.inbox.claim, async (actor) => {
    const parsed = conversationIdSchema.safeParse(input);
    if (!parsed.success) return fail(NOT_FOUND);
    await takeConversation(actor, parsed.data.conversationId);
    return ok();
  });
}

/** Another agent only for this conversation, or null for the channel's again ([AGE-14]). */
export async function setAgentAction(input: unknown): Promise<ActionResult> {
  return change(PERMISSIONS.inbox.changeAgent, async (actor) => {
    const parsed = setConversationAgentSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setConversationAgent(actor, parsed.data);
    return ok();
  });
}
