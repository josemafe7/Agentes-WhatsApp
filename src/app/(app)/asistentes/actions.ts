"use server";
// Server Actions of «Asistentes» ([INT-07], [INT-10]–[INT-12]). Thin: session and permission here, then
// src/data/assistants.ts, which checks again that the person may use that agent and that the conversation is theirs.
// The answer is written inside this request, like «Probar agente»: never from a channel's webhook.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  askAssistant,
  AssistantDailyLimitError,
  deleteMyAssistantChat,
  listEarlierAssistantMessages,
  listMyAssistantChats,
  type AssistantChatItem,
  type AssistantChatPage,
  type AssistantMessageItem,
  type AssistantMessagePage,
} from "@/data/assistants";
import { fail, ok, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { AgentRunError, AiNotConfiguredError } from "@/server/ai/errors";
import { RateLimitError, toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { assistantFailureMessage } from "./_lib/failures";
import { ASSISTANTS_PATH } from "./_lib/paths";

/**
 * ai_not_configured: no OpenRouter key ([INT-11]); ai_failed: the AI could not answer (Spanish message).
 * `retry`: asking the same again can work (a failure that passes on its own); without it, the message says what to do.
 */
export type AskAssistantFailure = ActionFailure & { reason?: "ai_not_configured" | "ai_failed"; retry?: true };
export type AskAssistantReply = { chat: AssistantChatItem; question: AssistantMessageItem; answer: AssistantMessageItem };
export type AskAssistantActionResult = { ok: true; data: AskAssistantReply } | AskAssistantFailure;

/** One question to an internal agent and its one answer; nothing is stored unless there is an answer. */
export async function askAssistantAction(input: unknown): Promise<AskAssistantActionResult> {
  let actor: Actor | null = null;
  try {
    actor = await requirePermission(PERMISSIONS.internal.use);
    const data = await askAssistant(actor, input);
    // What Next.js keeps of this screen (and brings back with «Atrás») now has the new question and its answer.
    revalidatePath(ASSISTANTS_PATH, "layout");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return { ...fail(error.userMessage), reason: "ai_not_configured" };
    // Recorded in ai_runs by runAgent. What the person reads is what they can do about it: the reason itself (the
    // key, its credit, the model) only for who can change it in Ajustes › IA; never the key or provider details.
    if (error instanceof AgentRunError) {
      const canFix = actor !== null && can(actor, PERMISSIONS.settings.integrations);
      const failure: AskAssistantFailure = { ...fail(assistantFailureMessage(error, canFix)), reason: "ai_failed" };
      return error.retryable ? { ...failure, retry: true } : failure;
    }
    // Too many questions in a minute pass by waiting; the limit of the day, a deleted conversation or a session
    // that ended do not.
    const failure = toActionFailure(error);
    return error instanceof RateLimitError && !(error instanceof AssistantDailyLimitError) ? { ...failure, retry: true } : failure;
  }
}

const moreChatsSchema = z.object({ agentId: idSchema, before: idSchema.optional() }).strict();

/**
 * «Cargar más»: the conversations of the person who asks that come after the last one listed ([INT-10]); without
 * `before`, the first ones again (every listed one was deleted and there are more).
 */
export async function loadMoreAssistantChatsAction(input: unknown): Promise<ActionResult<AssistantChatPage>> {
  try {
    const actor = await requirePermission(PERMISSIONS.internal.use);
    const parsed = moreChatsSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado la conversación.");
    return ok(await listMyAssistantChats(actor, parsed.data.agentId, parsed.data.before));
  } catch (error) {
    return toActionFailure(error);
  }
}

const earlierMessagesSchema = z.object({ chatId: idSchema, before: idSchema }).strict();

/** «Cargar mensajes anteriores» of one conversation of the person who asks, never of somebody else's ([INT-09], [INT-10]). */
export async function loadEarlierAssistantMessagesAction(input: unknown): Promise<ActionResult<AssistantMessagePage>> {
  try {
    const actor = await requirePermission(PERMISSIONS.internal.use);
    const parsed = earlierMessagesSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado la conversación.");
    return ok(await listEarlierAssistantMessages(actor, parsed.data.chatId, parsed.data.before));
  } catch (error) {
    return toActionFailure(error);
  }
}

const chatRefSchema = z.object({ chatId: idSchema }).strict();

/** Deletes one conversation of the person who asks, never somebody else's ([INT-09], [INT-10]). */
export async function deleteAssistantChatAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.internal.use);
    const parsed = chatRefSchema.safeParse(input);
    if (!parsed.success) return fail("No se ha encontrado la conversación.");
    await deleteMyAssistantChat(actor, parsed.data.chatId);
    revalidatePath(ASSISTANTS_PATH, "layout");
    return ok(undefined, "Conversación borrada.");
  } catch (error) {
    return toActionFailure(error);
  }
}
