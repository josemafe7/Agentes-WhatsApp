// Agenda bookings for people ([AGD-13]–[AGD-19], [AGD-28], [PRU-04], [CTO-02]): the calendar (day, week, month or by
// resource, with filters), a booking's card and history, free slots, and creating, moving, changing and cancelling
// with the same availability rules as the AI ([AGD-17]). Times come and go as the business's wall clock
// ("YYYY-MM-DDTHH:mm" in its time zone) and are stored in UTC. Permissions ([PER-01]): everyone who sees the agenda
// reads it; owner, admin, supervisor and agent manage bookings; nobody else writes. An agent limited to some channels
// only books for contacts of those channels and only links conversations of them ([PER-02]).
import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, notInArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookingEvents, bookings, businessHours, closures, conversations } from "@/db/schema";
import { BOOKING_STATUSES, type BookingActorType, type BookingStatus } from "@/lib/enums";
import { channelFilter, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import {
  addDays,
  ANY_RESOURCE,
  type AvailableSlot,
  cancelBooking,
  changeBookingStatus,
  computeAvailability,
  createBooking,
  daysBetween,
  deleteTestBookings as deleteAllTestBookings,
  isLocalDate,
  loadAgendaSettings,
  loadEngineData,
  loadService,
  localToInstant,
  MAX_RANGE_DAYS,
  parseLocalDateTime,
  rescheduleBooking,
  selectBookingView,
  selectBookingViews,
  sendBookingNotice,
  updateBookingDetails,
  type BookingActor,
  type BookingNoticeKind,
  type BookingNoticeResult,
  type BookingView,
  type UnavailableReason,
} from "@/server/booking";
import { AuthError, NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { loadConversationFor } from "./conversation-scope";
import { assertCan } from "./guard";

export type { BookingView } from "@/server/booking";

// ─── Shared input pieces ─────────────────────────────────────────────────────────────────────────────────

const INVALID_DATE = "Elige una fecha válida.";
const INVALID_TIME = "Elige una fecha y una hora válidas.";

/** A business-local day, "YYYY-MM-DD". */
export const localDateSchema = z.string({ error: INVALID_DATE }).trim().refine(isLocalDate, INVALID_DATE);
/** A business-local time, "YYYY-MM-DDTHH:mm" (an offset such as "+01:00" picks one of the two repeated times). */
export const localDateTimeSchema = z
  .string({ error: INVALID_TIME })
  .trim()
  .max(40, INVALID_TIME)
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$/, INVALID_TIME);
const resourceChoiceSchema = z.union([z.literal(ANY_RESOURCE), idSchema], { error: "Elige un recurso o «Cualquiera»." });

function toInstant(value: string, timezone: string, field: string): Date {
  const instant = parseLocalDateTime(value, timezone);
  if (!instant) throw new ValidationError(undefined, { [field]: [INVALID_TIME] });
  return instant;
}

/** [from, to] local days (both included) as instants; at most MAX_RANGE_DAYS days. */
function dayRange(from: string, to: string, timezone: string): { start: Date; end: Date } {
  const days = daysBetween(from, to);
  if (days < 0) throw new ValidationError(undefined, { to: ["La fecha final no puede ser anterior a la inicial."] });
  if (days >= MAX_RANGE_DAYS) throw new ValidationError(undefined, { to: [`Como mucho ${MAX_RANGE_DAYS} días.`] });
  return { start: localToInstant(from, 0, timezone), end: localToInstant(addDays(to, 1), 0, timezone) };
}

function personActor(actor: Actor): BookingActor {
  return { type: "user", userId: actor.userId, name: actor.name };
}

/** An agent limited to some channels only reaches contacts with a conversation in them ([PER-02]). */
async function assertContactReachable(actor: Actor, contactId: string): Promise<void> {
  const scoped = channelFilter(actor);
  if (!scoped) return;
  const rows = scoped.length
    ? await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.contactId, contactId), eq(conversations.isTest, false), inArray(conversations.channelId, [...scoped])))
        .limit(1)
    : [];
  if (rows.length === 0) throw new AuthError("forbidden");
}

// ─── The calendar ([AGD-16]) ─────────────────────────────────────────────────────────────────────────────

export const calendarFiltersSchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    resourceIds: z.array(idSchema).max(100).optional(),
    serviceIds: z.array(idSchema).max(200).optional(),
    statuses: z.array(z.enum(BOOKING_STATUSES)).max(BOOKING_STATUSES.length).optional(),
    /** «Mostrar canceladas»: cancelled and no-show bookings are hidden unless asked for. */
    includeCancelled: z.boolean().default(false),
    /** Test bookings of «Probar agente» are shown, labelled «Prueba» ([PRU-04]). */
    includeTest: z.boolean().default(true),
  })
  .strict();
export type CalendarFilters = z.input<typeof calendarFiltersSchema>;

const HIDDEN_BY_DEFAULT: BookingStatus[] = ["cancelled", "no_show"];

function filterConditions(filters: z.output<typeof calendarFiltersSchema>, range: { start: Date; end: Date }): SQL[] {
  const conditions: SQL[] = [lt(bookings.startsAt, range.end), gt(bookings.endsAt, range.start)];
  if (filters.resourceIds?.length) conditions.push(inArray(bookings.resourceId, filters.resourceIds));
  if (filters.serviceIds?.length) conditions.push(inArray(bookings.serviceId, filters.serviceIds));
  if (filters.statuses?.length) conditions.push(inArray(bookings.status, filters.statuses));
  else if (!filters.includeCancelled) conditions.push(notInArray(bookings.status, HIDDEN_BY_DEFAULT));
  if (!filters.includeTest) conditions.push(eq(bookings.isTest, false));
  return conditions;
}

/** Bookings that touch the local days [from, to], by start time. The screen groups them by day or by resource. */
export async function listBookings(actor: Actor, input: unknown): Promise<{ timezone: string; bookings: BookingView[] }> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const filters = parseInput(calendarFiltersSchema, input);
  const { timezone } = await loadAgendaSettings();
  const range = dayRange(filters.from, filters.to, timezone);
  return { timezone, bookings: await selectBookingViews(and(...filterConditions(filters, range)), timezone) };
}

export type BookingHistoryItem = {
  id: string;
  action: string;
  actorType: BookingActorType;
  actorName: string | null;
  changes: Record<string, unknown>;
  createdAt: Date;
};

export type BookingDetail = BookingView & { history: BookingHistoryItem[] };

/** The booking's card ([AGD-19]) with its history ([AGD-15]). */
export async function getBooking(actor: Actor, bookingId: unknown): Promise<BookingDetail> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const id = idSchema.safeParse(bookingId);
  const { timezone } = await loadAgendaSettings();
  const view = id.success ? await selectBookingView(id.data, timezone) : null;
  if (!view) throw new NotFoundError("No se ha encontrado la cita.");
  const history = await db
    .select({ id: bookingEvents.id, action: bookingEvents.action, actorType: bookingEvents.actorType, actorName: bookingEvents.actorName, changes: bookingEvents.changes, createdAt: bookingEvents.createdAt })
    .from(bookingEvents)
    .where(eq(bookingEvents.bookingId, view.id))
    .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));
  return { ...view, history };
}

/** A contact's bookings for their card ([CTO-02]): whoever sees the contact and the agenda. Newest first. */
export async function listContactBookings(actor: Actor, contactId: unknown): Promise<BookingView[]> {
  assertCan(actor, PERMISSIONS.agenda.view);
  assertCan(actor, PERMISSIONS.contacts.view);
  const id = idSchema.safeParse(contactId);
  if (!id.success) throw new AuthError("forbidden");
  await assertContactReachable(actor, id.data);
  const { timezone } = await loadAgendaSettings();
  const views = await selectBookingViews(and(eq(bookings.contactId, id.data), eq(bookings.isTest, false)), timezone, { limit: 200 });
  return views.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}

// ─── Free slots ([AGD-08]) ───────────────────────────────────────────────────────────────────────────────

export const availabilityInputSchema = z
  .object({
    serviceId: idSchema,
    from: localDateSchema,
    to: localDateSchema,
    resourceId: resourceChoiceSchema.default(ANY_RESOURCE),
    people: z.number().int().min(1).max(500).optional(),
    /** Moving a booking: it does not block itself. */
    excludeBookingId: idSchema.optional(),
    durationMin: z.number().int().min(1).max(1_440).optional(),
  })
  .strict();

export type AvailabilityView = { timezone: string; slots: AvailableSlot[]; reason: UnavailableReason | null };

/** Free slots of a service between two local days, as the AI sees them ([AGD-17]). */
export async function getAvailability(actor: Actor, input: unknown, options: { now?: Date } = {}): Promise<AvailabilityView> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const data = parseInput(availabilityInputSchema, input);
  const settings = await loadAgendaSettings();
  const service = await loadService(db, data.serviceId);
  if (!service) throw new NotFoundError("No se ha encontrado el servicio.");
  const range = dayRange(data.from, data.to, settings.timezone);
  const engine = await loadEngineData(db, { resourceIds: service.engine.resourceIds, from: range.start, to: range.end, timezone: settings.timezone });
  const result = computeAvailability({
    service: service.engine,
    ...engine,
    timezone: settings.timezone,
    mode: settings.mode,
    from: range.start,
    to: range.end,
    resourceId: data.resourceId,
    people: data.people ?? Math.max(1, service.row.minPeople),
    stepMinutes: settings.stepMinutes,
    now: options.now ?? new Date(),
    durationMin: data.durationMin,
    excludeBookingId: data.excludeBookingId,
  });
  return { timezone: settings.timezone, ...result };
}

/** Opening hours and closures that touch [from, to], for drawing the calendar (open, closed, holidays). */
export async function getAgendaFrame(actor: Actor, input: unknown): Promise<{ timezone: string; hours: { weekday: number; startMin: number; endMin: number }[]; closures: { startDate: string; endDate: string; reason: string | null }[] }> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const { from, to } = parseInput(z.object({ from: localDateSchema, to: localDateSchema }).strict(), input);
  const { timezone } = await loadAgendaSettings();
  dayRange(from, to, timezone);
  const [hours, closureRows] = await Promise.all([
    db.select({ weekday: businessHours.weekday, startMin: businessHours.startMin, endMin: businessHours.endMin }).from(businessHours).orderBy(asc(businessHours.weekday), asc(businessHours.startMin)),
    db.select({ startDate: closures.startDate, endDate: closures.endDate, reason: closures.reason }).from(closures).orderBy(asc(closures.startDate)),
  ]);
  return { timezone, hours, closures: closureRows.filter((closure) => closure.startDate <= to && closure.endDate >= from) };
}

// ─── Create, move, change and cancel ([AGD-17]) ──────────────────────────────────────────────────────────

const notesSchema = z.string().trim().max(2_000, "Como mucho 2.000 caracteres.").nullable().optional();

export const createBookingInputSchema = z
  .object({
    serviceId: idSchema,
    resourceId: resourceChoiceSchema,
    start: localDateTimeSchema,
    people: z.number().int().min(1).max(500).optional(),
    durationMin: z.number().int().min(5).max(1_440).optional(),
    contactId: idSchema.nullable().optional(),
    /** For a customer without a card (or another name on this booking). */
    contactName: z.string().trim().max(200).nullable().optional(),
    notes: notesSchema,
    status: z.enum(["pending", "confirmed"]).optional(),
    /** «Nueva cita» from a conversation ([BAN-*]): links it and its contact. */
    conversationId: idSchema.optional(),
  })
  .strict();

/** «Nueva cita» ([AGD-17], [CTO-02]). Throws SlotUnavailableError with alternatives when the slot was taken ([AGD-13]). */
export async function createBookingByPerson(actor: Actor, input: unknown, options: { now?: Date } = {}): Promise<BookingView> {
  assertCan(actor, PERMISSIONS.agenda.bookings);
  const data = parseInput(createBookingInputSchema, input);
  let contactId = data.contactId ?? null;
  let channelId: string | null = null;
  if (data.conversationId) {
    const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, data.conversationId);
    if (contactId && conversation.contactId !== contactId) throw new ValidationError(undefined, { contactId: ["El contacto no es el de esta conversación."] });
    contactId = conversation.contactId;
    channelId = conversation.channelId;
  }
  if (contactId) await assertContactReachable(actor, contactId);
  if (!contactId && !data.contactName) throw new ValidationError(undefined, { contactId: ["Elige un contacto o escribe un nombre."] });
  const { timezone } = await loadAgendaSettings();
  const booking = await createBooking({
    serviceId: data.serviceId,
    resourceId: data.resourceId,
    start: toInstant(data.start, timezone, "start"),
    people: data.people,
    durationMin: data.durationMin,
    contactId,
    contactName: data.contactName,
    notes: data.notes,
    source: "human",
    channelId,
    conversationId: data.conversationId ?? null,
    status: data.status,
    actor: personActor(actor),
    now: options.now,
  });
  await writeAudit({ actor, action: "booking.created", targetType: "booking", targetId: booking.id, metadata: { status: booking.status } });
  return booking;
}

async function noticeIf(notify: boolean | undefined, view: BookingView, kind: BookingNoticeKind): Promise<BookingNoticeResult | null> {
  return notify ? sendBookingNotice(view, kind) : null;
}

export const moveBookingInputSchema = z
  .object({
    bookingId: idSchema,
    start: localDateTimeSchema.optional(),
    resourceId: resourceChoiceSchema.optional(),
    durationMin: z.number().int().min(5).max(1_440).optional(),
    people: z.number().int().min(1).max(500).optional(),
    /** «Avisar al cliente» by the booking's conversation ([AGD-23]). */
    notifyCustomer: z.boolean().optional(),
  })
  .strict();

/** Moves or stretches a booking (drag and drop or the card); a taken slot is refused and it stays ([AGD-17]). */
export async function moveBooking(actor: Actor, input: unknown, options: { now?: Date } = {}): Promise<{ booking: BookingView; notice: BookingNoticeResult | null }> {
  assertCan(actor, PERMISSIONS.agenda.bookings);
  const data = parseInput(moveBookingInputSchema, input);
  const { timezone } = await loadAgendaSettings();
  const booking = await rescheduleBooking({
    bookingId: data.bookingId,
    start: data.start ? toInstant(data.start, timezone, "start") : undefined,
    resourceId: data.resourceId,
    durationMin: data.durationMin,
    people: data.people,
    actor: personActor(actor),
    now: options.now,
  });
  await writeAudit({ actor, action: "booking.moved", targetType: "booking", targetId: booking.id });
  return { booking, notice: await noticeIf(data.notifyCustomer && data.start !== undefined, booking, "moved") };
}

export const updateBookingInputSchema = z
  .object({
    bookingId: idSchema,
    notes: notesSchema,
    contactId: idSchema.nullable().optional(),
    contactName: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

/** Notes and contact of a booking. */
export async function updateBooking(actor: Actor, input: unknown): Promise<BookingView> {
  assertCan(actor, PERMISSIONS.agenda.bookings);
  const data = parseInput(updateBookingInputSchema, input);
  if (data.contactId) await assertContactReachable(actor, data.contactId);
  const booking = await updateBookingDetails({ bookingId: data.bookingId, notes: data.notes, contactId: data.contactId, contactName: data.contactName, actor: personActor(actor) });
  await writeAudit({ actor, action: "booking.updated", targetType: "booking", targetId: booking.id });
  return booking;
}

export const bookingStatusInputSchema = z
  .object({
    bookingId: idSchema,
    status: z.enum(BOOKING_STATUSES, { error: "Estado no válido." }),
    reason: z.string().trim().max(500).nullable().optional(),
    notifyCustomer: z.boolean().optional(),
  })
  .strict();

/** Confirm, cancel, complete or no-show ([AGD-14]); optionally tells the customer a confirmation or a cancellation. */
export async function setBookingStatus(actor: Actor, input: unknown, options: { now?: Date } = {}): Promise<{ booking: BookingView; notice: BookingNoticeResult | null }> {
  assertCan(actor, PERMISSIONS.agenda.bookings);
  const data = parseInput(bookingStatusInputSchema, input);
  const bookingActor = personActor(actor);
  const booking =
    data.status === "cancelled"
      ? await cancelBooking({ bookingId: data.bookingId, reason: data.reason, actor: bookingActor, now: options.now })
      : await changeBookingStatus({ bookingId: data.bookingId, status: data.status, actor: bookingActor, now: options.now });
  await writeAudit({ actor, action: "booking.status_changed", targetType: "booking", targetId: booking.id, metadata: { status: booking.status } });
  const kind: BookingNoticeKind | null = data.status === "confirmed" ? "confirmed" : data.status === "cancelled" ? "cancelled" : null;
  return { booking, notice: kind ? await noticeIf(data.notifyCustomer, booking, kind) : null };
}

// ─── Test bookings ([PRU-04]) ────────────────────────────────────────────────────────────────────────────

export async function countTestBookings(actor: Actor): Promise<number> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const rows = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.isTest, true));
  return rows.length;
}

/** «Borrar citas de prueba»: every booking made from «Probar agente», at once. */
export async function deleteTestBookings(actor: Actor): Promise<{ deleted: number }> {
  assertCan(actor, PERMISSIONS.agenda.deleteTestBookings);
  const deleted = await deleteAllTestBookings();
  await writeAudit({ actor, action: "booking.test_deleted", targetType: "booking", metadata: { deleted } });
  return { deleted };
}

// ─── Next booking of contacts (list of Contactos) ────────────────────────────────────────────────────────

/** The next pending or confirmed booking of each contact given, for the contacts list ([CTO-01]). */
export async function nextBookingsOf(actor: Actor, contactIds: readonly string[], options: { now?: Date } = {}): Promise<Map<string, { id: string; startsAt: Date }>> {
  assertCan(actor, PERMISSIONS.agenda.view);
  const ids = contactIds.filter((id) => idSchema.safeParse(id).success);
  const result = new Map<string, { id: string; startsAt: Date }>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({ id: bookings.id, contactId: bookings.contactId, startsAt: bookings.startsAt })
    .from(bookings)
    .where(
      and(
        inArray(bookings.contactId, ids),
        isNotNull(bookings.contactId),
        inArray(bookings.status, ["pending", "confirmed"]),
        eq(bookings.isTest, false),
        gt(bookings.startsAt, options.now ?? new Date()),
      ),
    )
    .orderBy(desc(bookings.startsAt));
  for (const row of rows) if (row.contactId) result.set(row.contactId, { id: row.id, startsAt: row.startsAt });
  return result;
}
