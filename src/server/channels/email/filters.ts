// Which emails the app never answers ([COR-16], [COR-18], [COR-20], docs/integracion-correo.md §4.1): automatic
// replies (RFC 3834), bulk and list mail, newsletters with an unsubscribe link, noreply and mailer-daemon senders,
// bounces, the mailbox's own mail, spam and Gmail's promotions. Our own header marks what we sent: it is never
// answered, and mail from the mailbox itself without it is a person replying from their email program. Pure.
import "server-only";
import { DOMINIA_HEADER, SYSTEM_MAIL_HEADER } from "./constants";

const SYSTEM_HEADER = SYSTEM_MAIL_HEADER.toLowerCase();

export const IGNORE_REASONS = [
  "auto_reply",
  "bulk",
  "mailing_list",
  "no_reply_sender",
  "bounce",
  "own_address",
  "loop",
  "spam",
  "promotions",
  "no_sender",
] as const;
export type IgnoreReason = (typeof IGNORE_REASONS)[number];

/** Spanish label of each reason, for Diagnóstico. */
export const IGNORE_REASON_LABELS: Record<IgnoreReason, string> = {
  auto_reply: "Respuestas automáticas",
  bulk: "Envíos masivos",
  mailing_list: "Listas y boletines con enlace de baja",
  no_reply_sender: "Remitentes «noreply»",
  bounce: "Rebotes y avisos del servidor de correo",
  own_address: "Enviados por el propio buzón",
  loop: "Correos enviados por la app",
  spam: "Spam o correo no deseado",
  promotions: "Promociones (Gmail)",
  no_sender: "Sin remitente",
};

export type EmailClassification =
  /** A customer's email: it opens or continues a conversation. */
  | { kind: "inbound" }
  /** Not answered, counted in Diagnóstico with its reason. */
  | { kind: "ignore"; reason: IgnoreReason }
  /** Sent by the app itself (our header): never answered ([COR-18]). */
  | { kind: "own" }
  /** Sent from the mailbox by a person, not by the app: the AI pauses in that thread ([COR-20]). */
  | { kind: "human" }
  /** A draft in the mailbox: nothing to do. */
  | { kind: "skip" };

export type EmailEnvelope = {
  /** Lower-case sender address, if any. */
  from: string | null;
  /** Header values by lower-case name, as they came (unfolded). */
  headers: Readonly<Record<string, readonly string[]>>;
  /** Addresses of the mailbox itself (lower case). */
  ownAddresses: readonly string[];
  /** Where the provider says it is: Gmail labels, or «inbox» / «sent» for folders. */
  labels?: readonly string[];
  /** It comes from the mailbox's sent folder (Outlook sentitems, IMAP \Sent, Gmail SENT). */
  sentFolder?: boolean;
};

const header = (envelope: EmailEnvelope, name: string): readonly string[] => envelope.headers[name] ?? [];
const first = (envelope: EmailEnvelope, name: string): string | null => header(envelope, name)[0]?.trim().toLowerCase() ?? null;

/** Local parts that never read replies (RFC 3834 §3.2 plus the usual no-reply names). */
function noReplyKind(address: string): "bounce" | "no_reply_sender" | null {
  const local = address.split("@")[0] ?? "";
  if (local === "mailer-daemon" || local === "postmaster") return "bounce";
  const compact = local.replace(/[._-]/g, "");
  if (compact === "noreply" || compact === "donotreply" || compact.startsWith("noreply") || compact.startsWith("donotreply")) return "no_reply_sender";
  if (local.startsWith("owner-") || local.endsWith("-request")) return "no_reply_sender";
  return null;
}

/** «<>», empty or only spaces: the null reverse-path of bounces (RFC 3834 §3.2: MUST NOT reply). */
function isNullReturnPath(values: readonly string[]): boolean {
  return values.some((value) => value.replace(/[<>\s]/g, "") === "");
}

function isAutoSubmitted(envelope: EmailEnvelope): boolean {
  const value = first(envelope, "auto-submitted");
  if (value !== null && value.split(";")[0].trim() !== "no") return true;
  // Microsoft's own «do not auto-reply to this» ([F87]); our interpretation, as the integration doc says.
  const suppress = first(envelope, "x-auto-response-suppress");
  return suppress !== null && suppress.split(",").some((item) => ["all", "autoreply", "oof"].includes(item.trim()));
}

function isBulk(envelope: EmailEnvelope): boolean {
  const precedence = first(envelope, "precedence");
  return precedence !== null && ["bulk", "list", "junk"].includes(precedence);
}

/** List-Id, List-Unsubscribe, List-Unsubscribe-Post or any other List-* header (RFC 2369, 2919, 8058). */
function isListMail(envelope: EmailEnvelope): boolean {
  return Object.keys(envelope.headers).some((name) => name.startsWith("list-") && header(envelope, name).length > 0);
}

export function classifyEmail(envelope: EmailEnvelope): EmailClassification {
  const labels = new Set(envelope.labels ?? []);
  if (labels.has("DRAFT")) return { kind: "skip" };
  if (labels.has("SPAM") || labels.has("TRASH")) return { kind: "ignore", reason: "spam" };

  const from = envelope.from?.trim().toLowerCase() || null;
  const own = from !== null && envelope.ownAddresses.includes(from);
  const ours = header(envelope, DOMINIA_HEADER.toLowerCase()).length > 0 || header(envelope, SYSTEM_HEADER).length > 0;
  const sent = envelope.sentFolder === true || labels.has("SENT");

  if (ours) return own ? { kind: "own" } : { kind: "ignore", reason: "loop" };
  if (own) return sent ? { kind: "human" } : { kind: "ignore", reason: "own_address" };
  // Anything else in the sent folder was not written by the mailbox (e.g. a send-as alias): nothing to do.
  if (sent) return { kind: "skip" };
  if (!from) return { kind: "ignore", reason: "no_sender" };

  if (isAutoSubmitted(envelope)) return { kind: "ignore", reason: "auto_reply" };
  if (isBulk(envelope)) return { kind: "ignore", reason: "bulk" };
  if (isListMail(envelope)) return { kind: "ignore", reason: "mailing_list" };
  if (isNullReturnPath(header(envelope, "return-path"))) return { kind: "ignore", reason: "bounce" };
  const sender = noReplyKind(from);
  if (sender) return { kind: "ignore", reason: sender };
  // Only Gmail has a promotions category; Outlook's «Other» measures relevance and is never a filter ([COR-16]).
  if (labels.has("CATEGORY_PROMOTIONS")) return { kind: "ignore", reason: "promotions" };
  return { kind: "inbound" };
}
