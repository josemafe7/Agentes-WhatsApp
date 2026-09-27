// What an email message keeps in `messages.metadata` (docs/modelo-de-datos.md «messages.metadata»): `subject` at the
// top level (as the demo and the simulator already do) and `email` with the threading headers, addresses and the
// provider's id, so a reply can be threaded ([COR-06]) and the inbox can show the thread ([BAN-09]). Attachments
// arrive as messages of their own that point to their email through `email.attachmentOf`.
import "server-only";
import { z } from "zod";

const addressSchema = z.object({ address: z.string().max(320), name: z.string().max(300).nullable() });

export const emailMetadataSchema = z.object({
  /** Gmail message id, Graph immutable id, or the IMAP key (Message-ID, else uid). */
  providerId: z.string().max(1_024),
  /** RFC 5322 Message-ID with brackets. */
  messageId: z.string().max(400).nullable(),
  inReplyTo: z.string().max(400).nullable().default(null),
  references: z.array(z.string().max(400)).max(50).default([]),
  from: addressSchema.nullable().default(null),
  replyTo: z.array(addressSchema).max(20).default([]),
  to: z.array(addressSchema).max(100).default([]),
  cc: z.array(addressSchema).max(100).default([]),
  /** Quoted history or signature taken out of `text` ([COR-19]). */
  quotedRemoved: z.boolean().default(false),
  /** The whole text as it came, when `text` was cleaned or cut ([COR-19]). */
  originalText: z.string().nullish(),
  /** The text was longer than the app keeps. */
  truncated: z.boolean().optional(),
  /** Attachments not stored (too many, or the email too big), by name. */
  droppedAttachments: z.array(z.string().max(300)).max(100).optional(),
  /** This message is an attachment of the email with this providerId. */
  attachmentOf: z.string().max(1_024).nullish(),
  /** IMAP position, to mark it «IA-Respondido» ([COR-06] for IMAP, docs §3.2). */
  imap: z.object({ folder: z.string().max(500), uid: z.number().int().nonnegative(), uidValidity: z.string().max(40) }).nullish(),
  /** A person wrote it from the mailbox (Gmail, Outlook or their own email program) ([COR-20]). */
  fromMailbox: z.boolean().optional(),
});
export type EmailMetadata = z.infer<typeof emailMetadataSchema>;
export type EmailMetadataInput = z.input<typeof emailMetadataSchema>;

/** The `email` block of a message's metadata, or null when it has none (or it is malformed). */
export function readEmailMetadata(metadata: Record<string, unknown> | null | undefined): EmailMetadata | null {
  const parsed = emailMetadataSchema.safeParse(metadata?.email);
  return parsed.success ? parsed.data : null;
}

/** The subject of a message's metadata. */
export function subjectOf(metadata: Record<string, unknown> | null | undefined): string | null {
  const subject = metadata?.subject;
  return typeof subject === "string" && subject.trim() ? subject.trim() : null;
}
