// A verified WhatsApp webhook → normalized events of the common pipeline ([WA-33]–[WA-40], [WA-50],
// docs/integracion-whatsapp-mensajes.md §5–§9). Pure (no database): the webhook processing (webhook.ts) decides the
// channel of each change, applies identity changes, ingests the events and queues the media downloads.
// Identities: the BSUID (user_id / from_user_id) first, then the wa_id; the phone is data, never a key. Every text
// that comes from Meta is data, never instructions.
import "server-only";
import { describeMetaError } from "@/lib/meta/errors";
import { isBsuid, phoneDigits } from "@/lib/meta/markets";
import {
  messagesValueSchema,
  parseEach,
  webhookContactSchema,
  webhookEnvelopeSchema,
  webhookMessageSchema,
  webhookStatusSchema,
  type WebhookContact,
  type WebhookMedia,
  type WebhookMessage,
  type WebhookStatus,
} from "@/lib/meta/webhook";
import type { MessageContentType } from "@/lib/enums";
import { safeFileName } from "@/server/media/store";
import type { AccountEvent, ChannelDeliveryStatus, InboundMessageEvent, InboundSender, StatusUpdateEvent } from "../types";

/** Account fields this app subscribes to (docs/integracion-whatsapp.md §4.1); others are ignored. */
export const ACCOUNT_FIELDS = new Set([
  "account_update",
  "phone_number_quality_update",
  "phone_number_name_update",
  "message_template_status_update",
  "template_category_update",
  "message_template_quality_update",
  "business_capability_update",
  "account_alerts",
  "security",
]);

export type WhatsAppMediaDownload = { wamid: string; mediaId: string; url: string | null; mimeType: string | null; fileName: string | null };
export type IdentityChange = { type: "user_changed_number" | "user_changed_user_id"; previousUserId: string; userId: string; waId: string | null };
/** A status names the BSUID of a recipient we wrote to by phone: it completes that contact's identity ([WA-40]). */
export type StatusIdentity = { wamid: string; userId: string; waId: string | null };

export type MessagesChange = {
  kind: "messages";
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  inbound: InboundMessageEvent[];
  statuses: StatusUpdateEvent[];
  mediaDownloads: WhatsAppMediaDownload[];
  identityChanges: IdentityChange[];
  statusIdentities: StatusIdentity[];
  /** `value.errors` without messages or statuses: system, app or account problems (§7.4). */
  errors: AccountEvent[];
};

export type AccountChange = {
  kind: "account";
  field: string;
  wabaId: string;
  /** The number it is about, when the event names one (digits of display_phone_number). */
  displayPhoneNumber: string | null;
  /** account_alerts about a PHONE_NUMBER carry its phone_number_id in entity_id. */
  phoneNumberId: string | null;
  event: AccountEvent;
};

export type NormalizedChange = MessagesChange | AccountChange;

export const UNSUPPORTED_TEXT = "Tipo de mensaje no admitido";
const IDENTITY_TEXT: Record<IdentityChange["type"], string> = {
  user_changed_number: "El cliente ha cambiado de número de WhatsApp.",
  user_changed_user_id: "El identificador de WhatsApp del cliente ha cambiado.",
};
const MEDIA_TYPES: Record<string, MessageContentType> = { audio: "audio", image: "image", video: "video", document: "document", sticker: "sticker" };
const STATUSES = new Set<ChannelDeliveryStatus>(["sent", "delivered", "read", "played", "failed"]);

const toDate = (seconds: number) => new Date(seconds * 1_000);
const clean = (value: string | null | undefined) => value?.trim() || null;

/** Meta puts up to 1,000 updates in one POST (docs/integracion-whatsapp-mensajes.md §4): never more. */
export const WEBHOOK_MAX_UPDATES = 1_000;
/** Numbers and accounts one POST may name before its signature is checked: an installation has a few ([SEG-07]). */
export const WEBHOOK_MAX_ROUTING_IDS = 100;

/** A cheap count before any parsing: a bigger batch than Meta sends is refused as it is ([SEG-07]). */
function withinBatchLimits(body: unknown): boolean {
  const entries = typeof body === "object" && body !== null ? (body as { entry?: unknown }).entry : null;
  if (!Array.isArray(entries) || entries.length > WEBHOOK_MAX_UPDATES) return false;
  let updates = 0;
  for (const entry of entries) {
    const changes = typeof entry === "object" && entry !== null ? (entry as { changes?: unknown }).changes : null;
    updates += Array.isArray(changes) ? changes.length : 0;
    if (updates > WEBHOOK_MAX_UPDATES) return false;
  }
  return true;
}

/**
 * Where the POST goes, read before the signature is checked (nothing is stored or processed until then). Null when
 * it is not a WhatsApp webhook, or when it is bigger or names more numbers or accounts than any real one ([SEG-07]).
 */
export function webhookRouting(body: unknown): { phoneNumberIds: string[]; wabaIds: string[] } | null {
  if (!withinBatchLimits(body)) return null;
  const envelope = webhookEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  const phoneNumberIds = new Set<string>();
  const wabaIds = new Set<string>();
  for (const entry of envelope.data.entry) {
    wabaIds.add(entry.id);
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = messagesValueSchema.safeParse(change.value);
      if (value.success) phoneNumberIds.add(value.data.metadata.phone_number_id);
    }
  }
  if (phoneNumberIds.size > WEBHOOK_MAX_ROUTING_IDS || wabaIds.size > WEBHOOK_MAX_ROUTING_IDS) return null;
  return { phoneNumberIds: [...phoneNumberIds], wabaIds: [...wabaIds] };
}

function senderOf(message: WebhookMessage, contacts: WebhookContact[]): InboundSender | null {
  const contact =
    contacts.find((item) => (message.from_user_id && item.user_id === message.from_user_id) || (message.from && item.wa_id === message.from)) ??
    (contacts.length === 1 ? contacts[0] : undefined);
  const bsuid = clean(message.from_user_id) ?? clean(contact?.user_id);
  const waId = phoneDigits(message.from ?? contact?.wa_id) || null;
  const externalIds = [bsuid, waId].filter((id): id is string => Boolean(id));
  if (externalIds.length === 0) return null;
  return { externalIds, phone: waId, displayName: clean(contact?.profile?.name) };
}

function baseMetadata(message: WebhookMessage, contacts: WebhookContact[]): Record<string, unknown> {
  const username = contacts.find((item) => item.user_id && item.user_id === message.from_user_id)?.profile?.username;
  const context = message.context;
  return {
    ...(username ? { whatsappUsername: username } : {}),
    ...(context?.id ? { quotedExternalId: context.id } : {}),
    ...(context?.forwarded || context?.frequently_forwarded ? { forwarded: true } : {}),
    ...(message.referral ? { referral: { sourceType: message.referral.source_type ?? null, sourceUrl: message.referral.source_url ?? null, headline: message.referral.headline ?? null } } : {}),
  };
}

function mediaOf(type: string, message: WebhookMessage): WebhookMedia | null {
  const media = { audio: message.audio, image: message.image, video: message.video, document: message.document, sticker: message.sticker }[type];
  return media ?? null;
}

function locationText(location: NonNullable<WebhookMessage["location"]>): string {
  const place = [clean(location.name), clean(location.address)].filter(Boolean).join(" · ");
  return `Ubicación: ${place ? `${place} ` : ""}(${location.latitude}, ${location.longitude})`;
}

function contactsText(shared: NonNullable<WebhookMessage["contacts"]>): string {
  return shared
    .map((card) => {
      const parts = [
        clean(card.name?.formatted_name) ?? "Sin nombre",
        ...(card.phones ?? []).map((phone) => clean(phone.phone) ?? (phone.wa_id ? `+${phoneDigits(phone.wa_id)}` : null)),
        ...(card.emails ?? []).map((email) => clean(email.email)),
        clean(card.org?.company),
      ].filter(Boolean);
      return `Contacto: ${parts.join(" · ")}`;
    })
    .join("\n");
}

function unsupported(base: Omit<InboundMessageEvent, "contentType">, kind: string, message: WebhookMessage): InboundMessageEvent {
  const codes = (message.errors ?? []).map((error) => error.code).filter((code): code is number => typeof code === "number");
  return { ...base, contentType: "unsupported", text: UNSUPPORTED_TEXT, noReply: true, metadata: { ...base.metadata, unsupported: { type: kind, codes } } };
}

type MessageOutcome = { event: InboundMessageEvent | null; download: WhatsAppMediaDownload | null; identity: IdentityChange | null };

function systemOutcome(message: WebhookMessage, sentAt: Date): MessageOutcome {
  const system = message.system;
  const userId = clean(system?.user_id);
  const previousUserId = clean(system?.previous_user_id);
  const waId = phoneDigits(system?.wa_id ?? message.from) || null;
  const rawType = system?.type;
  const type: IdentityChange["type"] | null = rawType === "user_changed_number" || rawType === "user_changed_user_id" ? rawType : null;
  const identity: IdentityChange | null = type && userId && previousUserId ? { type, previousUserId, userId, waId } : null;
  const externalIds = [userId ?? clean(message.from_user_id), waId].filter((id): id is string => Boolean(id));
  if (externalIds.length === 0) return { event: null, download: null, identity };
  const event: InboundMessageEvent = {
    kind: "inbound_message",
    externalId: message.id,
    sender: { externalIds, phone: waId },
    contentType: "system",
    text: identity ? IDENTITY_TEXT[identity.type] : "Aviso del sistema de WhatsApp.",
    sentAt,
    // A notice of the channel, never a customer's turn ([WA-50]).
    noReply: true,
    metadata: identity ? { identityChange: identity } : { systemType: clean(system?.type) },
  };
  return { event, download: null, identity };
}

function messageOutcome(message: WebhookMessage, contacts: WebhookContact[]): MessageOutcome {
  const sentAt = toDate(message.timestamp);
  if (message.type === "system") return systemOutcome(message, sentAt);
  const sender = senderOf(message, contacts);
  if (!sender) return { event: null, download: null, identity: null };
  const base = { kind: "inbound_message" as const, externalId: message.id, sender, sentAt, metadata: baseMetadata(message, contacts) };
  const none = { download: null, identity: null };

  const mediaType = MEDIA_TYPES[message.type];
  if (mediaType) {
    const media = mediaOf(message.type, message);
    if (!media) return { event: unsupported(base, message.type, message), ...none };
    const fileName = message.type === "document" ? (safeFileName(media.filename) ?? null) : null;
    const event: InboundMessageEvent = {
      ...base,
      contentType: mediaType,
      text: clean(media.caption),
      media: { externalMediaId: media.id, mimeType: media.mime_type ?? undefined, ...(fileName ? { fileName } : {}), downloadStatus: "pending" },
      metadata: { ...base.metadata, ...(media.voice ? { voice: true } : {}), ...(media.animated ? { animated: true } : {}) },
    };
    return { event, download: { wamid: message.id, mediaId: media.id, url: clean(media.url), mimeType: clean(media.mime_type), fileName }, identity: null };
  }

  switch (message.type) {
    case "text":
      return message.text ? { event: { ...base, contentType: "text", text: message.text.body }, ...none } : { event: unsupported(base, "text", message), ...none };
    case "location":
      if (!message.location) break;
      return {
        event: { ...base, contentType: "location", text: locationText(message.location), metadata: { ...base.metadata, location: message.location } },
        ...none,
      };
    case "contacts": {
      if (!message.contacts?.length) break;
      // The customer shared their own number on request: it goes to their identity as data ([WA-39]).
      const requested = message.contacts.find((card) => card.origin === "contact_request");
      const sharedPhone = phoneDigits(requested?.phones?.[0]?.wa_id ?? requested?.phones?.[0]?.phone) || null;
      const withPhone = sharedPhone && !sender.phone ? { ...sender, phone: sharedPhone } : sender;
      return { event: { ...base, sender: withPhone, contentType: "contacts", text: contactsText(message.contacts) }, ...none };
    }
    case "interactive": {
      const interactive = message.interactive;
      if (!interactive) break;
      const reply = interactive.button_reply ?? interactive.list_reply;
      const text = reply?.title ?? (interactive.nfm_reply ? "Formulario completado" : "Respuesta interactiva");
      const detail = reply
        ? { type: interactive.type, id: reply.id, title: reply.title, ...(interactive.list_reply?.description ? { description: interactive.list_reply.description } : {}) }
        : { type: interactive.type, ...(interactive.nfm_reply ? { flowName: interactive.nfm_reply.name ?? null, responseJson: interactive.nfm_reply.response_json ?? null } : {}) };
      return { event: { ...base, contentType: "interactive", text, metadata: { ...base.metadata, interactive: detail } }, ...none };
    }
    case "button":
      if (!message.button) break;
      return {
        event: { ...base, contentType: "interactive", text: clean(message.button.text) ?? clean(message.button.payload), metadata: { ...base.metadata, button: message.button } },
        ...none,
      };
    case "reaction":
      if (!message.reaction) break;
      // Without `emoji` the customer removed the reaction ([WA-37]); stored on the target, never answered.
      return { event: { ...base, contentType: "text", text: null, reaction: { targetExternalId: message.reaction.message_id, emoji: clean(message.reaction.emoji) } }, ...none };
  }
  return { event: unsupported(base, message.unsupported?.type ?? message.type, message), ...none };
}

function statusOf(status: WebhookStatus): StatusUpdateEvent | null {
  const value = status.status.toLowerCase() as ChannelDeliveryStatus;
  if (!STATUSES.has(value)) return null;
  const first = status.errors?.[0];
  const error = value === "failed" ? { code: first?.code ?? undefined, message: describeMetaError(first?.code ?? null).message } : null;
  const pricing = status.pricing && (status.pricing.type || status.pricing.category) ? { type: clean(status.pricing.type), category: clean(status.pricing.category) } : null;
  return { kind: "status_update", externalId: status.id, status: value, at: toDate(status.timestamp), error, pricing };
}

function messagesChange(wabaId: string, rawValue: unknown): MessagesChange | null {
  const value = messagesValueSchema.safeParse(rawValue);
  if (!value.success) return null;
  const contacts = parseEach(webhookContactSchema, value.data.contacts);
  const change: MessagesChange = {
    kind: "messages",
    wabaId,
    phoneNumberId: value.data.metadata.phone_number_id,
    displayPhoneNumber: phoneDigits(value.data.metadata.display_phone_number) || null,
    inbound: [],
    statuses: [],
    mediaDownloads: [],
    identityChanges: [],
    statusIdentities: [],
    errors: [],
  };
  for (const message of parseEach(webhookMessageSchema, value.data.messages)) {
    const outcome = messageOutcome(message, contacts);
    if (outcome.event) change.inbound.push(outcome.event);
    if (outcome.download) change.mediaDownloads.push(outcome.download);
    if (outcome.identity) change.identityChanges.push(outcome.identity);
  }
  for (const status of parseEach(webhookStatusSchema, value.data.statuses)) {
    const event = statusOf(status);
    if (event) change.statuses.push(event);
    const userId = clean(status.recipient_user_id);
    if (event && userId && isBsuid(userId)) change.statusIdentities.push({ wamid: status.id, userId, waId: phoneDigits(status.recipient_id) || null });
  }
  const errors = (value.data.errors ?? []).filter((error): error is Record<string, unknown> => typeof error === "object" && error !== null);
  if (errors.length > 0) change.errors.push({ kind: "account_event", event: "messages_errors", data: { wabaId, errors } });
  return change;
}

function accountChange(wabaId: string, time: number | null | undefined, field: string, rawValue: unknown): AccountChange | null {
  if (!ACCOUNT_FIELDS.has(field) || typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) return null;
  const value = rawValue as Record<string, unknown>;
  const display = typeof value.display_phone_number === "string" ? phoneDigits(value.display_phone_number) || null : null;
  const entityId = value.entity_type === "PHONE_NUMBER" && (typeof value.entity_id === "string" || typeof value.entity_id === "number") ? String(value.entity_id) : null;
  return {
    kind: "account",
    field,
    wabaId,
    displayPhoneNumber: display,
    phoneNumberId: entityId,
    event: { kind: "account_event", event: field, data: { ...value, wabaId, ...(typeof time === "number" ? { time } : {}) } },
  };
}

/** Every change of a verified webhook, or null when the body is not a WhatsApp webhook. */
export function normalizeWhatsAppWebhook(body: unknown): NormalizedChange[] | null {
  const envelope = webhookEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  const changes: NormalizedChange[] = [];
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes ?? []) {
      const normalized = change.field === "messages" ? messagesChange(entry.id, change.value) : accountChange(entry.id, entry.time, change.field, change.value);
      if (normalized) changes.push(normalized);
    }
  }
  return changes;
}
