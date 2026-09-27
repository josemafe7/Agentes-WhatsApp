// Outlook sending ([COR-08], [COR-14], [COR-15], docs/integracion-correo.md §2.4): always createReply → PATCH (text
// with the signature, and the From of the email answered as its only recipient: Exchange would address it to the
// Reply-To, [COR-25]) → /send, with immutable ids, because `reply` returns 202 with nothing to find the sent copy by.
// Exchange keeps the thread (conversationId). Our x- header can only be set at creation ([F44]): in JSON first and, if
// Graph refuses it there, by creating the reply from our own MIME message ([F42]), which carries every header of ours
// with the text, the file and the threading headers. If neither takes it, nothing leaves: everything the app sends
// carries it ([COR-18]). Auto-Submitted cannot be set through JSON: only the MIME route may carry it, and whether
// Exchange keeps it is not verified. In draft mode the createReply draft is what the business sees in Outlook;
// approving it sends that same draft.
import "server-only";
import { GraphApiError, type GraphClient, type GraphDraft } from "@/lib/microsoft/graph";
import { ChannelSendError, type ChannelRecord, type OutboundMessage, type SendResult } from "../../types";
import { composeEmail } from "../compose";
import type { MailboxDraft } from "../config";
import { DOMINIA_HEADER, DOMINIA_HEADER_VALUE } from "../constants";
import type { EmailDeps } from "../provider";
import type { ReplyContext } from "../reply-context";
import { graphClientFor } from "./client";

const HEADER_REFUSED = "Outlook no ha dejado poner a la respuesta la marca de la app que evita bucles de respuestas automáticas: no se ha enviado.";

function originalIdOf(context: ReplyContext): string {
  const id = context.original?.providerId;
  if (!id) throw new ChannelSendError("No se encuentra el correo al que hay que responder.", false);
  return id;
}

async function addAttachments(client: GraphClient, draftId: string, context: ReplyContext): Promise<void> {
  for (const file of context.compose.attachments ?? []) {
    try {
      await client.addFileAttachment(draftId, { name: file.fileName, contentType: file.contentType, content: file.content });
    } catch (error) {
      if (error instanceof GraphApiError && error.code === "attachment_too_large") throw new ChannelSendError("Outlook solo admite aquí archivos de hasta 3 MB.", false);
      throw error;
    }
  }
}

const refused = (error: unknown) => error instanceof GraphApiError && error.httpStatus === 400;

/** A reply draft in the thread with our header, the text (and file) of the message, and only its recipient. */
async function createReplyDraft(client: GraphClient, context: ReplyContext): Promise<string> {
  const originalId = originalIdOf(context);
  let draft: GraphDraft | null = null;
  try {
    draft = await client.createReply(originalId, { headers: { [DOMINIA_HEADER]: DOMINIA_HEADER_VALUE } });
  } catch (error) {
    if (!refused(error)) throw error;
  }
  if (draft) {
    await client.updateDraft(draft.id, { text: context.compose.text, to: context.compose.to });
    await addAttachments(client, draft.id, context);
    return draft.id;
  }
  // The header in JSON was refused: the same reply from our MIME message (text and file included).
  try {
    draft = await client.createReplyMime(originalId, await composeEmail(context.compose));
  } catch (error) {
    if (refused(error)) throw new ChannelSendError(HEADER_REFUSED, false);
    throw error;
  }
  await client.updateDraft(draft.id, { to: context.compose.to });
  return draft.id;
}

export async function sendOutlook(channel: ChannelRecord, _message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<SendResult> {
  const client = graphClientFor(channel, deps);
  let draftId: string | null = context.mailboxDraft?.draftId ?? null;
  if (draftId) {
    try {
      // The person may have edited the text in the inbox: the draft gets the final one, and only its recipient.
      await client.updateDraft(draftId, { text: context.compose.text, to: context.compose.to });
    } catch (error) {
      if (!(error instanceof GraphApiError && error.httpStatus === 404)) throw error;
      draftId = null;
    }
  }
  draftId ??= await createReplyDraft(client, context);
  await client.sendDraft(draftId);
  return { externalId: draftId, status: "sent", sentAt: deps.now?.() ?? new Date() };
}

export async function createOutlookDraft(channel: ChannelRecord, _message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<{ draftId: string }> {
  return { draftId: await createReplyDraft(graphClientFor(channel, deps), context) };
}

export async function deleteOutlookDraft(channel: ChannelRecord, draft: MailboxDraft, deps: EmailDeps): Promise<void> {
  try {
    await graphClientFor(channel, deps).deleteMessage(draft.draftId);
  } catch (error) {
    if (!(error instanceof GraphApiError && error.httpStatus === 404)) throw error;
  }
}
