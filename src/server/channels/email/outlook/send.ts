// Outlook sending ([COR-08], [COR-14], [COR-15], docs/integracion-correo.md §2.4): always createReply → PATCH (text
// with the signature) → /send, with immutable ids, because `reply` returns 202 with nothing to find the sent copy by.
// Exchange keeps the thread (conversationId). Our x- header can only be set at creation ([F44]); if Graph refuses it,
// the reply is created without it (the immutable id still tells our copy apart). Auto-Submitted cannot be set through
// JSON: Outlook replies never carry it until the MIME route is verified ([COR-18]). In draft mode the createReply
// draft is what the business sees in Outlook; approving it sends that same draft.
import "server-only";
import { GraphApiError, type GraphClient } from "@/lib/microsoft/graph";
import { ChannelSendError, type ChannelRecord, type OutboundMessage, type SendResult } from "../../types";
import type { MailboxDraft } from "../config";
import { DOMINIA_HEADER, DOMINIA_HEADER_VALUE } from "../constants";
import type { EmailDeps } from "../provider";
import type { ReplyContext } from "../reply-context";
import { graphClientFor } from "./client";

function originalIdOf(context: ReplyContext): string {
  const id = context.original?.providerId;
  if (!id) throw new ChannelSendError("No se encuentra el correo al que hay que responder.", false);
  return id;
}

async function fillDraft(client: GraphClient, draftId: string, context: ReplyContext): Promise<void> {
  await client.setTextBody(draftId, context.compose.text);
  for (const file of context.compose.attachments ?? []) {
    try {
      await client.addFileAttachment(draftId, { name: file.fileName, contentType: file.contentType, content: file.content });
    } catch (error) {
      if (error instanceof GraphApiError && error.code === "attachment_too_large") throw new ChannelSendError("Outlook solo admite aquí archivos de hasta 3 MB.", false);
      throw error;
    }
  }
}

/** A reply draft in the thread with our header when Graph takes it, and the text (and file) of the message. */
async function createReplyDraft(client: GraphClient, context: ReplyContext): Promise<string> {
  const originalId = originalIdOf(context);
  let draft;
  try {
    draft = await client.createReply(originalId, { headers: { [DOMINIA_HEADER]: DOMINIA_HEADER_VALUE } });
  } catch (error) {
    if (!(error instanceof GraphApiError && error.httpStatus === 400)) throw error;
    draft = await client.createReply(originalId);
  }
  await fillDraft(client, draft.id, context);
  return draft.id;
}

export async function sendOutlook(channel: ChannelRecord, _message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<SendResult> {
  const client = graphClientFor(channel, deps);
  let draftId: string | null = context.mailboxDraft?.draftId ?? null;
  if (draftId) {
    try {
      // The person may have edited the text in the inbox: the draft gets the final one.
      await client.setTextBody(draftId, context.compose.text);
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
