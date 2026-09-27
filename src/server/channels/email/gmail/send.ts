// Gmail sending ([COR-06], [COR-14], [COR-15], docs/integracion-correo.md §1.5): the reply goes in the same thread
// (threadId, In-Reply-To, References and the same subject), the email answered gets the «IA/Respondido» label
// (created if missing, «IA» first), a draft reply is a Gmail draft in the thread (drafts.create) and approving it sends
// that very draft (drafts.send with the final text), so it disappears from the drafts.
import "server-only";
import { GmailApiError, toGmailRaw, type GmailClient } from "@/lib/google/gmail";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord, OutboundMessage, SendResult } from "../../types";
import { composeEmail } from "../compose";
import { readEmailConfig, updateEmailConfig, type MailboxDraft } from "../config";
import type { EmailDeps } from "../provider";
import type { ReplyContext } from "../reply-context";
import { gmailClientFor } from "./client";

export const ANSWERED_LABEL_PARENT = "IA";
export const ANSWERED_LABEL = "IA/Respondido";

/** Id of «IA/Respondido», created (with its parent «IA») when the mailbox does not have it yet. */
export async function ensureAnsweredLabel(channel: Pick<ChannelRecord, "id" | "config">, client: GmailClient): Promise<string> {
  const stored = readEmailConfig(channel.config).gmail.labelId;
  if (stored) return stored;
  const labels = await client.listLabels();
  let label = labels.find((item) => item.name === ANSWERED_LABEL);
  if (!label) {
    // Nesting with «/» is not documented: the parent is created first, just in case ([F20]).
    if (!labels.some((item) => item.name === ANSWERED_LABEL_PARENT)) {
      try {
        await client.createLabel(ANSWERED_LABEL_PARENT);
      } catch (error) {
        if (!(error instanceof GmailApiError && (error.httpStatus === 409 || error.httpStatus === 400))) throw error;
      }
    }
    label = await client.createLabel(ANSWERED_LABEL);
  }
  await updateEmailConfig(channel.id, { gmail: { labelId: label.id } });
  return label.id;
}

/** Best effort: a missing label never fails a reply that already left. */
async function labelAnswered(channel: ChannelRecord, client: GmailClient, originalId: string | null | undefined): Promise<void> {
  if (!originalId) return;
  try {
    const labelId = await ensureAnsweredLabel(channel, client);
    try {
      await client.addLabels(originalId, [labelId]);
    } catch (error) {
      // The label was deleted in Gmail: forget it and create it again once.
      if (!(error instanceof GmailApiError && (error.httpStatus === 400 || error.httpStatus === 404))) throw error;
      await updateEmailConfig(channel.id, { gmail: { labelId: null } });
      const fresh = await ensureAnsweredLabel({ id: channel.id, config: {} }, client);
      await client.addLabels(originalId, [fresh]);
    }
  } catch (error) {
    console.warn(`[email] No se pudo poner la etiqueta «${ANSWERED_LABEL}»: ${safeErrorMessage(error)}`);
  }
}

export async function sendGmail(channel: ChannelRecord, message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<SendResult> {
  const client = gmailClientFor(channel, deps);
  const raw = toGmailRaw(await composeEmail(context.compose));
  const threadId = message.threadId;
  let sent;
  if (context.mailboxDraft) {
    try {
      sent = await client.sendDraft({ id: context.mailboxDraft.draftId, raw, threadId });
    } catch (error) {
      // Deleted in Gmail meanwhile: the reply still goes, as a new message in the thread.
      if (!(error instanceof GmailApiError && error.httpStatus === 404)) throw error;
      sent = await client.sendMessage({ raw, threadId });
    }
  } else {
    sent = await client.sendMessage({ raw, threadId });
  }
  await labelAnswered(channel, client, context.original?.providerId);
  return { externalId: sent.id, status: "sent", sentAt: deps.now?.() ?? new Date() };
}

export async function createGmailDraft(channel: ChannelRecord, message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<{ draftId: string }> {
  const client = gmailClientFor(channel, deps);
  const draft = await client.createDraft({ raw: toGmailRaw(await composeEmail(context.compose)), threadId: message.threadId });
  return { draftId: draft.id };
}

export async function deleteGmailDraft(channel: ChannelRecord, draft: MailboxDraft, deps: EmailDeps): Promise<void> {
  try {
    await gmailClientFor(channel, deps).deleteDraft(draft.draftId);
  } catch (error) {
    if (!(error instanceof GmailApiError && error.httpStatus === 404)) throw error;
  }
}
