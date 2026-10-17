// Sending a direct message on Instagram ([IG-03]–[IG-05], [IG-12], docs/integracion-instagram.md §6): text only (decision
// 0029), one message per call (a single reply per turn), to the customer's Instagram-scoped id. A text longer than
// Instagram's 1,000 bytes is cut with «…», never split (the client fits it). Errors come in Spanish; one that is worth
// another try is retried once by the common sending (src/server/outbound/send.ts). Instagram saying the 24 h window is
// closed marks the conversation, so the inbox shows it closed until the customer writes again ([BAN-18]); a problem of
// the account itself puts the channel in «error» at once and tells the managers ([IG-09]).
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import type { InstagramClient } from "@/lib/instagram/client";
import { InstagramApiError } from "@/lib/instagram/errors";
import { WINDOW_CLOSED_METADATA_KEY } from "@/lib/meta/window";
import { safeErrorMessage } from "@/server/redact";
import { ChannelSendError, type OutboundMessage, type SendResult } from "../types";

export const INSTAGRAM_TEXT_ONLY = "Instagram solo admite texto desde la app.";
const UNEXPECTED = "No se ha podido enviar el mensaje por un error inesperado.";
/** Instagram-scoped ids are digits (§5.1). */
const IGSID = /^\d{1,32}$/;

/** Meta said the window is closed although our count says open: closed until the customer writes again ([IG-04]). */
export async function markInstagramWindowClosed(conversationId: string, now: Date = new Date()): Promise<void> {
  const [row] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId));
  if (!row) return;
  await db
    .update(conversations)
    .set({ metadata: { ...row.metadata, [WINDOW_CLOSED_METADATA_KEY]: now.toISOString() }, updatedAt: now })
    .where(eq(conversations.id, conversationId));
}

export type InstagramSendHooks = {
  /** The account itself failed (token, permissions, Instagram blocking it): `detail` says what and what to do. */
  onAccountError?: (detail: string) => Promise<void>;
  now?: () => Date;
};

/** The Spanish text of a failure: what happened and what to do. */
const failureText = (error: InstagramApiError) => `${error.userMessage} ${error.action}`.trim();

/**
 * Sends one text message and returns its `mid`. Throws ChannelSendError with the Spanish message and Instagram's code;
 * `retryable` when another try may work (the common sending tries once more).
 */
export async function sendInstagramMessage(client: InstagramClient, message: OutboundMessage, hooks: InstagramSendHooks = {}): Promise<SendResult> {
  if (message.contentType !== "text") throw new ChannelSendError(INSTAGRAM_TEXT_ONLY, false);
  const text = message.text?.trim();
  if (!text) throw new ChannelSendError("El mensaje está vacío.", false);
  const recipientId = message.recipient.externalIds.find((id) => IGSID.test(id));
  if (!recipientId) throw new ChannelSendError("El contacto no tiene un usuario de Instagram al que escribir.", false);
  try {
    const sent = await client.sendText({ recipientId, text });
    // Instagram only tells «seen» later (§6.1): until then it is «enviado».
    return { externalId: sent.message_id, status: "sent", sentAt: hooks.now?.() ?? new Date() };
  } catch (error) {
    if (!(error instanceof InstagramApiError)) {
      console.error(`[instagram] Envío fallido: ${safeErrorMessage(error)}`);
      throw new ChannelSendError(UNEXPECTED, false);
    }
    if (error.window) await markInstagramWindowClosed(message.conversationId, hooks.now?.());
    if (error.account) await hooks.onAccountError?.(failureText(error)).catch((cause: unknown) => console.error(`[instagram] No se pudo marcar el error del canal: ${safeErrorMessage(cause)}`));
    throw new ChannelSendError(failureText(error), error.retryable, error.code ?? undefined);
  }
}
