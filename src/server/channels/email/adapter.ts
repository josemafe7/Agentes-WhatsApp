// The three email ChannelAdapters (Gmail, Outlook, IMAP/SMTP), registered in src/server/channels/registry.ts and used
// by the common engine: capabilities (drafts, HTML, files), connect/revalidate, health, send (one reply in its
// thread, [COR-06], [COR-08], [COR-13]) and disconnect. Email has no webhooks: mail comes in through the poll job
// (jobs.ts). Demo email channels and replies to simulated messages never get here (DemoAdapter, [ARR-11], [AJU-13]).
import "server-only";
import { AppError } from "@/server/errors";
import { safeErrorMessage } from "@/server/redact";
import { DEFAULT_CAPABILITIES } from "../capabilities";
import { ChannelSendError, type ChannelAdapter, type ChannelRecord, type OutboundMessage, type SendResult } from "../types";
import { readEmailConfig, updateEmailConfig, type EmailChannelType } from "./config";
import { describeProviderError } from "./errors";
import { gmailProvider } from "./gmail/provider";
import { imapProvider } from "./imap/provider";
import { outlookProvider } from "./outlook/provider";
import type { EmailDeps, EmailProvider } from "./provider";
import { loadReplyContext } from "./reply-context";
import { markReconnectRequired } from "./status";

const PROVIDERS: Record<EmailChannelType, EmailProvider> = {
  email_gmail: gmailProvider,
  email_outlook: outlookProvider,
  email_imap: imapProvider,
};

export function emailProviderFor(type: EmailChannelType): EmailProvider {
  return PROVIDERS[type];
}

/** Forgets the mailbox draft of a message once it was sent (or discarded). */
export async function forgetMailboxDraft(channelId: string, messageId: string): Promise<void> {
  await updateEmailConfig(channelId, (current) => {
    if (!current.mailboxDrafts[messageId]) return {};
    const drafts = { ...current.mailboxDrafts };
    delete drafts[messageId];
    return { mailboxDrafts: drafts };
  });
}

/** Sends one of our messages; every failure becomes a ChannelSendError, and a lost access marks the channel. */
export async function sendEmail(provider: EmailProvider, channel: ChannelRecord, message: OutboundMessage, deps: EmailDeps = {}): Promise<SendResult> {
  // A mailbox waiting for a new connection sends nothing until it has one ([COR-22]).
  const waiting = readEmailConfig(channel.config).reconnect;
  if (waiting) throw new ChannelSendError(waiting.reason, false);
  let result: SendResult;
  let messageId: string;
  try {
    const context = await loadReplyContext(channel, message);
    messageId = context.messageId;
    result = await provider.send(channel, message, context, deps);
  } catch (error) {
    const failure = describeProviderError(error, provider.type);
    if (failure.reconnect) await markReconnectRequired(channel, failure.reconnect, deps.now?.() ?? new Date());
    if (error instanceof ChannelSendError) throw error;
    throw new ChannelSendError(failure.message, failure.retryable, failure.code);
  }
  // The reply already left: bookkeeping never turns it into a failure (a retry would send it twice).
  try {
    await forgetMailboxDraft(channel.id, messageId);
  } catch (error) {
    console.warn(`[email] No se pudo olvidar el borrador del buzón: ${safeErrorMessage(error)}`);
  }
  return result;
}

export function createEmailAdapter(provider: EmailProvider, deps: EmailDeps = {}): ChannelAdapter {
  return {
    type: provider.type,
    capabilities: () => DEFAULT_CAPABILITIES[provider.type],
    validateAndConnect: (channel, input) => provider.validateAndConnect(channel, input, deps),
    healthCheck: (channel) => provider.healthCheck(channel, deps),
    // Email is polled (jobs.ts): there are no webhooks to turn into events.
    async handleWebhook() {
      return [];
    },
    send: (channel, message) => sendEmail(provider, channel, message, deps),
    async downloadMedia() {
      // Attachments are stored when the email is read: there is nothing to download later.
      throw new AppError(404, "email_no_media", "Los adjuntos del correo ya están guardados con su mensaje.");
    },
    disconnect: (channel) => provider.disconnect(channel, deps),
  };
}

export const gmailAdapter = createEmailAdapter(gmailProvider);
export const outlookAdapter = createEmailAdapter(outlookProvider);
export const imapAdapter = createEmailAdapter(imapProvider);
