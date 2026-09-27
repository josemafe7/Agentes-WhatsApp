// What our replies carry (docs/integracion-correo.md §4.2, [COR-06], [COR-18]): In-Reply-To and References always,
// the same subject with «Re: » (never «Auto:», Gmail needs the subject to keep the thread), our own X- header on
// everything, and Auto-Submitted: auto-replied ONLY when the AI sends on its own: never on a draft a person approves
// or edits, nor on a person's reply (RFC 3834 §5.2). Pure.
import "server-only";
import { DOMINIA_HEADER, DOMINIA_HEADER_VALUE } from "./constants";

/** References kept: RFC 5322 lets a long list be trimmed keeping the first (the thread's root) and the last ones. */
const MAX_REFERENCES = 20;
const MAX_SUBJECT = 250;

/** automatic = the AI sends without a person ([CAN-07] «Automático»); approved = a person approved or wrote it. */
export type SendMode = "automatic" | "approved";

/** How a message of ours leaves: automatic only for the AI's own text that nobody approved. */
export function sendModeOf(message: { senderType: string; metadata: Record<string, unknown> }): SendMode {
  return message.senderType === "ai" && typeof message.metadata.approvedByUserId !== "string" ? "automatic" : "approved";
}

export function outgoingHeaders(mode: SendMode): Record<string, string> {
  return {
    [DOMINIA_HEADER]: DOMINIA_HEADER_VALUE,
    // Asks Exchange mailboxes not to answer with «out of office» (not «All»: bounces tell us about failures, [F87]).
    "X-Auto-Response-Suppress": "OOF, AutoReply",
    ...(mode === "automatic" ? { "Auto-Submitted": "auto-replied" } : {}),
  };
}

/** «Re: <subject>» unless it already starts with «Re:» (any case); one line, bounded. */
export function replySubject(subject: string | null | undefined): string {
  const clean = (subject ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!clean) return "Re: (sin asunto)";
  const reply = /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
  return reply.slice(0, MAX_SUBJECT);
}

export type ThreadingHeaders = { inReplyTo: string | null; references: string[] };

/** In-Reply-To = the original's Message-ID; References = its References followed by that id (RFC 5322 §3.6.4). */
export function replyThreading(original: { messageId: string | null; references: readonly string[]; inReplyTo?: string | null }): ThreadingHeaders {
  const chain = [...(original.references.length > 0 ? original.references : original.inReplyTo ? [original.inReplyTo] : [])];
  if (original.messageId && !chain.includes(original.messageId)) chain.push(original.messageId);
  const references = chain.length > MAX_REFERENCES ? [chain[0], ...chain.slice(chain.length - (MAX_REFERENCES - 1))] : chain;
  return { inReplyTo: original.messageId, references };
}

/**
 * Our Message-ID for one of our messages: the same for its mailbox draft and for what finally leaves, so the sent
 * copy is recognized (Gmail history, IMAP \Sent) and never taken for a person's reply.
 */
export function messageIdFor(ourMessageId: string, mailbox: string | null): string {
  const domain = mailbox?.split("@")[1]?.trim().toLowerCase();
  return `<${ourMessageId}@${domain && /^[a-z0-9.-]{1,200}$/.test(domain) ? domain : "dominia.local"}>`;
}

/** The id of our message inside one of our Message-IDs, or null when it is not one of ours. */
export function ourMessageIdOf(rfcMessageId: string | null | undefined): string | null {
  const match = /^<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@[^>]+>$/i.exec(rfcMessageId?.trim() ?? "");
  return match ? match[1].toLowerCase() : null;
}
