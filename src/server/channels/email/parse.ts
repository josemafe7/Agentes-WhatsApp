// One parser for the three connectors (docs/integracion-correo.md §5, [COR-19]): mailparser reads the MIME message
// (charsets with iconv-lite, HTML turned into text with html-to-text, attachments apart), and this file keeps what
// the app needs: threading headers, addresses, the raw header values for the filters, the text and the attachments
// (signature logos dropped). The email is DATA for the model, never instructions ([HER-09]).
import "server-only";
import { simpleParser, type AddressObject, type Attachment, type EmailAddress } from "mailparser";
import { MAX_ATTACHMENTS, MIN_INLINE_IMAGE_BYTES } from "./constants";

/** HTML bigger than this is not converted whole (mailparser's own guard against huge bodies). */
const MAX_HTML_TO_PARSE = 2_000_000;
const MAX_HEADER_VALUES = 20;
const MAX_HEADER_VALUE = 2_000;
const MAX_REFERENCES = 50;

export type MailAddress = { address: string; name: string | null };

export type ParsedAttachment = {
  fileName: string | null;
  contentType: string;
  size: number;
  content: Buffer;
  inline: boolean;
};

export type ParsedEmail = {
  /** «<id@host>», or null when the message has none. */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: MailAddress | null;
  replyTo: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  date: Date | null;
  /** Raw values by lower-case header name, unfolded (for the filters). */
  headers: Record<string, string[]>;
  /** Plain text of the body (the HTML converted when there is no text part). */
  text: string;
  attachments: ParsedAttachment[];
  /** Attachments beyond MAX_ATTACHMENTS: stored nowhere, only named. */
  droppedAttachments: string[];
};

function addresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const flat = (items: EmailAddress[]): EmailAddress[] => items.flatMap((item) => (item.group ? flat(item.group) : [item]));
  return list
    .flatMap((item) => flat(item.value))
    .filter((item): item is EmailAddress & { address: string } => typeof item.address === "string" && item.address.includes("@"))
    .map((item) => ({ address: item.address.trim().toLowerCase(), name: item.name?.trim() || null }));
}

/** «<a@b>» with brackets, trimmed; null for anything that is not a single id. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text || text.length > 400 || /\s/.test(text)) return null;
  const bare = text.replace(/^<+/, "").replace(/>+$/, "");
  return bare && bare.includes("@") ? `<${bare}>` : null;
}

/** Every «<…>» id of a References or In-Reply-To value. */
export function splitMessageIds(value: string | readonly string[] | null | undefined): string[] {
  const text = Array.isArray(value) ? value.join(" ") : (value ?? "");
  const ids: string[] = [];
  for (const token of String(text).split(/[\s,]+/)) {
    const id = normalizeMessageId(token);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_REFERENCES) break;
  }
  return ids;
}

/** Raw header values by name from mailparser's headerLines (the parsed map changes shapes by header). */
function rawHeaders(lines: ReadonlyArray<{ key: string; line: string }>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const { key, line } of lines) {
    const name = key.toLowerCase();
    const colon = line.indexOf(":");
    const value = (colon >= 0 ? line.slice(colon + 1) : "").replace(/\r?\n[ \t]+/g, " ").trim().slice(0, MAX_HEADER_VALUE);
    const values = (result[name] ??= []);
    if (values.length < MAX_HEADER_VALUES) values.push(value);
  }
  return result;
}

/** Inline images of a signature (logos, social icons) are dropped by size ([COR-19]). */
function isSignatureImage(attachment: Attachment): boolean {
  const inline = attachment.related || attachment.contentDisposition === "inline" || Boolean(attachment.cid);
  return inline && attachment.contentType.startsWith("image/") && attachment.size < MIN_INLINE_IMAGE_BYTES;
}

export async function parseRawEmail(raw: Buffer | Uint8Array | string): Promise<ParsedEmail> {
  const source = typeof raw === "string" ? raw : Buffer.from(raw);
  const mail = await simpleParser(source, {
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true,
    maxHtmlLengthToParse: MAX_HTML_TO_PARSE,
  });
  const kept = mail.attachments.filter((attachment) => !isSignatureImage(attachment));
  const references = splitMessageIds(mail.references ?? null);
  return {
    messageId: normalizeMessageId(mail.messageId),
    inReplyTo: splitMessageIds(mail.inReplyTo ?? null)[0] ?? null,
    references,
    subject: (mail.subject ?? "").replace(/[\r\n]+/g, " ").trim(),
    from: addresses(mail.from)[0] ?? null,
    replyTo: addresses(mail.replyTo),
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    date: mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : null,
    headers: rawHeaders(mail.headerLines),
    text: (mail.text ?? "").trim(),
    attachments: kept.slice(0, MAX_ATTACHMENTS).map((attachment) => ({
      fileName: attachment.filename ?? null,
      contentType: attachment.contentType,
      size: attachment.size,
      content: attachment.content,
      inline: attachment.related === true || attachment.contentDisposition === "inline",
    })),
    droppedAttachments: kept.slice(MAX_ATTACHMENTS).map((attachment) => attachment.filename ?? attachment.contentType),
  };
}
