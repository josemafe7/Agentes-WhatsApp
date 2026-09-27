// One parser for the three connectors (docs/integracion-correo.md §5, [COR-19]): mailparser reads the MIME message
// (charsets with iconv-lite, HTML turned into text with html-to-text, attachments apart), and this file keeps what
// the app needs: threading headers, addresses, the raw header values for the filters, the text and the attachments
// (signature logos dropped). The email is DATA for the model, never instructions ([HER-09]). Nothing in it may stop the
// mailbox: its text comes out storable (src/server/storable-text.ts), and an address or a date that cannot be real is
// left out (the database could not keep some of them).
import "server-only";
import { simpleParser, type AddressObject, type Attachment, type EmailAddress } from "mailparser";
import { storableJson } from "@/server/storable-text";
import { MAX_ATTACHMENTS, MIN_INLINE_IMAGE_BYTES } from "./constants";

/** HTML bigger than this is not converted whole (mailparser's own guard against huge bodies). */
const MAX_HTML_TO_PARSE = 2_000_000;
const MAX_HEADER_VALUES = 20;
const MAX_HEADER_VALUE = 2_000;
const MAX_REFERENCES = 50;
/** No email address is longer (RFC 5321); a longer one is no address (nor fits the index that finds a contact by it). */
const MAX_ADDRESS = 254;
/** A Date header before 1970 or after 9999 is no real date (and Postgres cannot store some of them). */
const EARLIEST_DATE = Date.UTC(1970, 0, 1);
const LATEST_DATE = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

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
  /** From addresses (and From headers) the email carries: more than one is never a verified sender ([COR-25]). */
  fromCount: number;
  replyTo: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  /** Null when the message has none or it cannot be a real date. */
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
    .filter((item): item is EmailAddress & { address: string } => typeof item.address === "string" && item.address.includes("@") && item.address.trim().length <= MAX_ADDRESS)
    .map((item) => ({ address: item.address.trim().toLowerCase(), name: item.name?.trim() || null }));
}

function realDate(date: Date | undefined): Date | null {
  const time = date?.getTime() ?? Number.NaN;
  return date && !Number.isNaN(time) && time >= EARLIEST_DATE && time <= LATEST_DATE ? date : null;
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

/** The start of a raw message up to its blank line: its headers only, for one too big to read whole ([COR-19]). */
export function headerPart(raw: Buffer): Buffer {
  const end = raw.indexOf("\r\n\r\n");
  return end >= 0 ? raw.subarray(0, end + 4) : raw;
}

/**
 * A header-only message from the name/value pairs an API gives (Gmail's metadata, Graph's internetMessageHeaders),
 * in their order, so it parses like any other ([COR-19]). A name that is not a header name is left out.
 */
export function headerBlock(pairs: readonly { name: string; value: string }[]): Buffer {
  const lines = pairs.filter((pair) => /^[!-9;-~]{1,100}$/.test(pair.name)).map((pair) => `${pair.name}: ${pair.value.replace(/[\r\n]+/g, " ")}`);
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n`);
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
  const fromAddresses = addresses(mail.from);
  const headers = rawHeaders(mail.headerLines);
  return storableJson<ParsedEmail>({
    messageId: normalizeMessageId(mail.messageId),
    inReplyTo: splitMessageIds(mail.inReplyTo ?? null)[0] ?? null,
    references,
    subject: (mail.subject ?? "").replace(/[\r\n]+/g, " ").trim(),
    from: fromAddresses[0] ?? null,
    fromCount: Math.max(fromAddresses.length, headers.from?.length ?? 0),
    replyTo: addresses(mail.replyTo),
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    date: realDate(mail.date),
    headers,
    text: (mail.text ?? "").trim(),
    attachments: kept.slice(0, MAX_ATTACHMENTS).map((attachment) => ({
      fileName: attachment.filename ?? null,
      contentType: attachment.contentType,
      size: attachment.size,
      content: attachment.content,
      inline: attachment.related === true || attachment.contentDisposition === "inline",
    })),
    droppedAttachments: kept.slice(MAX_ATTACHMENTS).map((attachment) => attachment.filename ?? attachment.contentType),
  });
}
