// IMAP/SMTP sending ([COR-13], [COR-14], [COR-15], docs/integracion-correo.md §3.2–§3.3): the message is built once
// and goes by SMTP (envelope from the mailbox to the recipients); then, without failing a reply that already left,
// a copy goes to \Sent only if the server did not keep one (Gmail does; otherwise we look for its Message-ID first),
// the mailbox draft is removed, and the email answered gets the «IA-Respondido» keyword when the folder takes
// keywords. A draft reply is appended to \Drafts with \Draft, so the business sees it in its email program.
import "server-only";
import { safeErrorMessage } from "@/server/redact";
import type { ChannelRecord, OutboundMessage, SendResult } from "../../types";
import { composeEmail } from "../compose";
import { readEmailConfig, type MailboxDraft } from "../config";
import type { EmailDeps } from "../provider";
import type { ReplyContext } from "../reply-context";
import { closeImap, openImap, openSmtp, type ImapClientLike, type MailConnectors } from "./connection";
import { savesSentAutomatically } from "./presets";
import { imapSettingsOf, type ImapChannelSettings } from "./settings";

export const ANSWERED_KEYWORD = "IA-Respondido";

async function withFolder<T>(client: ImapClientLike, path: string, work: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path);
  try {
    return await work();
  } finally {
    lock.release();
  }
}

async function findByMessageId(client: ImapClientLike, messageId: string): Promise<number[]> {
  const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
  return found || [];
}

/** Whether the mailbox keeps its own copy of what SMTP sends (then no APPEND). */
export function serverKeepsSent(channel: Pick<ChannelRecord, "config">, settings: ImapChannelSettings): boolean {
  const saved = readEmailConfig(channel.config).imap.savesSent;
  return saved === true || savesSentAutomatically(settings.imap.host) || savesSentAutomatically(settings.smtp.host);
}

/** What follows a sent reply in the mailbox. Best effort: the reply already left. */
async function tidyMailbox(channel: ChannelRecord, settings: ImapChannelSettings, raw: Buffer, context: ReplyContext, connectors?: MailConnectors): Promise<void> {
  const { sentPath, draftsPath } = readEmailConfig(channel.config).imap;
  const client = await openImap(settings.imap, connectors);
  try {
    if (sentPath && !serverKeepsSent(channel, settings)) {
      await withFolder(client, sentPath, async () => {
        if ((await findByMessageId(client, context.compose.messageId)).length === 0) await client.append(sentPath, raw, ["\\Seen"]);
      });
    }
    const draft = context.mailboxDraft;
    if (draft && draftsPath) {
      await withFolder(client, draftsPath, async () => {
        const uids = await findByMessageId(client, draft.rfcMessageId);
        if (uids.length > 0) await client.messageDelete(uids.join(","), { uid: true });
      });
    }
    const position = context.original?.imap;
    if (position) {
      await withFolder(client, position.folder, async () => {
        const mailbox = client.mailbox;
        const takesKeywords = mailbox && (!mailbox.permanentFlags || mailbox.permanentFlags.has("\\*"));
        if (mailbox && takesKeywords && String(mailbox.uidValidity) === position.uidValidity) {
          await client.messageFlagsAdd(String(position.uid), [ANSWERED_KEYWORD], { uid: true });
        }
      });
    }
  } finally {
    await closeImap(client);
  }
}

export async function sendImap(channel: ChannelRecord, _message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<SendResult> {
  const connectors = deps.mailConnectors;
  const settings = imapSettingsOf(channel);
  const raw = await composeEmail(context.compose);
  const smtp = await openSmtp(settings.smtp, connectors);
  try {
    await smtp.sendMail({ envelope: { from: settings.address, to: context.compose.to.map((item) => item.address) }, raw });
  } finally {
    smtp.close();
  }
  try {
    await tidyMailbox(channel, settings, raw, context, connectors);
  } catch (error) {
    console.warn(`[email] Enviado, pero no se pudo ordenar el buzón (Enviados, borrador o marca): ${safeErrorMessage(error)}`);
  }
  // Our Message-ID is the key: the copy in \Sent is recognized by it and never taken for a person's reply.
  return { externalId: context.compose.messageId, status: "sent", sentAt: deps.now?.() ?? new Date() };
}

/** The draft reply in \Drafts, or null when the server has no drafts folder. */
export async function createImapDraft(channel: ChannelRecord, _message: OutboundMessage, context: ReplyContext, deps: EmailDeps): Promise<{ draftId: string } | null> {
  const draftsPath = readEmailConfig(channel.config).imap.draftsPath;
  if (!draftsPath) return null;
  const settings = imapSettingsOf(channel);
  const raw = await composeEmail(context.compose);
  const client = await openImap(settings.imap, deps.mailConnectors);
  try {
    const appended = await client.append(draftsPath, raw, ["\\Draft", "\\Seen"]);
    return { draftId: appended && appended.uid ? String(appended.uid) : context.compose.messageId };
  } finally {
    await closeImap(client);
  }
}

export async function deleteImapDraft(channel: ChannelRecord, draft: MailboxDraft, deps: EmailDeps): Promise<void> {
  const draftsPath = readEmailConfig(channel.config).imap.draftsPath;
  if (!draftsPath) return;
  const client = await openImap(imapSettingsOf(channel).imap, deps.mailConnectors);
  try {
    await withFolder(client, draftsPath, async () => {
      const uids = await findByMessageId(client, draft.rfcMessageId);
      if (uids.length > 0) await client.messageDelete(uids.join(","), { uid: true });
    });
  } finally {
    await closeImap(client);
  }
}
