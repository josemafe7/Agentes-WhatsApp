// A message of a number linked by QR code → what the common pipeline understands ([QR-06], [QR-07], [QR-09],
// docs/integracion-whatsapp-qr.md «Recepción»). Pure: no database and no library, only the shape of what it delivers.
// One-to-one chats only: groups, statuses, broadcast lists and channels are never read. A customer's message becomes an
// inbound event; what the business wrote from its own phone, a «desde el móvil» echo; the protocol's own traffic
// (keys, history, edits, deletions) is left alone. What arrives is data, never instructions.
import "server-only";
import type { MessageMedia } from "@/db/schema";
import type { MessageContentType } from "@/lib/enums";
import type { PhoneEcho } from "../phone-echo";
import type { InboundMessageEvent, InboundSender } from "../types";
import { UNSUPPORTED_TEXT } from "../whatsapp/normalize";

// ─── JIDs: WhatsApp's addresses («34600111222@s.whatsapp.net», «1234567890@lid») ────────────────────────

const PN_SERVER = "s.whatsapp.net";
const LID_SERVER = "lid";

/** `user@server` without the device («34600111222:12@s.whatsapp.net» → «34600111222@s.whatsapp.net»), or null. */
export function normalizeJid(jid: string | null | undefined): string | null {
  const match = jid?.trim().match(/^([^@:/\s]{1,60})(?::\d{1,5})?@([a-z.]{1,30})$/i);
  return match ? `${match[1]}@${match[2].toLowerCase()}` : null;
}

const serverOf = (jid: string | null) => jid?.split("@")[1] ?? null;
const userOf = (jid: string | null) => jid?.split("@")[0] ?? null;

/** A person's phone-number address. */
export const isPnJid = (jid: string | null): jid is string => serverOf(jid) === PN_SERVER && /^\d{6,20}$/.test(userOf(jid) ?? "");
/** A person's LID: WhatsApp's own stable id of the account, which is not a phone. */
export const isLidJid = (jid: string | null): jid is string => serverOf(jid) === LID_SERVER && /^\d{5,30}$/.test(userOf(jid) ?? "");
/** One-to-one chats are the only ones read ([QR-06]): groups (@g.us), statuses and lists (@broadcast), channels (@newsletter) and the rest are not. */
export const isPersonJid = (jid: string | null | undefined): boolean => {
  const normalized = normalizeJid(jid);
  return isPnJid(normalized) || isLidJid(normalized);
};

/** The JID to write to a customer from their identities in the channel (LID first; else the phone-number id). */
export function jidOfIdentity(externalId: string): string | null {
  const jid = normalizeJid(externalId);
  if (isLidJid(jid)) return jid;
  return /^\d{6,20}$/.test(externalId.trim()) ? `${externalId.trim()}@${PN_SERVER}` : null;
}

// ─── Messages ───────────────────────────────────────────────────────────────────────────────────────────

export type QrMessageKey = { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null; id?: string | null; participant?: string | null };
/** What the library delivers of a message, as far as this file reads it. */
export type QrRawMessage = {
  key?: QrMessageKey | null;
  message?: Record<string, unknown> | null;
  /** Unix seconds: a number, or the library's 64-bit integer. */
  messageTimestamp?: number | string | { toNumber(): number } | null;
  pushName?: string | null;
};

/** A file still at WhatsApp: what is needed to download and decrypt it right after ([QR-06]). Only ever in memory. */
export type QrMediaRef = { kind: "audio" | "image" | "document"; mimeType: string | null; fileName: string | null; fileLength: number | null; directPath: string | null; mediaKey: Uint8Array | null };

export type QrNormalized =
  /** `jid`: the chat's address, to answer there. */
  | { kind: "inbound"; event: InboundMessageEvent; media: QrMediaRef | null; jid: string }
  | { kind: "echo"; echo: PhoneEcho; media: QrMediaRef | null; jid: string }
  | { kind: "ignored"; reason: "not_a_person" | "own_chat" | "old" | "empty" | "protocol" };

export type QrNormalizeContext = {
  /** The linked account's own addresses: its «message yourself» chat is never a customer. */
  self: { pn: string | null; lid: string | null };
  /** Messages sent before this (the link) are history, never new ([QR-06]). */
  linkedAt: Date | null;
  receivedAt: Date;
};

/** Stored in the message's metadata: the chat to answer in. */
export const QR_JID_METADATA_KEY = "whatsappJid";
/** A message this much older than the link is still taken: the phone's clock and WhatsApp's are not the same. */
const LINK_MARGIN_MS = 60_000;
/** WhatsApp wraps a message inside others (disappearing chats, «ver una vez», a document with its caption): how deep to look. */
const MAX_WRAPPERS = 5;
const WRAPPERS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"] as const;
/** Parts of a message that are not its content. */
const NOT_CONTENT = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);
/** The protocol's own traffic: never shown, never answered. */
const PROTOCOL = new Set(["protocolMessage", "pollUpdateMessage", "keepInChatMessage", "encReactionMessage", "pinInChatMessage", "editedMessage", "encEventResponseMessage", "secretEncryptedMessage"]);

const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function unwrap(message: Record<string, unknown> | null): Record<string, unknown> | null {
  let current = message;
  for (let depth = 0; current && depth < MAX_WRAPPERS; depth++) {
    const wrapper = WRAPPERS.map((key) => record(current?.[key])).find((value) => value !== null);
    const inner = record(wrapper?.message);
    if (!inner) break;
    current = inner;
  }
  return current;
}

function secondsOf(value: QrRawMessage["messageTimestamp"]): number | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" ? Number(value) : value && typeof value.toNumber === "function" ? value.toNumber() : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function sizeOf(value: unknown): number | null {
  const size = typeof value === "number" ? value : typeof value === "string" ? Number(value) : record(value) && typeof (value as { toNumber?: unknown }).toNumber === "function" ? (value as { toNumber(): number }).toNumber() : Number.NaN;
  return Number.isFinite(size) && size >= 0 ? size : null;
}

/** Who the chat is with: their LID first (WhatsApp's stable id) and their phone-number id as data ([QR-07], [CAN-13]). */
function chatPerson(key: QrMessageKey): { jid: string; person: InboundSender } | null {
  const jid = normalizeJid(key.remoteJid);
  const alt = normalizeJid(key.remoteJidAlt);
  const lid = [jid, alt].find(isLidJid) ?? null;
  const pn = [jid, alt].find(isPnJid) ?? null;
  if (!jid || (!lid && !pn)) return null;
  const digits = userOf(pn);
  return { jid, person: { externalIds: [lid, digits].filter((id): id is string => Boolean(id)), phone: digits } };
}

function mediaRef(kind: QrMediaRef["kind"], media: Record<string, unknown>): QrMediaRef {
  const key = media.mediaKey;
  return {
    kind,
    mimeType: clean(media.mimetype),
    fileName: kind === "document" ? (clean(media.fileName) ?? clean(media.title)) : null,
    fileLength: sizeOf(media.fileLength),
    directPath: clean(media.directPath),
    mediaKey: key instanceof Uint8Array ? key : null,
  };
}

type Content =
  | { contentType: MessageContentType; text: string | null; media: QrMediaRef | null; unsupported: boolean }
  | { reaction: { targetExternalId: string; emoji: string | null } }
  | null;

/** What a message says, or null for what is not a message to show. */
function contentOf(message: Record<string, unknown>): Content {
  const type = Object.keys(message).find((key) => !NOT_CONTENT.has(key) && message[key] !== null && message[key] !== undefined);
  if (!type || PROTOCOL.has(type)) return null;
  const body = record(message[type]);
  if (type === "conversation") {
    const text = clean(message.conversation);
    return text ? { contentType: "text", text, media: null, unsupported: false } : null;
  }
  if (type === "extendedTextMessage") {
    const text = clean(body?.text);
    return text ? { contentType: "text", text, media: null, unsupported: false } : null;
  }
  if (type === "reactionMessage") {
    const target = clean(record(body?.key)?.id);
    return target ? { reaction: { targetExternalId: target, emoji: clean(body?.text) } } : null;
  }
  if (body && type === "imageMessage") return { contentType: "image", text: clean(body.caption), media: mediaRef("image", body), unsupported: false };
  if (body && type === "audioMessage") return { contentType: "audio", text: null, media: mediaRef("audio", body), unsupported: false };
  if (body && type === "documentMessage") return { contentType: "document", text: clean(body.caption), media: mediaRef("document", body), unsupported: false };
  // Video, stickers, locations, contacts, polls, buttons…: shown as such, never answered ([QR-06]).
  return { contentType: "unsupported", text: UNSUPPORTED_TEXT, media: null, unsupported: true };
}

const pendingMedia = (media: QrMediaRef | null): MessageMedia | null =>
  media ? { ...(media.mimeType ? { mimeType: media.mimeType } : {}), ...(media.fileName ? { fileName: media.fileName } : {}), ...(media.fileLength !== null ? { size: media.fileLength } : {}), downloadStatus: "pending" } : null;

export function normalizeQrMessage(raw: QrRawMessage, context: QrNormalizeContext): QrNormalized {
  const key = raw.key;
  const id = clean(key?.id);
  if (!key || !id) return { kind: "ignored", reason: "empty" };
  // A group message names who wrote it in `participant`: never read, whatever its address looks like.
  if (key.participant || !isPersonJid(key.remoteJid)) return { kind: "ignored", reason: "not_a_person" };
  const chat = chatPerson(key);
  if (!chat) return { kind: "ignored", reason: "not_a_person" };
  const own = [context.self.pn, context.self.lid].map(normalizeJid).filter((jid): jid is string => jid !== null);
  if ([normalizeJid(key.remoteJid), normalizeJid(key.remoteJidAlt)].some((jid) => jid !== null && own.includes(jid))) return { kind: "ignored", reason: "own_chat" };

  const seconds = secondsOf(raw.messageTimestamp);
  const sentAt = seconds ? new Date(seconds * 1_000) : context.receivedAt;
  if (context.linkedAt && sentAt.getTime() < context.linkedAt.getTime() - LINK_MARGIN_MS) return { kind: "ignored", reason: "old" };

  const message = unwrap(record(raw.message));
  if (!message) return { kind: "ignored", reason: "empty" };
  const content = contentOf(message);
  if (!content) return { kind: "ignored", reason: "protocol" };
  const metadata = { [QR_JID_METADATA_KEY]: chat.jid };

  if (key.fromMe) {
    // Reactions and what cannot be shown are not worth pausing the AI for.
    if ("reaction" in content || content.unsupported) return { kind: "ignored", reason: "protocol" };
    return {
      kind: "echo",
      jid: chat.jid,
      media: content.media,
      echo: { externalIds: [id], recipient: chat.person, contentType: content.contentType, text: content.text, media: pendingMedia(content.media), sentAt, metadata },
    };
  }

  const sender: InboundSender = { ...chat.person, displayName: clean(raw.pushName) };
  const base = { kind: "inbound_message" as const, externalId: id, sender, sentAt, metadata };
  if ("reaction" in content) return { kind: "inbound", jid: chat.jid, media: null, event: { ...base, contentType: "text", text: null, reaction: content.reaction, noReply: true } };
  return {
    kind: "inbound",
    jid: chat.jid,
    media: content.media,
    event: { ...base, contentType: content.contentType, text: content.text, media: pendingMedia(content.media), ...(content.unsupported ? { noReply: true } : {}) },
  };
}

// ─── Statuses of what we sent ───────────────────────────────────────────────────────────────────────────

/** The library's status numbers of an outbound message → ours ([QR-08]); null for the ones that say nothing new. */
export function qrDeliveryStatus(status: number | null | undefined): "delivered" | "read" | "failed" | null {
  // 0 ERROR · 1 PENDING · 2 SERVER_ACK · 3 DELIVERY_ACK · 4 READ · 5 PLAYED
  if (status === 0) return "failed";
  if (status === 3) return "delivered";
  return status === 4 || status === 5 ? "read" : null;
}
