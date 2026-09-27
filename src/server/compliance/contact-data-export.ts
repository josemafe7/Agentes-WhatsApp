// «Exportar sus datos» ([CTO-06], [CUM-07]): everything the app keeps about one contact, in one JSON file — its data,
// identities, consents, conversations with their messages (transcripts included), internal notes and hand-offs, and
// its bookings with their history. Files go as metadata and an in-app link (served only with a session, [MED-08]), never
// their bytes. System read: src/data/contacts-export.ts checks the permission and writes the activity log.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { fileUrl } from "@/data/business";
import { db } from "@/db";
import { bookingEvents, bookings, channels, consents, contactIdentities, contacts, conversations, handoffEvents, internalNotes, messages, type MessageReaction } from "@/db/schema";
import type {
  BookingActorType,
  BookingSource,
  BookingStatus,
  ChannelType,
  ConsentType,
  ConversationStatus,
  HandoffTrigger,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  SenderType,
  Urgency,
} from "@/lib/enums";
import { appUrl } from "@/server/app-url";
import { selectBookingViews } from "@/server/booking";

/** Name and version of the file format, so a later version can still be read. */
export const CONTACT_EXPORT_FORMAT = "dominia-agentes/contacto";
export const CONTACT_EXPORT_VERSION = 1;

type ChannelRef = { id: string; name: string; type: ChannelType };

export type ExportedFile = { name: string | null; mimeType: string | null; size: number | null; sha256: string | null; url: string | null };

export type ExportedMessage = {
  id: string;
  direction: MessageDirection;
  senderType: SenderType;
  /** The person or AI agent that wrote it; null for the customer and the system. */
  authorName: string | null;
  contentType: MessageContentType;
  text: string | null;
  transcript: string | null;
  /** Email subject, when the channel gives one. */
  subject: string | null;
  file: ExportedFile | null;
  status: MessageStatus;
  reactions: MessageReaction[];
  sentAt: Date | null;
  createdAt: Date;
};

export type ExportedConversation = {
  id: string;
  channel: ChannelRef;
  status: ConversationStatus;
  labels: string[];
  summary: string | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  messages: ExportedMessage[];
  internalNotes: { authorName: string | null; text: string; createdAt: Date }[];
  handoffs: { trigger: HandoffTrigger; reason: string | null; summary: string | null; urgency: Urgency; requestedAt: Date; firstHumanResponseAt: Date | null }[];
};

export type ExportedBooking = {
  id: string;
  service: string;
  resource: string;
  startsAt: Date;
  endsAt: Date;
  /** Business-local start and end with their offset. */
  startLocal: string;
  endLocal: string;
  people: number;
  status: BookingStatus;
  source: BookingSource;
  channel: { name: string; type: ChannelType } | null;
  notes: string | null;
  createdByName: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  history: { action: string; actorType: BookingActorType; actorName: string | null; changes: Record<string, unknown>; createdAt: Date }[];
};

export type ContactExport = {
  format: typeof CONTACT_EXPORT_FORMAT;
  version: typeof CONTACT_EXPORT_VERSION;
  /** What the file holds, in Spanish, for whoever opens it. */
  description: string;
  exportedAt: Date;
  business: { name: string | null; timezone: string };
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    labels: string[];
    customFields: Record<string, string>;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  identities: { channelType: ChannelType; externalId: string; phone: string | null; displayName: string | null; createdAt: Date }[];
  consents: { type: ConsentType; channel: ChannelRef | null; channelType: ChannelType | null; source: string; recordedByName: string | null; note: string | null; createdAt: Date }[];
  conversations: ExportedConversation[];
  bookings: ExportedBooking[];
};

const DESCRIPTION =
  "Datos de un contacto exportados desde DominIA Agentes: sus datos, sus identidades en cada canal, sus consentimientos y " +
  "bajas, sus conversaciones con los mensajes (y la transcripción de los audios), las notas internas y los traspasos, y " +
  "sus citas con su historial. Los archivos van con su nombre, tipo, tamaño y huella; su enlace solo se abre con una " +
  "sesión en la app. Las fechas están en UTC (formato ISO 8601).";

function exportedFile(media: typeof messages.$inferSelect.media): ExportedFile | null {
  if (!media) return null;
  return {
    name: media.fileName ?? null,
    mimeType: media.mimeType ?? null,
    size: media.size ?? null,
    sha256: media.sha256 ?? null,
    url: media.fileKey ? appUrl(fileUrl(media.fileKey)) : null,
  };
}

const textOf = (value: unknown): string | null => (typeof value === "string" ? value : null);

async function exportedConversations(contactId: string): Promise<ExportedConversation[]> {
  const rows = await db
    .select({
      id: conversations.id,
      channelId: channels.id,
      channelName: channels.name,
      channelType: channels.type,
      status: conversations.status,
      labels: conversations.labels,
      summary: conversations.summary,
      createdAt: conversations.createdAt,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(and(eq(conversations.contactId, contactId), eq(conversations.isTest, false)))
    .orderBy(asc(conversations.createdAt), asc(conversations.id));
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const [messageRows, noteRows, handoffRows] = await Promise.all([
    db.select().from(messages).where(inArray(messages.conversationId, ids)).orderBy(asc(messages.createdAt), asc(messages.id)),
    db.select().from(internalNotes).where(inArray(internalNotes.conversationId, ids)).orderBy(asc(internalNotes.createdAt), asc(internalNotes.id)),
    db.select().from(handoffEvents).where(inArray(handoffEvents.conversationId, ids)).orderBy(asc(handoffEvents.requestedAt), asc(handoffEvents.id)),
  ]);
  return rows.map((row) => ({
    id: row.id,
    channel: { id: row.channelId, name: row.channelName, type: row.channelType },
    status: row.status,
    labels: row.labels,
    summary: row.summary,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
    messages: messageRows
      .filter((message) => message.conversationId === row.id)
      .map((message) => ({
        id: message.id,
        direction: message.direction,
        senderType: message.senderType,
        authorName: message.senderType === "human" ? message.senderName : message.senderType === "ai" ? message.agentName : null,
        contentType: message.contentType,
        text: message.text,
        transcript: message.transcript,
        subject: textOf(message.metadata.subject),
        file: exportedFile(message.media),
        status: message.status,
        reactions: message.reactions,
        sentAt: message.sentAt,
        createdAt: message.createdAt,
      })),
    internalNotes: noteRows.filter((note) => note.conversationId === row.id).map((note) => ({ authorName: note.authorName, text: note.text, createdAt: note.createdAt })),
    handoffs: handoffRows
      .filter((handoff) => handoff.conversationId === row.id)
      .map((handoff) => ({
        trigger: handoff.trigger,
        reason: handoff.reason,
        summary: handoff.summary,
        urgency: handoff.urgency,
        requestedAt: handoff.requestedAt,
        firstHumanResponseAt: handoff.firstHumanResponseAt,
      })),
  }));
}

async function exportedBookings(contactId: string, timeZone: string): Promise<ExportedBooking[]> {
  const views = await selectBookingViews(and(eq(bookings.contactId, contactId), eq(bookings.isTest, false)), timeZone);
  if (views.length === 0) return [];
  const history = await db
    .select()
    .from(bookingEvents)
    .where(
      inArray(
        bookingEvents.bookingId,
        views.map((view) => view.id),
      ),
    )
    .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));
  return views.map((view) => ({
    id: view.id,
    service: view.service.name,
    resource: view.resource.name,
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    startLocal: view.startLocal,
    endLocal: view.endLocal,
    people: view.people,
    status: view.status,
    source: view.source,
    channel: view.channel ? { name: view.channel.name, type: view.channel.type } : null,
    notes: view.notes,
    createdByName: view.createdByName,
    cancelledAt: view.cancelledAt,
    cancelReason: view.cancelReason,
    createdAt: view.createdAt,
    history: history
      .filter((event) => event.bookingId === view.id)
      .map((event) => ({ action: event.action, actorType: event.actorType, actorName: event.actorName, changes: event.changes, createdAt: event.createdAt })),
  }));
}

/** Everything about one contact, or null when it does not exist. */
export async function collectContactData(contactId: string, options: { now?: Date } = {}): Promise<ContactExport | null> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return null;
  const business = await loadBusinessSettings();
  const [identities, consentRows, exported, bookingRows] = await Promise.all([
    db
      .select({
        channelType: contactIdentities.channelType,
        externalId: contactIdentities.externalId,
        phone: contactIdentities.phone,
        displayName: contactIdentities.displayName,
        createdAt: contactIdentities.createdAt,
      })
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, contact.id))
      .orderBy(asc(contactIdentities.createdAt), asc(contactIdentities.id)),
    db
      .select({
        type: consents.type,
        channelId: channels.id,
        channelName: channels.name,
        channelKind: channels.type,
        channelType: consents.channelType,
        source: consents.source,
        recordedByName: consents.recordedByName,
        note: consents.note,
        createdAt: consents.createdAt,
      })
      .from(consents)
      .leftJoin(channels, eq(channels.id, consents.channelId))
      .where(eq(consents.contactId, contact.id))
      .orderBy(asc(consents.createdAt), asc(consents.id)),
    exportedConversations(contact.id),
    exportedBookings(contact.id, business.timezone),
  ]);
  return {
    format: CONTACT_EXPORT_FORMAT,
    version: CONTACT_EXPORT_VERSION,
    description: DESCRIPTION,
    exportedAt: options.now ?? new Date(),
    business: { name: business.name, timezone: business.timezone },
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      labels: contact.labels,
      customFields: contact.customFields,
      notes: contact.notes,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    },
    identities,
    consents: consentRows.map((row) => ({
      type: row.type,
      channel: row.channelId && row.channelName && row.channelKind ? { id: row.channelId, name: row.channelName, type: row.channelKind } : null,
      channelType: row.channelType,
      source: row.source,
      recordedByName: row.recordedByName,
      note: row.note,
      createdAt: row.createdAt,
    })),
    conversations: exported,
    bookings: bookingRows,
  };
}
