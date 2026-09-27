// The mailboxes' side of the email specs (docs/integracion-correo.md): the business's own Google and Entra clients,
// mailbox and customer addresses of each test's own, raw emails built like a customer's mail program builds them, and
// the scriptable mailboxes of the simulated Gmail and Microsoft Graph (e2e/mocks/routes/google.mjs and microsoft.mjs):
// an email arrives, a person replies from their own mail program, access is revoked, and what the app did there
// (drafts, sends with their headers and thread, labels, the tokens it was given).
//
// Every test uses addresses and clients of its own, so mailboxes never need resetting and tests never share contacts or
// threads ([CAN-12], [CAN-13]).
import { createHash } from "node:crypto";
import type { TestInfo } from "@playwright/test";
import { MOCK_URL } from "./env";
import { uniqueRef } from "./names";

// ─── Test data ───────────────────────────────────────────────────────────────────────────────────────────

export type MailAddress = { name?: string; address: string };

/** The business's own OAuth client in Google Cloud ([COR-02], [COR-24]). */
export type GoogleClient = { clientId: string; clientSecret: string };

/** The business's own app in Microsoft Entra ([COR-07], [COR-24]). */
export type EntraApp = { clientId: string; clientSecret: string; tenant: string; secretExpiresOn: string };

function hexFor(testInfo: TestInfo, label: string): string {
  return createHash("sha256").update(`${uniqueRef(testInfo, label)}:${testInfo.testId}:${label}`).digest("hex");
}

export function googleClientFor(testInfo: TestInfo): GoogleClient {
  const hex = hexFor(testInfo, "google-client");
  const digits = BigInt(`0x${hex.slice(0, 12)}`).toString().padStart(12, "0").slice(-12);
  return { clientId: `${digits}-e2e${hex.slice(12, 24)}.apps.googleusercontent.com`, clientSecret: `GOCSPX-e2e${hex.slice(24, 50)}` };
}

export function entraAppFor(testInfo: TestInfo, options: { tenant?: string } = {}): EntraApp {
  const hex = hexFor(testInfo, "entra-app");
  const clientId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  // Twelve months ahead: within Microsoft's 24-month maximum and far from the 30-day warning ([COR-07], [COR-22]).
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return { clientId, clientSecret: `e2e8Q~${hex.slice(32, 64)}`, tenant: options.tenant ?? "common", secretExpiresOn: expires.toISOString().slice(0, 10) };
}

/** The business's mailbox for this test: «buzon-3fa2c1@peluqueria-e2e.test». */
export function mailboxAddressFor(testInfo: TestInfo, label = "buzón"): string {
  return `buzon-${uniqueRef(testInfo, `mailbox:${label}`)}@peluqueria-e2e.test`;
}

/** A customer of this test: «Ana Cliente <ana-3fa2c1@cliente-e2e.test>». */
export function customerFor(testInfo: TestInfo, name: string): Required<MailAddress> {
  const local = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { name, address: `${local}-${uniqueRef(testInfo, `customer:${name}`)}@cliente-e2e.test` };
}

/** A Message-ID of this test: «<e2e-label-3fa2c1@cliente-e2e.test>». */
export function messageIdFor(testInfo: TestInfo, label: string, domain = "cliente-e2e.test"): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `<e2e-${slug}-${uniqueRef(testInfo, `message-id:${label}`)}@${domain}>`;
}

// ─── Raw emails ──────────────────────────────────────────────────────────────────────────────────────────

export type TestEmail = {
  from: MailAddress;
  to: MailAddress;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: readonly string[];
  /** Extra headers as they go on the wire (List-Unsubscribe, Auto-Submitted…). */
  headers?: Record<string, string>;
  date?: Date;
};

const CRLF = "\r\n";
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** RFC 2047 words of at most 45 bytes each, so no line of the header gets too long. */
function encodeWords(value: string): string {
  if (PRINTABLE_ASCII.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`).join(`${CRLF} `);
}

function formatAddress(address: MailAddress): string {
  if (!address.name) return `<${address.address}>`;
  const name = PRINTABLE_ASCII.test(address.name) ? `"${address.name.replace(/["\\]/g, "")}"` : encodeWords(address.name);
  return `${name} <${address.address}>`;
}

/** RFC 5322 date: «Sun, 27 Sep 2026 07:00:00 +0000». */
function mailDate(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

/** A text/plain UTF-8 email (base64 body), as a mail program sends it. */
export function buildRawEmail(email: TestEmail): Buffer {
  const headers: [string, string][] = [
    ["From", formatAddress(email.from)],
    ["To", formatAddress(email.to)],
    ["Subject", encodeWords(email.subject)],
    ["Date", mailDate(email.date ?? new Date())],
    ["Message-ID", email.messageId],
  ];
  if (email.inReplyTo) headers.push(["In-Reply-To", email.inReplyTo]);
  if (email.references && email.references.length > 0) headers.push(["References", email.references.join(" ")]);
  for (const [name, value] of Object.entries(email.headers ?? {})) headers.push([name, value]);
  headers.push(["MIME-Version", "1.0"], ["Content-Type", 'text/plain; charset="utf-8"'], ["Content-Transfer-Encoding", "base64"]);
  const body = Buffer.from(email.text.replace(/\r?\n/g, CRLF), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, `$&${CRLF}`);
  return Buffer.from(`${headers.map(([name, value]) => `${name}: ${value}`).join(CRLF)}${CRLF}${CRLF}${body}`, "utf8");
}

// ─── What the simulated mailboxes hold ───────────────────────────────────────────────────────────────────

/** Header values by lower-case name, as they came. */
export type MailHeaders = Record<string, string[]>;

export type DescribedMail = {
  headers: MailHeaders;
  subject: string;
  from: { name: string | null; address: string } | null;
  to: { name: string | null; address: string }[];
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** The text/plain part, decoded. */
  text: string;
  attachments: { filename: string | null; contentType: string; size: number }[];
};

export type GmailMessage = DescribedMail & {
  id: string;
  threadId: string;
  labelIds: string[];
  labelNames: string[];
  internalDate: number;
  /** Times the app downloaded it whole (format=raw). */
  rawReads: number;
};

export type GmailDraft = Partial<Omit<GmailMessage, "id">> & {
  /** The draft's id (drafts.send / drafts.delete). */
  id: string;
  /** Gmail's id of the draft's message. */
  gmailMessageId: string;
  threadId?: string;
  requestedThreadId: string | null;
  threaded: boolean;
  threadingProblems: string[];
  createdAt: string;
};

export type GmailSend = DescribedMail & {
  id: string;
  threadId: string;
  requestedThreadId: string | null;
  /** Gmail's three conditions held: threadId, In-Reply-To/References of that thread and the same subject ([F18]). */
  threaded: boolean;
  threadingProblems: string[];
  via: "messages.send" | "drafts.send";
  draftId: string | null;
  at: string;
};

export type GmailMailbox = {
  address: string;
  historyId: string;
  labels: { id: string; name: string; type: string }[];
  messages: GmailMessage[];
  drafts: GmailDraft[];
  sends: GmailSend[];
  modified: { id: string; addLabelIds: string[]; removeLabelIds: string[]; addLabelNames: string[]; at: string }[];
  grants: { clientId: string; scopes: string[]; revoked: boolean; refreshToken: string | null; accessTokens: string[] }[];
};

export type GraphAddress = { name: string | null; address: string };

export type OutlookMessage = {
  id: string;
  folder: "inbox" | "sentitems" | "drafts";
  isDraft: boolean;
  conversationId: string;
  internetMessageId: string;
  subject: string;
  from: GraphAddress | null;
  to: GraphAddress[];
  inReplyTo: string | null;
  references: string[];
  headers: { name: string; value: string }[];
  text: string;
  replyOf: string | null;
  /** Times the app downloaded its MIME ($value). */
  mimeReads: number;
};

export type OutlookSend = {
  id: string;
  conversationId: string;
  replyOf: string | null;
  to: GraphAddress[];
  subject: string;
  text: string;
  /** internetMessageHeaders set at createReply (only x- names). */
  headers: { name: string; value: string }[];
  inReplyTo: string | null;
  references: string[];
  attachments: { name: string; contentType: string; size: number }[];
  at: string;
};

export type OutlookMailbox = {
  address: string;
  userId: string;
  messages: OutlookMessage[];
  sends: OutlookSend[];
  grants: { clientId: string; tenant: string; scopes: string[]; revoked: boolean; refreshTokens: string[]; accessTokens: string[] }[];
};

async function control<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${MOCK_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer: unknown = await response.json();
  if (!response.ok) throw new Error(`Mock ${path} → ${response.status}: ${JSON.stringify(answer)}`);
  return answer as T;
}

const mailboxPath = (service: "google" | "ms-graph", address: string, action = "") =>
  `/${service}/__mailboxes/${encodeURIComponent(address)}${action ? `/${action}` : ""}`;

function gmailMailbox(address: string): Promise<GmailMailbox> {
  return control(mailboxPath("google", address));
}

function outlookMailbox(address: string): Promise<OutlookMailbox> {
  return control(mailboxPath("ms-graph", address));
}

/** The simulated Gmail of one address. */
export const gmail = {
  /** An email arrives (labels INBOX, UNREAD by default), or with labelIds ["SENT"] a person replies from Gmail. */
  async deliver(address: string, raw: Buffer, options: { labelIds?: string[]; threadId?: string } = {}): Promise<{ id: string; threadId: string; labelIds: string[]; historyId: string }> {
    return control(mailboxPath("google", address, "messages"), { raw: raw.toString("base64"), ...options });
  },
  mailbox: gmailMailbox,
  /** The app downloaded these emails whole (format=raw): the read that takes them in has happened. */
  async downloaded(address: string, ...ids: string[]): Promise<boolean> {
    const { messages } = await gmailMailbox(address);
    return ids.every((id) => (messages.find((message) => message.id === id)?.rawReads ?? 0) > 0);
  },
  /** The person removes the app's access in their Google Account ([COR-22]). */
  async revokeAccess(address: string): Promise<void> {
    await control(mailboxPath("google", address, "revoke"), {});
  },
};

/** The simulated Microsoft Graph of one address. */
export const outlook = {
  /** An email arrives in the inbox, or with folder "sentitems" a person replies from Outlook. */
  async deliver(address: string, raw: Buffer, options: { folder?: "inbox" | "sentitems"; conversationId?: string; uniqueBody?: string } = {}): Promise<{ id: string; conversationId: string; internetMessageId: string }> {
    return control(mailboxPath("ms-graph", address, "messages"), { raw: raw.toString("base64"), ...options });
  },
  mailbox: outlookMailbox,
  /** The app downloaded these emails' MIME: the read that takes them in has happened. */
  async downloaded(address: string, ...ids: string[]): Promise<boolean> {
    const { messages } = await outlookMailbox(address);
    return ids.every((id) => (messages.find((message) => message.id === id)?.mimeReads ?? 0) > 0);
  },
  /** The person's sessions are revoked in Entra ([COR-22]). */
  async revokeAccess(address: string): Promise<void> {
    await control(mailboxPath("ms-graph", address, "revoke"), {});
  },
};

/** First value of a header of a mail the mock read (names in lower case). */
export function headerOf(mail: { headers?: MailHeaders }, name: string): string | null {
  return mail.headers?.[name.toLowerCase()]?.[0] ?? null;
}

/** Every token the simulated provider issued for a mailbox: none of them may ever reach a page ([SEG-01], [CAN-17]). */
export function issuedTokens(mailbox: GmailMailbox | OutlookMailbox): string[] {
  return mailbox.grants.flatMap((grant) => [...("refreshToken" in grant && grant.refreshToken ? [grant.refreshToken] : []), ...("refreshTokens" in grant ? grant.refreshTokens : []), ...grant.accessTokens]);
}
