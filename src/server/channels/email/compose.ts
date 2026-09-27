// Builds the MIME message once with Nodemailer's MailComposer (docs/integracion-correo.md §3.3) and it serves Gmail
// (`raw`), SMTP and IMAP APPEND alike. The text comes from the AI or a person and answers third-party mail: nothing in
// it may read server files or fetch URLs (disableFileAccess / disableUrlAccess). Header values are one line.
import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";
import type { MessageMedia } from "@/db/schema";
import { readStoredMedia } from "@/server/media/store";
import { ChannelSendError } from "../types";
import type { MailAddress } from "./parse";

/** Largest file a person attaches from the inbox that we put in an email. */
export const MAX_OUTBOUND_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type ComposeInput = {
  from: MailAddress;
  to: readonly MailAddress[];
  cc?: readonly MailAddress[];
  subject: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  references: readonly string[];
  headers: Record<string, string>;
  attachments?: { fileName: string; contentType: string; content: Buffer }[];
  date?: Date;
};

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

function address(value: MailAddress): { name: string; address: string } {
  return { name: oneLine(value.name ?? ""), address: value.address };
}

export async function composeEmail(input: ComposeInput): Promise<Buffer> {
  if (input.to.length === 0) throw new ChannelSendError("El correo no tiene destinatario.", false);
  const composer = new MailComposer({
    from: address(input.from),
    to: input.to.map(address),
    ...(input.cc && input.cc.length > 0 ? { cc: input.cc.map(address) } : {}),
    subject: oneLine(input.subject),
    messageId: input.messageId,
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.references.length > 0 ? { references: [...input.references] } : {}),
    date: input.date ?? new Date(),
    text: input.text,
    headers: Object.fromEntries(Object.entries(input.headers).map(([name, value]) => [name, oneLine(value)])),
    attachments: (input.attachments ?? []).map((file) => ({ filename: oneLine(file.fileName), contentType: file.contentType, content: file.content })),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return composer.compile().build();
}

/** A file a person attached from the inbox, read from our storage. */
export async function attachmentFromMedia(media: MessageMedia | null | undefined): Promise<ComposeInput["attachments"]> {
  if (!media?.fileKey) return [];
  const file = await readStoredMedia(media.fileKey, MAX_OUTBOUND_ATTACHMENT_BYTES);
  if (!file.ok) {
    throw new ChannelSendError(file.reason === "too_large" ? "El archivo es demasiado grande para enviarlo por correo." : "No se encuentra el archivo adjunto.", false);
  }
  return [{ fileName: media.fileName ?? "adjunto", contentType: media.mimeType ?? file.contentType, content: Buffer.from(file.bytes) }];
}
