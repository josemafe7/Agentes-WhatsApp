// Everything a connector needs to send one of our messages as a reply in its thread ([COR-06], [COR-18], [COR-21]):
// the email it answers (the newest customer email of the conversation), to whom (its From only: a Reply-To is whatever
// the sender wrote, [COR-25]), the subject
// and threading headers, our Message-ID, the headers of the mode (Auto-Submitted only when the AI sends on its own),
// the text with the AI signature, a file a person attached, and the mailbox draft made for it, if any. System code.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { ChannelType } from "@/lib/enums";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { channels, contactIdentities, messages } from "@/db/schema";
import { ChannelSendError, type ChannelRecord, type OutboundMessage } from "../types";
import { attachmentFromMedia, type ComposeInput } from "./compose";
import { readEmailConfig, type MailboxDraft } from "./config";
import { messageIdFor, outgoingHeaders, replySubject, replyThreading, sendModeOf, type SendMode } from "./headers";
import { readEmailMetadata, subjectOf, type EmailMetadata } from "./metadata";
import type { MailAddress } from "./parse";
import { withEmailSignature } from "./signature";

export type ReplyContext = {
  /** Our message row. */
  messageId: string;
  mode: SendMode;
  /** The customer email answered (its provider id: Gmail labels it, Outlook replies to it). */
  original: EmailMetadata | null;
  /** Everything for composeEmail (Gmail and IMAP; Outlook uses to/text only). */
  compose: ComposeInput;
  /** The draft of this message left in the mailbox, if any ([COR-14]). */
  mailboxDraft: MailboxDraft | null;
};

/** Customer messages looked at to find the last email (its attachments come as messages of their own). */
const LATEST_EMAIL_WINDOW = 30;

/** The newest customer email of the conversation that is not an attachment of another. */
export async function latestCustomerEmail(conversationId: string): Promise<{ metadata: EmailMetadata; subject: string | null } | null> {
  const rows = await db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "inbound"), eq(messages.senderType, "contact")))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(LATEST_EMAIL_WINDOW);
  for (const row of rows) {
    const metadata = readEmailMetadata(row.metadata);
    if (metadata && !metadata.attachmentOf) return { metadata, subject: subjectOf(row.metadata) };
  }
  return null;
}

function recipientsOf(original: EmailMetadata | null, fallback: OutboundMessage["recipient"], own: string | null): MailAddress[] {
  // Never the Reply-To: anyone can write one, and it would send the answer (maybe with a customer's data) elsewhere.
  if (original?.from && original.from.address !== own) return [original.from];
  const address = fallback.email ?? fallback.externalIds.find((id) => id.includes("@")) ?? null;
  return address ? [{ address: address.toLowerCase(), name: fallback.name }] : [];
}

/**
 * `draft`: the context of the mailbox draft of a draft reply. A person will approve it, so it is never «automatic»
 * and its signature says a person reviewed it.
 */
export async function loadReplyContext(channel: ChannelRecord, message: OutboundMessage, options: { draft?: boolean } = {}): Promise<ReplyContext> {
  const [row] = await db
    .select({ id: messages.id, senderType: messages.senderType, metadata: messages.metadata, text: messages.text, contentType: messages.contentType, media: messages.media })
    .from(messages)
    .where(eq(messages.id, message.messageId));
  if (!row) throw new ChannelSendError("No se ha encontrado el mensaje que había que enviar.", false);
  if (row.contentType !== "text" && row.contentType !== "image" && row.contentType !== "document") {
    throw new ChannelSendError("Este tipo de mensaje no se puede enviar por correo.", false);
  }
  // The channel as it is now: the address and the mailbox drafts may have changed since the caller loaded it.
  const [current] = await db.select({ config: channels.config }).from(channels).where(eq(channels.id, channel.id));
  const config = readEmailConfig(current?.config ?? channel.config);
  const own = config.emailAddress?.toLowerCase() ?? null;
  if (!own) throw new ChannelSendError("Falta la dirección del buzón. Vuelve a conectar el canal.", false);

  const latest = await latestCustomerEmail(message.conversationId);
  const original = latest?.metadata ?? null;
  const to = recipientsOf(original, message.recipient, own);
  const mode: SendMode = options.draft ? "approved" : sendModeOf(row);
  const { name: businessName } = await loadBusinessSettings();
  const threading = original ? replyThreading(original) : { inReplyTo: null, references: [] };
  const text = withEmailSignature(message.text ?? row.text ?? "", {
    senderType: row.senderType,
    reviewed: mode === "approved",
    signature: config.signature,
    businessName,
  });
  return {
    messageId: row.id,
    mode,
    original,
    // An entry without id means the mailbox had nowhere to keep the draft.
    mailboxDraft: config.mailboxDrafts[row.id]?.draftId ? config.mailboxDrafts[row.id] : null,
    compose: {
      from: { address: own, name: businessName ?? null },
      to,
      subject: replySubject(latest?.subject ?? subjectOf(row.metadata)),
      text,
      messageId: messageIdFor(row.id, own),
      inReplyTo: threading.inReplyTo,
      references: threading.references,
      headers: outgoingHeaders(mode),
      attachments: row.contentType === "text" ? [] : await attachmentFromMedia(message.media ?? row.media),
    },
  };
}

/**
 * The contact a reply of this email conversation goes to: the one whose address is the From of the newest customer
 * email (a thread takes emails from anyone, [CAN-12]); the conversation's own contact when there is none or it is not
 * known. For the opt-out ([CUM-03]) and test-mode checks of whoever the reply reaches.
 */
export async function replyRecipientContactId(conversationId: string, channelType: ChannelType, fallback: string | null): Promise<string | null> {
  const address = (await latestCustomerEmail(conversationId))?.metadata.from?.address;
  if (!address) return fallback;
  const [identity] = await db
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channelType, channelType), eq(contactIdentities.externalId, address.toLowerCase())))
    .limit(1);
  return identity?.contactId ?? fallback;
}
