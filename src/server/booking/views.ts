// A booking as the screens, the agent's tools and the notices read it: names instead of ids and business-local
// times ([AGD-14], [AGD-19], [AGD-28]). System reads; callers check permissions and scope.
import "server-only";
import { asc, eq, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { bookings, channels, resources, services } from "@/db/schema";
import type { BookingSource, BookingStatus, ChannelType, ResourceColor } from "@/lib/enums";
import { formatLocalIso } from "./time";

export type BookingView = {
  id: string;
  status: BookingStatus;
  source: BookingSource;
  startsAt: Date;
  endsAt: Date;
  /** Business-local times with their offset ("2026-09-29T10:00:00+02:00"). */
  startLocal: string;
  endLocal: string;
  people: number;
  /** Created from «Probar agente» ([PRU-04]). */
  isTest: boolean;
  notes: string | null;
  service: { id: string; name: string };
  resource: { id: string; name: string; color: ResourceColor };
  /** Null once the contact was deleted (the booking is kept anonymised, [CTO-07]) or for test bookings. */
  contactId: string | null;
  contactName: string | null;
  /** The channel the AI booked through ([AGD-14]). */
  channel: { id: string; name: string; type: ChannelType } | null;
  conversationId: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  reminderSentAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
};

const viewColumns = {
  id: bookings.id,
  status: bookings.status,
  source: bookings.source,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  people: bookings.people,
  isTest: bookings.isTest,
  notes: bookings.notes,
  serviceId: services.id,
  serviceName: services.name,
  resourceId: resources.id,
  resourceName: resources.name,
  resourceColor: resources.color,
  contactId: bookings.contactId,
  contactName: bookings.contactName,
  channelId: channels.id,
  channelName: channels.name,
  channelType: channels.type,
  conversationId: bookings.conversationId,
  createdByUserId: bookings.createdByUserId,
  createdByName: bookings.createdByName,
  reminderSentAt: bookings.reminderSentAt,
  cancelledAt: bookings.cancelledAt,
  cancelReason: bookings.cancelReason,
  createdAt: bookings.createdAt,
};

/** Bookings matching `where`, by start time (then resource order), with at most `limit` rows. */
export async function selectBookingViews(
  where: SQL | undefined,
  timeZone: string,
  options: { executor?: Executor; limit?: number } = {},
): Promise<BookingView[]> {
  const query = (options.executor ?? db)
    .select(viewColumns)
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .innerJoin(resources, eq(resources.id, bookings.resourceId))
    .leftJoin(channels, eq(channels.id, bookings.channelId))
    .where(where)
    .orderBy(asc(bookings.startsAt), asc(resources.sortOrder), asc(resources.name), asc(bookings.id));
  const rows = options.limit ? await query.limit(options.limit) : await query;
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    source: row.source,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    startLocal: formatLocalIso(row.startsAt, timeZone),
    endLocal: formatLocalIso(row.endsAt, timeZone),
    people: row.people,
    isTest: row.isTest,
    notes: row.notes,
    service: { id: row.serviceId, name: row.serviceName },
    resource: { id: row.resourceId, name: row.resourceName, color: row.resourceColor },
    contactId: row.contactId,
    contactName: row.contactName,
    channel: row.channelId && row.channelName && row.channelType ? { id: row.channelId, name: row.channelName, type: row.channelType } : null,
    conversationId: row.conversationId,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    reminderSentAt: row.reminderSentAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
  }));
}

export async function selectBookingView(bookingId: string, timeZone: string, executor: Executor = db): Promise<BookingView | null> {
  const [view] = await selectBookingViews(eq(bookings.id, bookingId), timeZone, { executor, limit: 1 });
  return view ?? null;
}
