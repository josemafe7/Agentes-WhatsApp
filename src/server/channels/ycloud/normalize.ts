// A verified YCloud webhook → what the common pipeline understands ([YC-05]–[YC-08], docs/integracion-ycloud.md
// «Recepción»). Pure (no database). YCloud wraps Meta's own message content in an envelope of its own, so a customer's
// message is rewritten with the Cloud API's field names and read by the WhatsApp normalizer: every type, identity and
// «no admitido» rule of the direct connection applies as it is. What YCloud sends is data, never instructions.
import "server-only";
import type { MessageContentType } from "@/lib/enums";
import { phoneDigits } from "@/lib/meta/markets";
import { describeYCloudError, metaCodeOf } from "@/lib/ycloud/errors";
import { ycloudEventSchema, ycloudInboundMessageSchema, ycloudMessageSchema, type YCloudMessage } from "@/lib/ycloud/schemas";
import type { PhoneEcho } from "../phone-echo";
import type { ChannelDeliveryStatus, StatusUpdateEvent } from "../types";
import { normalizeWhatsAppMessage, UNSUPPORTED_TEXT, type MessageOutcome } from "../whatsapp/normalize";

/** A file still at YCloud: its link (signed, only for YCloud's host) is downloaded in a job right after. */
export type YCloudMediaDownload = { externalId: string; url: string; mimeType: string | null; fileName: string | null };

export type YCloudChange =
  /** `number`: digits of the business number the event is about; an event for another number is not this channel's. */
  | { kind: "inbound"; number: string; outcome: MessageOutcome; download: YCloudMediaDownload | null }
  | { kind: "status"; number: string | null; status: StatusUpdateEvent }
  | { kind: "echo"; number: string; echo: PhoneEcho; download: YCloudMediaDownload | null }
  | { kind: "template" }
  | { kind: "ignored" };

export type NormalizedYCloudEvent = { eventId: string; type: string; change: YCloudChange };

const MEDIA_KEYS = ["image", "audio", "video", "document", "sticker"] as const;
const MEDIA_TYPES: Record<string, MessageContentType> = { image: "image", audio: "audio", video: "video", document: "document", sticker: "sticker" };
const STATUSES = new Set<ChannelDeliveryStatus>(["sent", "delivered", "read", "failed"]);

const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Unix seconds of an ISO time, or of `fallback`. */
function unixSeconds(iso: string | null | undefined, fallback: Date): number {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Math.floor((Number.isNaN(time) ? fallback.getTime() : time) / 1_000);
}

const dateOf = (iso: string | null | undefined, fallback: Date) => new Date(unixSeconds(iso, fallback) * 1_000);

/** The message's file with the Cloud API's names: YCloud calls the download address `link`. */
function mediaOf(raw: Record<string, unknown>): { key: (typeof MEDIA_KEYS)[number]; media: Record<string, unknown> } | null {
  for (const key of MEDIA_KEYS) {
    const media = record(raw[key]);
    if (media) return { key, media: { ...media, url: clean(media.link) ?? undefined } };
  }
  return null;
}

function inbound(raw: unknown, receivedAt: Date): YCloudChange {
  const head = ycloudInboundMessageSchema.safeParse(raw);
  const source = record(raw);
  if (!head.success || !source) return { kind: "ignored" };
  const from = phoneDigits(head.data.from) || null;
  const media = mediaOf(source);
  // The wamid identifies the message everywhere (reactions and replies name it); YCloud's own id while it is missing.
  const externalId = clean(head.data.wamid) ?? head.data.id;
  const message = {
    ...source,
    ...(media ? { [media.key]: media.media } : {}),
    id: externalId,
    from,
    from_user_id: clean(head.data.fromUserId),
    timestamp: unixSeconds(head.data.sendTime, receivedAt),
  };
  const contact = { wa_id: from, user_id: clean(head.data.fromUserId), profile: { name: clean(head.data.customerProfile?.name), username: clean(head.data.customerProfile?.username) } };
  const outcome = normalizeWhatsAppMessage(message, [contact]);
  if (!outcome) return { kind: "ignored" };
  const url = outcome.download?.url ?? null;
  return {
    kind: "inbound",
    number: phoneDigits(head.data.to),
    outcome,
    download: outcome.download && url ? { externalId, url, mimeType: outcome.download.mimeType, fileName: outcome.download.fileName } : null,
  };
}

function statusTime(message: YCloudMessage, status: ChannelDeliveryStatus, fallback: Date): Date {
  const iso = status === "read" ? message.readTime : status === "delivered" ? message.deliverTime : status === "sent" ? message.sendTime : message.updateTime;
  return dateOf(iso ?? message.updateTime, fallback);
}

function status(raw: unknown, receivedAt: Date): YCloudChange {
  const parsed = ycloudMessageSchema.safeParse(raw);
  if (!parsed.success) return { kind: "ignored" };
  const message = parsed.data;
  const value = message.status?.toLowerCase() as ChannelDeliveryStatus | undefined;
  // «accepted» only says YCloud took it: nothing to show yet.
  if (!value || !STATUSES.has(value)) return { kind: "ignored" };
  const metaCode = metaCodeOf(message.whatsappApiError?.code) ?? metaCodeOf(message.errorCode);
  const code = typeof message.errorCode === "string" ? message.errorCode : null;
  const error = value === "failed" ? { code: metaCode ?? code ?? undefined, message: describeYCloudError({ code, metaCode }).message } : null;
  const pricing = message.pricingType || message.pricingCategory ? { type: clean(message.pricingType), category: clean(message.pricingCategory) } : null;
  return {
    kind: "status",
    number: phoneDigits(message.from) || null,
    // Our message is stored with YCloud's id, the one the send answered.
    status: { kind: "status_update", externalId: message.id, status: value, at: statusTime(message, value, receivedAt), error, pricing },
  };
}

/** A message the business wrote from its phone ([YC-08]). */
function echo(raw: unknown, receivedAt: Date): YCloudChange {
  const parsed = ycloudMessageSchema.safeParse(raw);
  const source = record(raw);
  if (!parsed.success || !source) return { kind: "ignored" };
  const message = parsed.data;
  const to = phoneDigits(message.to) || null;
  const userId = clean(message.toUserId) ?? clean(message.recipientUserId);
  const externalIds = [userId, to].filter((id): id is string => Boolean(id));
  if (externalIds.length === 0) return { kind: "ignored" };
  const media = mediaOf(source);
  const contentType: MessageContentType = message.type === "text" ? "text" : (MEDIA_TYPES[message.type ?? ""] ?? "unsupported");
  const text = contentType === "text" ? clean(message.text?.body) : contentType === "unsupported" ? UNSUPPORTED_TEXT : clean(media?.media.caption);
  if (contentType === "text" && !text) return { kind: "ignored" };
  const mediaId = media ? (typeof media.media.id === "string" || typeof media.media.id === "number" ? String(media.media.id) : null) : null;
  const url = media ? clean(media.media.url) : null;
  const mimeType = media ? clean(media.media.mime_type) : null;
  const fileName = media ? clean(media.media.filename) : null;
  return {
    kind: "echo",
    number: phoneDigits(message.from),
    echo: {
      externalIds: [message.id, clean(message.wamid)].filter((id): id is string => Boolean(id)),
      recipient: { externalIds, phone: to, displayName: clean(message.customerProfile?.name) },
      contentType,
      text,
      media: media && contentType !== "unsupported" ? { ...(mediaId ? { externalMediaId: mediaId } : {}), ...(mimeType ? { mimeType } : {}), ...(fileName ? { fileName } : {}), downloadStatus: url ? "pending" : "failed" } : null,
      sentAt: dateOf(message.sendTime ?? message.createTime, receivedAt),
    },
    download: media && contentType !== "unsupported" && url ? { externalId: message.id, url, mimeType, fileName } : null,
  };
}

/** Null when `body` is not a YCloud event at all. */
export function normalizeYCloudEvent(body: unknown, receivedAt: Date = new Date()): NormalizedYCloudEvent | null {
  const event = ycloudEventSchema.safeParse(body);
  if (!event.success) return null;
  const { id, type } = event.data;
  const change = ((): YCloudChange => {
    switch (type) {
      case "whatsapp.inbound_message.received":
        return inbound(event.data.whatsappInboundMessage, receivedAt);
      case "whatsapp.message.updated":
        return status(event.data.whatsappMessage, receivedAt);
      case "whatsapp.smb.message.echoes":
        return echo(event.data.whatsappMessage, receivedAt);
      case "whatsapp.template.reviewed":
        return { kind: "template" };
      default:
        // New event types appear without notice («Versioning»): acknowledged and left alone.
        return { kind: "ignored" };
    }
  })();
  return { eventId: id, type, change };
}
