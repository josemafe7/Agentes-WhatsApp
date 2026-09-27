"use server";
// Server Actions of the WhatsApp wizard (Canales › Añadir › WhatsApp, [WA-01]–[WA-25]). Thin: session and permission
// here (owner and admin, «Canales: crear, conectar…», [PER-04]), then src/data, which checks the permission again,
// validates every field with Zod ([SEG-04], [SEG-05]) and never returns a secret ([SEG-02]). Meta's answers come back
// in Spanish ([WA-09]); an unexpected Meta failure becomes its Spanish message instead of breaking the screen.
// Paso 5 (agent, AI, test mode) uses the actions of Canales (../../actions.ts): they are the same settings.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setConversationAi } from "@/data/conversation-actions";
import { getConversation, listConversations } from "@/data/conversations";
import { listMessages, sendHumanMessage } from "@/data/messages";
import { connectWhatsAppChannel, getWhatsAppWebhookSetup, revalidateWhatsAppChannel, validateWhatsAppCredentials, type ConnectWhatsAppResult, type WhatsAppValidationView } from "@/data/whatsapp";
import {
  changeWhatsAppPin,
  diagnoseWhatsAppChannel,
  registerWhatsAppNumber,
  requestWhatsAppVerificationCode,
  subscribeWhatsAppApp,
  subscribeWhatsAppWaba,
  verifyWhatsAppCode,
  type DiagnosisStep,
  type RegisterResult,
  type RequestCodeResult,
  type SubscribeAppResult,
  type SubscribeWabaResult,
} from "@/data/whatsapp-activation";
import { updateWhatsAppSettings } from "@/data/whatsapp-panel";
import { syncWhatsAppTemplatesNow } from "@/data/whatsapp-templates";
import { fail, ok, type ActionFailure, type ActionResult } from "@/lib/action-result";
import type { MessageContentType, MessageStatus } from "@/lib/enums";
import { isMetaGraphError } from "@/lib/meta/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import type { TemplatesSyncResult } from "@/server/channels/whatsapp/templates";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";
const INVALID_FORM = "Revisa los campos marcados.";
/** What «Enviar respuesta de prueba» says to the customer who wrote «hola» ([WA-23]). */
const TEST_REPLY_TEXT = "¡Hola! Este es un mensaje de prueba: el número ya está conectado a DominIA Agentes.";
/** Conversations looked at for the test message: the newest ones of the channel. */
const TEST_CONVERSATIONS = 5;
const TEST_MESSAGES = 20;

function failure(error: unknown): ActionFailure {
  // Calls that do not translate Meta's refusals themselves (template sync) still show its Spanish message ([WA-09]).
  if (isMetaGraphError(error)) return fail(error.userMessage);
  return toActionFailure(error);
}

/** Canales, the channel's panel and the agents' «Activo en:» show the new state. */
function revalidateChannels(): void {
  revalidatePath("/canales", "layout");
  revalidatePath("/agentes", "layout");
}

async function manager() {
  return requirePermission(PERMISSIONS.channels.manage);
}

// ─── Paso 1 · Datos ([WA-04]–[WA-11]) ───────────────────────────────────────────────────────────────────

/** «Validar con Meta»: nothing is stored; the answer is «Negocio · Número · Estado» or Meta's error in Spanish. */
export async function validateWhatsAppAction(input: unknown): Promise<ActionResult<WhatsAppValidationView>> {
  try {
    const actor = await manager();
    return ok(await validateWhatsAppCredentials(actor, input));
  } catch (error) {
    return failure(error);
  }
}

/** «Conectar este número»: validates again on the server and stores the channel «conectando» in test mode. */
export async function connectWhatsAppAction(input: unknown): Promise<ActionResult<ConnectWhatsAppResult>> {
  try {
    const actor = await manager();
    const result = await connectWhatsAppChannel(actor, input);
    if (result.channelId) revalidateChannels();
    return ok(result);
  } catch (error) {
    return failure(error);
  }
}

// ─── Paso 2 · Webhook ([WA-12]–[WA-16]) ─────────────────────────────────────────────────────────────────

/** The automatic subscription of the app to the installation's address; `confirmReplace` after the dialog. */
export async function subscribeWebhookAction(channelId: unknown, input: unknown): Promise<ActionResult<SubscribeAppResult>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return ok(await subscribeWhatsAppApp(actor, id.data, input));
  } catch (error) {
    return failure(error);
  }
}

/** Last correct verification by Meta: the manual way polls it to turn green live ([WA-13]). */
export async function webhookVerificationAction(): Promise<ActionResult<{ verifiedAt: Date | null }>> {
  try {
    const actor = await manager();
    const { verifiedAt } = await getWhatsAppWebhookSetup(actor);
    return ok({ verifiedAt });
  } catch (error) {
    return failure(error);
  }
}

/** POST /{WABA}/subscribed_apps, always, checked afterwards: only then the channel is «conectado» ([WA-14]). */
export async function subscribeWabaAction(channelId: unknown): Promise<ActionResult<SubscribeWabaResult>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await subscribeWhatsAppWaba(actor, id.data);
    revalidateChannels();
    return ok(result);
  } catch (error) {
    return failure(error);
  }
}

// ─── Paso 3 · Activar ([WA-17]–[WA-22]) ─────────────────────────────────────────────────────────────────

/** The number as Meta sees it now (status, verification), to know whether it must be verified or registered. */
export async function checkNumberAction(channelId: unknown): Promise<ActionResult<WhatsAppValidationView>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return ok(await revalidateWhatsAppChannel(actor, id.data));
  } catch (error) {
    return failure(error);
  }
}

/** The ownership code by SMS or call, in Spanish; Meta is asked first whether it is already verified ([WA-19]). */
export async function requestCodeAction(channelId: unknown, input: unknown): Promise<ActionResult<RequestCodeResult>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return ok(await requestWhatsAppVerificationCode(actor, id.data, input));
  } catch (error) {
    return failure(error);
  }
}

export async function verifyCodeAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await verifyWhatsAppCode(actor, id.data, input);
    if (!result.ok) return fail(result.error);
    revalidateChannels();
    return ok(undefined, "Número verificado.");
  } catch (error) {
    return failure(error);
  }
}

/** Registration with a 6-digit PIN; each retry after an attempt needs `confirmRetry` ([WA-17], [WA-18]). */
export async function registerNumberAction(channelId: unknown, input: unknown): Promise<ActionResult<RegisterResult>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await registerWhatsAppNumber(actor, id.data, input);
    if (result.status === "registered") revalidateChannels();
    return ok(result);
  } catch (error) {
    return failure(error);
  }
}

/** A new PIN without knowing the old one, after Meta said it was wrong (133005) ([WA-17]). */
export async function changePinAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await changeWhatsAppPin(actor, id.data, input);
    if (!result.ok) return fail(result.error);
    return ok(undefined, "PIN cambiado. Ya puedes registrar el número con él.");
  } catch (error) {
    return failure(error);
  }
}

/** The wizard only ticks these two; the panel owns the rest of the WhatsApp settings. */
const checklistSchema = z.object({ appLiveConfirmed: z.boolean().optional(), paymentMethodConfirmed: z.boolean().optional() }).strict();

/** «App publicada (Live)» and «Método de pago en WhatsApp Manager», confirmed by hand ([WA-21]). */
export async function saveChecklistAction(channelId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = checklistSchema.safeParse(input);
    if (!parsed.success) return fail(INVALID_FORM);
    await updateWhatsAppSettings(actor, id.data, parsed.data);
    revalidateChannels();
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return failure(error);
  }
}

/** «Sincronizar plantillas» ([WA-22]). */
export async function syncTemplatesAction(channelId: unknown): Promise<ActionResult<TemplatesSyncResult>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return ok(await syncWhatsAppTemplatesNow(actor, id.data));
  } catch (error) {
    return failure(error);
  }
}

// ─── Paso 4 · Prueba ([WA-23], [WA-24]) ─────────────────────────────────────────────────────────────────

export type TestMessage = {
  conversationId: string;
  contactName: string | null;
  text: string | null;
  contentType: MessageContentType;
  createdAt: Date;
};

const sinceSchema = z.object({ since: z.iso.datetime() }).strict();

/** The newest customer message of this channel since `since` (when the step opened), or null while none arrived. */
export async function latestTestMessageAction(channelId: unknown, input: unknown): Promise<ActionResult<TestMessage | null>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = sinceSchema.safeParse(input);
    if (!parsed.success) return fail(INVALID_FORM);
    const since = new Date(parsed.data.since);
    const { items } = await listConversations(actor, { channelId: id.data, limit: TEST_CONVERSATIONS });
    for (const conversation of items) {
      if (!conversation.lastMessageAt || conversation.lastMessageAt < since) continue;
      const page = await listMessages(actor, { conversationId: conversation.id, limit: TEST_MESSAGES });
      const inbound = page.items.filter((message) => message.direction === "inbound" && message.createdAt >= since).at(-1);
      if (inbound) {
        return ok({ conversationId: conversation.id, contactName: conversation.contact?.name ?? null, text: inbound.text, contentType: inbound.contentType, createdAt: inbound.createdAt });
      }
    }
    return ok(null);
  } catch (error) {
    return failure(error);
  }
}

const testReplySchema = z.object({ conversationId: idSchema }).strict();

/**
 * «Enviar respuesta de prueba»: a free-text reply inside the 24 h window, sent like any person's reply. A person's
 * reply pauses the AI in that conversation; here it is lifted again, so the AI can be tried right after Paso 5.
 */
export async function sendTestReplyAction(channelId: unknown, input: unknown): Promise<ActionResult<{ status: MessageStatus; error: string | null }>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const parsed = testReplySchema.safeParse(input);
    if (!parsed.success) return fail(INVALID_FORM);
    const conversation = await getConversation(actor, parsed.data.conversationId);
    if (conversation.channel.id !== id.data) return fail("No se ha encontrado la conversación de prueba.");
    const sent = await sendHumanMessage(actor, { conversationId: conversation.id, text: TEST_REPLY_TEXT });
    if (sent.aiPausedUntil) await setConversationAi(actor, { conversationId: conversation.id, mode: "on" });
    return ok({ status: sent.status, error: sent.error?.message ?? null });
  } catch (error) {
    return failure(error);
  }
}

/** The guided diagnosis when nothing arrives after 2 minutes ([WA-24]). */
export async function diagnoseAction(channelId: unknown): Promise<ActionResult<DiagnosisStep[]>> {
  try {
    const actor = await manager();
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return ok(await diagnoseWhatsAppChannel(actor, id.data));
  } catch (error) {
    return failure(error);
  }
}
