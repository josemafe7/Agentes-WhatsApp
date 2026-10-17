// A verified Instagram webhook → what the app does with it ([IG-03], [IG-06], [IG-07], [CAN-13],
// docs/integracion-instagram.md §5 and §7). Pure (no database): webhook.ts ingests the events and queues the rest. Only the
// entries of the channel's own account count (`entry[].id` = `user_id` of /me); each `messaging[]` item is parsed on its
// own, so one odd item never drops the others. The identity is the customer's Instagram-scoped id (IGSID, `sender.id`),
// never a phone nor the user name. Whatever Instagram sends is data, never instructions.
//
// - A customer's message: its text, and each file a separate message (`mid`, then `mid#1`, `mid#2`…). Images, voice notes
//   and PDF are downloaded right after; anything else (videos, shared posts, reels, stories, story mentions…) is one
//   system message «Tipo de mensaje no admitido» that the AI never answers. Of a story (a mention or a reply to it) no
//   address is ever kept: Meta forbids storing it (§7).
// - A reaction goes on the message it reacts to; «seen» marks our message as read.
// - An echo (what the business account sent) is looked at right away, telling the app's own sends apart ([IG-06]); a
//   message the account wrote to itself (`is_self`) is ignored.
// - A message the customer deleted is deleted in the app too ([IG-07]).
import "server-only";
import { instantOf, webhookBodySchema, webhookEventSchema, type InstagramWebhookEvent, type InstagramWebhookMessage } from "@/lib/instagram/schemas";
import type { InboundMessageEvent, InboundSender, NormalizedEvent, StatusUpdateEvent } from "../types";
import { UNSUPPORTED_TEXT } from "../whatsapp/normalize";

/** A customer's file, still on Instagram's CDN: downloaded in a job right after ([IG-03]). */
export type InstagramMediaDownload = { externalId: string; url: string; contentType: "image" | "audio" | "document" };

/** What the business account sent: the webhook handles it at once, inside the same notice ([IG-06]). */
export type InstagramEcho = { userId: string; mid: string; text: string | null; hasAttachment: boolean; sentAt: Date };

export type NormalizedInstagramWebhook = {
  /** Customers' messages and reactions, and «seen» of ours: for the common pipeline. */
  events: NormalizedEvent[];
  downloads: InstagramMediaDownload[];
  echoes: InstagramEcho[];
  /** `mid`s the customer deleted ([IG-07]). */
  deletions: string[];
  /** Whether at least one entry is of this account: only then is the raw webhook kept. */
  forAccount: boolean;
};

/** Attachment types a customer's message may carry that the app downloads, and what they become. */
const DOWNLOADED_TYPES: Readonly<Record<string, InstagramMediaDownload["contentType"]>> = { image: "image", audio: "audio", file: "document" };

/** How many parts a message may become (its text, its files and one notice): bounds the ids a deletion looks for. */
export const INSTAGRAM_MAX_PARTS = 22;

/** The id of the n-th part of a message: the first keeps the `mid` (reactions and deletions point to it). */
export const instagramPartId = (mid: string, index: number) => (index === 0 ? mid : `${mid}#${index}`);

/** Every id the parts of a message may have. */
export const instagramPartIds = (mid: string) => Array.from({ length: INSTAGRAM_MAX_PARTS }, (_, index) => instagramPartId(mid, index));

const clean = (value: string | null | undefined) => value?.trim() || null;
/** Instagram-scoped ids are digits. */
const IGSID = /^\d{1,32}$/;

/** What kind of not-admitted content it was, only to name it; never its address. */
function unsupportedKind(message: InstagramWebhookMessage): string {
  const other = message.attachments?.find((attachment) => !DOWNLOADED_TYPES[attachment.type]);
  if (other) return other.type.slice(0, 40);
  return message.is_unsupported ? "unsupported" : "other";
}

/** A customer's message → its parts: text, files, and at most one notice for what the app does not admit. */
function customerMessage(item: InstagramWebhookEvent, message: InstagramWebhookMessage, out: NormalizedInstagramWebhook): void {
  const sender: InboundSender = { externalIds: [item.sender.id] };
  const sentAt = instantOf(item.timestamp);
  // An answer to a story is its text, marked as such; the story's address is never kept (§7).
  const metadata: Record<string, unknown> = message.reply_to?.story ? { storyReply: true } : {};
  const parts: Omit<InboundMessageEvent, "kind" | "externalId" | "sender" | "sentAt">[] = [];
  // A tap on a quick reply comes with its text: it is read as what the customer wrote.
  const text = clean(message.text) ?? clean(message.quick_reply?.payload);
  if (text) parts.push({ contentType: "text", text, metadata });
  const downloads: { index: number; url: string; contentType: InstagramMediaDownload["contentType"] }[] = [];
  let unsupported = message.is_unsupported === true;
  for (const attachment of message.attachments ?? []) {
    const contentType = DOWNLOADED_TYPES[attachment.type];
    const url = clean(attachment.payload?.url);
    if (!contentType || !url) {
      unsupported = true;
      continue;
    }
    downloads.push({ index: parts.length, url, contentType });
    // The address stays only until the file is stored: the stored media replaces it.
    parts.push({ contentType, text: null, media: { externalMediaId: url, downloadStatus: "pending" }, metadata });
  }
  if (unsupported || parts.length === 0) {
    // Shown as a notice of the system and never answered by the AI ([IG-03]).
    // It is still the customer writing: the 24 h window opens with it ([IG-04]).
    parts.push({ contentType: "unsupported", text: UNSUPPORTED_TEXT, noReply: true, opensWindow: true, metadata: { ...metadata, unsupported: { type: unsupportedKind(message) } } });
  }
  parts.forEach((part, index) => out.events.push({ kind: "inbound_message", externalId: instagramPartId(message.mid, index), sender, sentAt, ...part }));
  for (const download of downloads) out.downloads.push({ externalId: instagramPartId(message.mid, download.index), url: download.url, contentType: download.contentType });
}

/** One `messaging[]` item of this account; anything it does not understand is left out. */
function normalizeItem(raw: unknown, accountId: string, out: NormalizedInstagramWebhook): void {
  const parsed = webhookEventSchema.safeParse(raw);
  if (!parsed.success) return;
  const item = parsed.data;
  const message = item.message;
  if (message) {
    // A message of the account to itself (tests in Instagram): never a customer's ([IG-06], §11).
    if (message.is_self) return;
    if (message.is_echo) {
      // What the business deleted on its side is not news for the app; a customer is always an id of digits (§5.1).
      if (message.is_deleted || !IGSID.test(item.recipient.id)) return;
      const hasAttachment = (message.attachments?.length ?? 0) > 0 || message.is_unsupported === true;
      out.echoes.push({ userId: item.recipient.id, mid: message.mid, text: clean(message.text), hasAttachment, sentAt: instantOf(item.timestamp) });
      return;
    }
    // Only customers write to the account; anything else claiming to be the account itself is not one.
    if (item.sender.id === accountId) return;
    if (message.is_deleted) {
      out.deletions.push(message.mid);
      return;
    }
    customerMessage(item, message, out);
    return;
  }
  if (item.reaction && item.sender.id !== accountId) {
    const emoji = item.reaction.action === "unreact" ? null : clean(item.reaction.emoji);
    // A reaction without its emoji says nothing to show.
    if (item.reaction.action !== "unreact" && !emoji) return;
    out.events.push({
      kind: "inbound_message",
      externalId: `reaction:${item.reaction.mid}:${item.timestamp}`,
      sender: { externalIds: [item.sender.id] },
      contentType: "text",
      text: null,
      sentAt: instantOf(item.timestamp),
      reaction: { targetExternalId: item.reaction.mid, emoji },
    });
    return;
  }
  if (item.read) {
    const status: StatusUpdateEvent = { kind: "status_update", externalId: item.read.mid, status: "read", at: instantOf(item.timestamp) };
    out.events.push(status);
  }
}

/** Null when `body` is not an Instagram webhook at all. */
export function normalizeInstagramWebhook(body: unknown, accountId: string | null): NormalizedInstagramWebhook | null {
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) return null;
  const out: NormalizedInstagramWebhook = { events: [], downloads: [], echoes: [], deletions: [], forAccount: false };
  if (!accountId) return out;
  for (const entry of parsed.data.entry) {
    // Another account's notices (the dashboard's «Test» button, another app's account) are not this channel's.
    if (entry.id !== accountId) continue;
    out.forAccount = true;
    for (const item of entry.messaging ?? []) normalizeItem(item, accountId, out);
  }
  return out;
}
