// The email thread of an inbox conversation and its replies ([BAN-09], [BAN-11], [COR-06], [COR-14], [COR-19]–[COR-21]):
// what each email shows (subject, from, to, CC, date, folded quoted text, attachments), the AI's drafts discarded here
// and in the mailbox at once, and a person's reply with the business signature. Approving or editing a draft is the
// inbox's own approveDraft (src/data/messages.ts): the email adapter sends it in the same thread, without
// Auto-Submitted ([COR-15], [COR-18]). Who may do what, as the rest of the inbox: seeing it is «Bandeja: ver», replying
// «responder» and drafts «aprobar, editar o descartar», on the conversation's channel ([PER-02], [PER-03]).
import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, contactIdentities, contacts, messages } from "@/db/schema";
import type { ChannelType } from "@/lib/enums";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { isEmailChannelType, readEmailConfig } from "@/server/channels/email/config";
import { discardMailboxDraftOf } from "@/server/channels/email/drafts";
import { replySubject } from "@/server/channels/email/headers";
import { readEmailMetadata, subjectOf, type EmailMetadata } from "@/server/channels/email/metadata";
import type { EmailDeps } from "@/server/channels/email/provider";
import { withEmailSignature } from "@/server/channels/email/signature";
import { AuthError, ConflictError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { storeInboundMedia } from "@/server/media/store";
import { sendOutbound } from "@/server/outbound/send";
import { loadConversationFor } from "./conversation-scope";
import { afterHumanReply, detectAttachment, discardDraft, discardDraftSchema, MAX_ATTACHMENT_BYTES, MAX_HUMAN_TEXT, type SendHumanResult } from "./messages";
import { loadBusinessSettings } from "./settings";

export { isEmailChannelType };

/** Messages of the thread described at once (the inbox's pages are 50; «Cargar anteriores» asks for more). */
export const MAX_THREAD_MESSAGES = 200;
/** Customer emails looked at to know whom each reply goes to. */
const CUSTOMER_EMAILS_WINDOW = 200;
const SIGNATURE_SEPARATOR = "-- \n";

export type EmailAddressView = { address: string; name: string | null };

export type EmailMessageView = {
  /** This email's own subject, only when it is not the thread's (the customer changed it). */
  subject: string | null;
  /** The subject the stored text starts with («Asunto: …», the first email of a thread): the card shows it apart. */
  subjectLine: string | null;
  from: EmailAddressView | null;
  to: EmailAddressView[];
  cc: EmailAddressView[];
  /** When it was written (its Date header) or sent; null while it has not left. */
  date: Date | null;
  /** Quoted history and signature were taken out of the text: «Mostrar el texto citado» ([COR-19]). */
  quoted: boolean;
  /** The text was cut: «Ver el correo completo». */
  truncated: boolean;
  /** Files that came with this email (each one is also a message of its own, below it). */
  attachments: string[];
  /** A person wrote it from the mailbox itself ([COR-20]). */
  fromMailbox: boolean;
  /** Who approved this AI reply from the inbox, and whether they edited it first ([CAN-07]). */
  approvedBy: string | null;
  edited: boolean;
  /**
   * A customer email: whether the server that received it vouched for its From ([COR-25]); false shows «Remitente no
   * verificado». Null for ours, a person's from the mailbox and the demo's.
   */
  senderVerified: boolean | null;
  /** The Reply-To addresses it asked for (other than its From): replies go only to the From ([COR-25]). */
  replyToIgnored: EmailAddressView[];
};

export type EmailThreadView = {
  conversationId: string;
  subject: string | null;
  mailbox: string | null;
  /** The next reply: to whom (only the From of the newest email, [COR-25]) and with which subject ([COR-06]). */
  reply: { to: EmailAddressView[]; subject: string };
  /** What a person's reply from the inbox ends with ([COR-21]); null without a signature or business name. */
  replySignature: string | null;
  /** What an AI draft gets once approved: the signature and the AI notice. Null in a demo mailbox, which adds none. */
  draftSignature: string | null;
  /** «Requiere reconexión»: why nothing leaves until the mailbox is connected again ([COR-22]). */
  reconnect: string | null;
  /** The channel's page, to reconnect it: only for who may manage channels. */
  channelHref: string | null;
  /** By message id: the customer's emails and ours (text messages; attachments show as their own messages). */
  messages: Record<string, EmailMessageView>;
};

type MessageRow = typeof messages.$inferSelect;
type CustomerEmail = { createdAt: Date; metadata: EmailMetadata; subject: string | null };

// ─── The thread ─────────────────────────────────────────────────────────────────────────────────────────

export const emailThreadSchema = z
  .object({
    // Checked by loadConversationFor: a bad id is «no permission», as any conversation that is not the person's.
    conversationId: z.string().max(100),
    messageIds: z.array(idSchema).max(MAX_THREAD_MESSAGES).default([]),
  })
  .strict();

/** The email thread of a conversation with the details of `messageIds`; null when it is not an email conversation. */
export async function getEmailThread(actor: Actor, input: unknown): Promise<EmailThreadView | null> {
  const data = parseInput(emailThreadSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, data.conversationId);
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  if (!channel || !isEmailChannelType(channel.type)) return null;

  const config = readEmailConfig(channel.config);
  const mailbox = config.emailAddress?.toLowerCase() ?? null;
  const { name: businessName } = await loadBusinessSettings();
  const contact = await contactAddress(conversation.contactId, channel.type);
  const customerEmails = await loadCustomerEmails(conversation.id);
  const rows =
    data.messageIds.length > 0
      ? await db
          .select()
          .from(messages)
          .where(and(eq(messages.conversationId, conversation.id), inArray(messages.id, data.messageIds)))
          .orderBy(asc(messages.createdAt))
      : [];

  const threadSubject = subjectOf(conversation.metadata) ?? customerEmails.find((email) => email.subject)?.subject ?? null;
  const context: ViewContext = { mailbox, businessName, contact, customerEmails, threadSubject, attachments: attachmentsByEmail(rows) };
  const views: Record<string, EmailMessageView> = {};
  for (const row of rows) {
    const view = viewOf(row, context);
    if (view) views[row.id] = view;
  }

  const latest = customerEmails.at(-1) ?? null;
  const signature = channelSignature(config.signature, businessName);
  return {
    conversationId: conversation.id,
    subject: threadSubject,
    mailbox,
    // Without any customer email (demo, simulator) the thread's subject stands in.
    reply: { to: recipientsOf(latest?.metadata ?? null, contact, mailbox), subject: replySubject(latest ? latest.subject : threadSubject) },
    replySignature: signature ? `${SIGNATURE_SEPARATOR}${signature}` : null,
    draftSignature: channel.isDemo ? null : withEmailSignature("", { senderType: "ai", reviewed: true, signature: config.signature, businessName }).trim(),
    reconnect: config.reconnect?.reason ?? null,
    channelHref: can(actor, PERMISSIONS.channels.manage) ? `/canales/${channel.id}` : null,
    messages: views,
  };
}

/** The signature of the channel, else the business name: the same choice as the AI's (signature.ts). */
function channelSignature(signature: string | null | undefined, businessName: string | null | undefined): string | null {
  return (signature?.trim() || businessName?.trim() || "").replace(/\r\n?/g, "\n") || null;
}

/** The contact's address in this mailbox: their email, else their email identity (reply-context.ts does the same). */
async function contactAddress(contactId: string | null, channelType: ChannelType): Promise<EmailAddressView | null> {
  if (!contactId) return null;
  const [contact] = await db.select({ name: contacts.name, email: contacts.email }).from(contacts).where(eq(contacts.id, contactId));
  const identities = await db
    .select({ externalId: contactIdentities.externalId })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.channelType, channelType)))
    .orderBy(asc(contactIdentities.createdAt));
  const address = contact?.email ?? identities.find((identity) => identity.externalId.includes("@"))?.externalId ?? null;
  return address ? { address: address.toLowerCase(), name: contact?.name ?? null } : null;
}

/** The customer's emails of the conversation (not their attachments), oldest first. */
async function loadCustomerEmails(conversationId: string): Promise<CustomerEmail[]> {
  const rows = await db
    .select({ createdAt: messages.createdAt, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "inbound"), eq(messages.senderType, "contact")))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(CUSTOMER_EMAILS_WINDOW);
  const emails: CustomerEmail[] = [];
  for (const row of rows.reverse()) {
    const metadata = readEmailMetadata(row.metadata);
    if (metadata && !metadata.attachmentOf) emails.push({ createdAt: row.createdAt, metadata, subject: subjectOf(row.metadata) });
  }
  return emails;
}

/**
 * Whom a reply to `original` goes to: its From, never its Reply-To (anyone can write one, [COR-25]) nor the mailbox
 * itself, else the contact. The same rule as the adapter's (src/server/channels/email/reply-context.ts); a test checks
 * both give the same address.
 */
function recipientsOf(original: EmailMetadata | null, contact: EmailAddressView | null, own: string | null): EmailAddressView[] {
  if (original?.from && original.from.address !== own) return [original.from];
  return contact ? [contact] : [];
}

/** The Reply-To addresses of a customer email that are neither its From nor the mailbox: not answered ([COR-25]). */
function ignoredReplyTo(metadata: EmailMetadata, own: string | null): EmailAddressView[] {
  return metadata.replyTo.filter((item) => item.address !== metadata.from?.address && item.address !== own);
}

/** File names of the attachments among `rows`, by the provider id of their email. */
function attachmentsByEmail(rows: readonly MessageRow[]): Map<string, string[]> {
  const byEmail = new Map<string, string[]>();
  for (const row of rows) {
    const parent = readEmailMetadata(row.metadata)?.attachmentOf;
    if (!parent) continue;
    byEmail.set(parent, [...(byEmail.get(parent) ?? []), row.media?.fileName ?? "adjunto"]);
  }
  return byEmail;
}

type ViewContext = {
  mailbox: string | null;
  businessName: string | null;
  contact: EmailAddressView | null;
  customerEmails: readonly CustomerEmail[];
  threadSubject: string | null;
  attachments: Map<string, string[]>;
};

/** The newest customer email at `at`: what a reply sent then answered (a draft answers the newest). */
function answeredAt(emails: readonly CustomerEmail[], at: Date | null): CustomerEmail | null {
  if (!at) return emails.at(-1) ?? null;
  return emails.findLast((email) => email.createdAt.getTime() <= at.getTime()) ?? null;
}

function viewOf(row: MessageRow, context: ViewContext): EmailMessageView | null {
  if (row.contentType !== "text" || row.senderType === "system") return null;
  const metadata = readEmailMetadata(row.metadata);
  const ownSubject = subjectOf(row.metadata);
  const differentSubject = (subject: string | null) => (subject && !sameSubject(subject, context.threadSubject) ? subject : null);
  const base = {
    quoted: false,
    truncated: false,
    attachments: [] as string[],
    fromMailbox: false,
    approvedBy: typeof row.metadata.approvedByName === "string" ? row.metadata.approvedByName : null,
    edited: row.metadata.editedBeforeSending === true,
    senderVerified: null as boolean | null,
    replyToIgnored: [] as EmailAddressView[],
  };

  // An email that came from outside: the customer's, or a person's reply from the mailbox ([COR-20]).
  if (metadata) {
    const customer = row.direction === "inbound" && metadata.fromMailbox !== true;
    return {
      ...base,
      ...(customer ? { senderVerified: metadata.senderVerified === true, replyToIgnored: ignoredReplyTo(metadata, context.mailbox) } : {}),
      subject: differentSubject(ownSubject),
      subjectLine: row.direction === "inbound" ? ownSubject : null,
      from: metadata.from,
      to: metadata.to,
      cc: metadata.cc,
      date: row.sentAt ?? row.createdAt,
      quoted: metadata.quotedRemoved && Boolean(metadata.originalText),
      truncated: Boolean(metadata.truncated && metadata.originalText),
      attachments: context.attachments.get(metadata.providerId) ?? [],
      fromMailbox: metadata.fromMailbox === true,
    };
  }
  // The customer's, without headers (demo channels and the simulator).
  if (row.direction === "inbound") {
    return {
      ...base,
      subject: differentSubject(ownSubject),
      subjectLine: ownSubject,
      from: context.contact,
      to: context.mailbox ? [{ address: context.mailbox, name: null }] : [],
      cc: [],
      date: row.sentAt ?? row.createdAt,
    };
  }
  // Ours (the AI's or a person's from the inbox): from the mailbox to whom the reply went, or will go. What has not
  // left yet (a draft, a queued or failed send) answers the newest email when it leaves.
  const pending = row.status === "draft" || row.status === "queued" || row.status === "failed";
  const answered = answeredAt(context.customerEmails, pending ? null : (row.sentAt ?? row.createdAt));
  const answeredSubject = answered ? answered.subject : context.threadSubject;
  return {
    ...base,
    subject: differentSubject(ownSubject ?? (answeredSubject ? replySubject(answeredSubject) : null)),
    subjectLine: null,
    from: context.mailbox ? { address: context.mailbox, name: context.businessName } : null,
    to: recipientsOf(answered?.metadata ?? null, context.contact, context.mailbox),
    cc: [],
    date: row.status === "draft" ? null : row.sentAt,
  };
}

/** «Re:», «RE:», «Fwd:», «Fw:», «RV:» (Outlook in Spanish), «Rif:», «AW:», «WG:», repeated in any case. */
const REPLY_PREFIX = /^(?:(?:re|fwd?|rv|rif|aw|wg)\s*:\s*)+/i;

/** Whether two subjects are the same thread's: without reply prefixes, spaces or case ([COR-06]). */
export function sameSubject(a: string | null, b: string | null): boolean {
  const clean = (value: string | null) => (value ?? "").trim().replace(REPLY_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
  return clean(a) === clean(b);
}

// ─── The folded text ([COR-19]) ─────────────────────────────────────────────────────────────────────────

export const emailQuotedTextSchema = z.object({ messageId: z.string().max(100) }).strict();
export type EmailQuotedText = { kind: "quoted" | "full"; text: string };

/** Lines the app adds to an email's text: the subject on top, notes like «[…]» or «[Adjuntos que no…]». */
function isAppLine(line: string, index: number): boolean {
  return (index === 0 && line.startsWith("Asunto: ")) || line.startsWith("[");
}

/**
 * What came after the customer's own words in `original` (their signature and the quoted history), or null when the
 * body cannot be found in it. Line by line and linear: the last line of the body is looked for no earlier than the body
 * could end, so a line repeated inside the body does not cut it short.
 */
export function quotedPartOf(original: string, body: string): string | null {
  const bodyLines = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index) => line !== "" && !isAppLine(line, index));
  const last = bodyLines.at(-1);
  if (!last) return null;
  const lines = original.replace(/\r\n?/g, "\n").split("\n");
  let seen = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === "") continue;
    seen += 1;
    if (seen < bodyLines.length || line !== last) continue;
    const rest = lines.slice(index + 1);
    while (rest.length > 0 && rest[0].trim() === "") rest.shift();
    while (rest.length > 0 && rest[rest.length - 1].trim() === "") rest.pop();
    return rest.length > 0 ? rest.join("\n") : null;
  }
  return null;
}

/** «Mostrar el texto citado» / «Ver el correo completo»: read only when a person unfolds it. */
export async function getEmailQuotedText(actor: Actor, input: unknown): Promise<EmailQuotedText> {
  const data = parseInput(emailQuotedTextSchema, input);
  const id = idSchema.safeParse(data.messageId);
  if (!id.success) throw new AuthError("forbidden");
  const [row] = await db.select({ conversationId: messages.conversationId, text: messages.text, metadata: messages.metadata }).from(messages).where(eq(messages.id, id.data));
  if (!row) throw new AuthError("forbidden");
  await loadConversationFor(actor, PERMISSIONS.inbox.view, row.conversationId);
  const metadata = readEmailMetadata(row.metadata);
  const original = metadata?.originalText;
  if (!metadata || !original || (!metadata.quotedRemoved && !metadata.truncated)) throw new NotFoundError("Este correo no tiene más texto.");
  if (metadata.truncated) return { kind: "full", text: original };
  const quoted = quotedPartOf(original, row.text ?? "");
  return quoted ? { kind: "quoted", text: quoted } : { kind: "full", text: original };
}

// ─── Drafts and replies ─────────────────────────────────────────────────────────────────────────────────

/**
 * «Descartar» an AI draft of an email conversation ([COR-14]): the inbox's discardDraft (permission, the draft, its
 * AI run kept for the costs) and then its twin in the mailbox, at once instead of at the next poll.
 */
export async function discardEmailDraft(actor: Actor, input: unknown, deps: EmailDeps = {}): Promise<void> {
  const data = parseInput(discardDraftSchema, input);
  const [row] = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, data.messageId));
  await discardDraft(actor, data);
  if (row?.channelId) await discardMailboxDraftOf(row.channelId, data.messageId, deps);
}

export const emailReplySchema = z
  .object({
    conversationId: idSchema,
    /** Optional only with a file. */
    text: z.string().trim().max(MAX_HUMAN_TEXT, `Como mucho ${MAX_HUMAN_TEXT} caracteres.`).default(""),
  })
  .strict();

export type EmailReplyFile = { bytes: Uint8Array; fileName: string };

/**
 * A person answers the email from the inbox ([BAN-11], [COR-21]): the text (and a file, if any) with the business
 * signature under «-- », sent in the same thread by the email adapter as a person's email (never Auto-Submitted,
 * [COR-18]); like any reply from the inbox, the AI pauses in the conversation. The file is checked by content and size
 * ([SEG-13]). A disabled mailbox sends nothing ([CAN-16]).
 */
export async function sendEmailReply(actor: Actor, input: unknown, file?: EmailReplyFile): Promise<SendHumanResult> {
  const data = parseInput(emailReplySchema, input);
  if (!data.text && !file) throw new ValidationError(undefined, { text: ["Escribe un mensaje."] });
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.reply, data.conversationId);
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId));
  if (!channel || !isEmailChannelType(channel.type)) throw new ConflictError("Esta conversación no es de correo.");
  if (channel.status === "disabled") throw new ConflictError("El canal está desactivado: no se pueden enviar mensajes.");
  const attachment = file ? checkedFile(file) : null;

  const { name: businessName } = await loadBusinessSettings();
  const signature = channelSignature(readEmailConfig(channel.config).signature, businessName);
  const signed = signature ? [data.text, `${SIGNATURE_SEPARATOR}${signature}`].filter(Boolean).join("\n\n") : data.text;
  const now = new Date();
  const media = attachment ? await storeInboundMedia({ bytes: attachment.bytes, mimeType: attachment.mimeType, fileName: attachment.fileName }, { now }) : null;
  const sent = await sendOutbound({
    conversationId: conversation.id,
    sender: { type: "human", userId: actor.userId, name: actor.name },
    text: signed || null,
    contentType: attachment?.kind ?? "text",
    media,
    now,
  });
  const aiPausedUntil = await afterHumanReply(actor, conversation, sent.messageId, now);
  return { messageId: sent.messageId, status: sent.status, error: sent.error, aiPausedUntil };
}

/** An image (PNG, JPG or WebP) or a PDF up to the inbox's limit, told by its bytes (the name is never trusted). */
function checkedFile(file: EmailReplyFile) {
  if (file.bytes.byteLength === 0) throw new ValidationError(undefined, { file: ["Elige un archivo."] });
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new ValidationError(undefined, { file: ["El archivo es demasiado grande. Como mucho, 3,5 MB."] });
  const detected = detectAttachment(file.bytes);
  if (!detected) throw new ValidationError(undefined, { file: ["Solo se pueden adjuntar imágenes (JPG, PNG o WebP) y documentos PDF."] });
  return { ...detected, bytes: file.bytes, fileName: file.fileName };
}
