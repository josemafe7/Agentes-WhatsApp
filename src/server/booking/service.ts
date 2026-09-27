// Booking service ([AGD-13]–[AGD-15], [AGD-17], [AGD-18], [AGD-22], [PRU-04]): every change of a booking goes
// through here, inside a short write transaction (libSQL: BEGIN IMMEDIATE, one writer at a time) that checks the slot
// again with the availability engine before saving, so two requests for the last slot never both get in: the second
// receives «Ese hueco ya no está libre» with alternatives. Nothing external is called inside a transaction. Every
// change leaves a row in booking_events (who, what, when). System code: the data layer checks the person's
// permissions and the agent's tools the conversation's contact (BookingScope); the same rules apply to both.
import "server-only";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { db, type Executor, type Transaction } from "@/db";
import { bookingEvents, bookings, contacts, reminderSettings, resources, resourceTimeOff } from "@/db/schema";
import type { BookingSource, BookingStatus, TimeOffKind } from "@/lib/enums";
import { AppError, NotFoundError, ValidationError } from "@/server/errors";
import {
  type AvailableSlot,
  bookingTimes,
  closestSlots,
  computeAvailability,
  freeResourcesForStart,
  OCCUPYING_STATUSES,
  type UnavailableReason,
} from "./availability";
import { type BookingActor, recordBookingEvent } from "./events";
import { BOOKING_STATUS_LABELS } from "./format";
import { type AgendaSettingsSnapshot, loadAgendaSettings, loadEngineData, loadService, type LoadedService } from "./load";
import { notifyPendingBooking } from "./notices";
import { addDays, DAY_MS, instantToLocal, localToInstant, MINUTE_MS, MINUTES_PER_DAY } from "./time";
import { type BookingView, selectBookingView } from "./views";
import { serializeBookingWrite } from "./write-queue";

export { recordBookingEvent, type BookingActor, type BookingEventAction } from "./events";

export const SLOT_TAKEN_MESSAGE = "Ese hueco ya no está libre.";
/** How far ahead alternatives are looked for when a slot is taken ([AGD-13]). */
const ALTERNATIVE_DAYS = 7;
const ALTERNATIVES = 3;
const MAX_NOTES = 2_000;
const MAX_NAME = 200;
const MAX_REASON = 500;
const NOT_FOUND = "No se ha encontrado la cita.";

/** Why a request can never fit, in Spanish (for people and the agent). */
export const UNAVAILABLE_REASON_TEXT: Record<UnavailableReason, string> = {
  service_inactive: "Este servicio no está disponible.",
  second_resource: "Este servicio necesita dos recursos a la vez y todavía no se puede reservar.",
  group_size: "El número de personas no está entre el mínimo y el máximo del servicio.",
  group_too_large: "No hay ningún recurso con capacidad para tantas personas.",
  no_resources: "Ese recurso no hace este servicio o no está activo.",
};

/** The slot was free when shown but not any more ([AGD-13], [HER-06]); `alternatives` are the closest free ones. */
export class SlotUnavailableError extends AppError {
  constructor(readonly alternatives: AvailableSlot[]) {
    super(409, "slot_unavailable", SLOT_TAKEN_MESSAGE);
  }
}

/** The request can never fit, whatever the time (group size, inactive service…). */
export class BookingRuleError extends AppError {
  constructor(readonly reason: UnavailableReason) {
    super(400, reason, UNAVAILABLE_REASON_TEXT[reason]);
  }
}

/**
 * What an agent's tool may touch ([HER-04], [PER-08]): only the bookings of the conversation's contact, or, in
 * «Probar agente», only test bookings. People (data layer) pass no scope.
 */
export type BookingScope = { contactId: string } | { testOnly: true };

function assertMinutes(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > MINUTES_PER_DAY)) throw new ValidationError(`${label} no válida.`);
}

function assertPeople(value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new ValidationError("El número de personas no es válido.");
}

function cleanText(text: string | null | undefined, max: number): string | null {
  const value = text?.trim();
  return value ? value.slice(0, max) : null;
}

/** A booking write transaction, queued behind the other booking writes of this process (./write-queue.ts). */
function bookingTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return serializeBookingWrite(() => db.transaction(work));
}

/** What was asked, to look for alternatives once the transaction is over. */
type SlotRequest = { serviceId: string; resourceId: string; start: Date; people: number; durationMin: number };
type TxOutcome = { ok: true; id: string } | { ok: false; reason: UnavailableReason | null; request: SlotRequest };
type SlotCheck = { resourceId: string } | { reason: UnavailableReason | null };

/** Inside the transaction: the resource that gets the booking at `start`, or why none does. */
async function checkSlot(
  tx: Executor,
  settings: AgendaSettingsSnapshot,
  service: LoadedService,
  request: SlotRequest & { now: Date; excludeBookingId?: string; ignoreAdvance?: boolean },
): Promise<SlotCheck> {
  const end = new Date(request.start.getTime() + request.durationMin * MINUTE_MS);
  const data = await loadEngineData(tx, { resourceIds: service.engine.resourceIds, from: request.start, to: end, timezone: settings.timezone });
  const { resources: free, reason } = freeResourcesForStart({
    service: service.engine,
    ...data,
    timezone: settings.timezone,
    mode: settings.mode,
    from: request.start,
    resourceId: request.resourceId,
    people: request.people,
    stepMinutes: settings.stepMinutes,
    now: request.now,
    durationMin: request.durationMin,
    excludeBookingId: request.excludeBookingId,
    ignoreAdvance: request.ignoreAdvance,
  });
  return free.length > 0 ? { resourceId: free[0].resourceId } : { reason };
}

/** The closest free slots to `around` for the same request, in the week from its day ([AGD-13]). */
export async function findAlternatives(request: {
  serviceId: string;
  resourceId: string;
  around: Date;
  people: number;
  durationMin?: number;
  excludeBookingId?: string;
  now: Date;
  count?: number;
}): Promise<AvailableSlot[]> {
  const settings = await loadAgendaSettings();
  const service = await loadService(db, request.serviceId);
  if (!service) return [];
  const day = instantToLocal(request.around, settings.timezone).date;
  const from = localToInstant(day, 0, settings.timezone);
  const to = localToInstant(addDays(day, ALTERNATIVE_DAYS), 0, settings.timezone);
  const data = await loadEngineData(db, { resourceIds: service.engine.resourceIds, from, to, timezone: settings.timezone });
  const { slots } = computeAvailability({
    service: service.engine,
    ...data,
    timezone: settings.timezone,
    mode: settings.mode,
    from,
    to,
    resourceId: request.resourceId,
    people: request.people,
    stepMinutes: settings.stepMinutes,
    now: request.now,
    durationMin: request.durationMin,
    excludeBookingId: request.excludeBookingId,
  });
  return closestSlots(
    slots.filter((slot) => slot.start.getTime() !== request.around.getTime()),
    request.around,
    request.count ?? ALTERNATIVES,
  );
}

/** Outside the transaction: the rule that can never fit, or the taken slot with its alternatives. */
async function unavailable(outcome: Extract<TxOutcome, { ok: false }>, now: Date, excludeBookingId?: string): Promise<never> {
  if (outcome.reason) throw new BookingRuleError(outcome.reason);
  const alternatives = await findAlternatives({ ...outcome.request, around: outcome.request.start, excludeBookingId, now });
  throw new SlotUnavailableError(alternatives);
}

async function viewOrThrow(bookingId: string, timezone: string): Promise<BookingView> {
  const view = await selectBookingView(bookingId, timezone);
  if (!view) throw new NotFoundError(NOT_FOUND);
  return view;
}

// ─── Create ──────────────────────────────────────────────────────────────────────────────────────────────

export type CreateBookingInput = {
  serviceId: string;
  /** A resource id, or "any" to let the app assign one ([AGD-12]). */
  resourceId: string;
  start: Date;
  /** Default: the service's minimum. */
  people?: number;
  /** Visible length when a person stretches it; default the service duration. */
  durationMin?: number;
  contactId: string | null;
  /** Name for the booking; default the contact's name. */
  contactName?: string | null;
  notes?: string | null;
  source: BookingSource;
  /** The channel and conversation the AI booked through ([AGD-14], [AGD-19]). */
  channelId?: string | null;
  conversationId?: string | null;
  /** «Probar agente» ([PRU-04]). */
  isTest?: boolean;
  /** A person may create it already confirmed; otherwise pending when the service asks for manual confirmation ([AGD-22]). */
  status?: "pending" | "confirmed";
  actor: BookingActor;
  now?: Date;
};

/**
 * Creates a booking if the slot is still free when saving. Throws SlotUnavailableError (with alternatives),
 * BookingRuleError, NotFoundError (service or contact) or ValidationError. A pending booking of a real customer
 * notifies the team ([AGD-22]).
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingView> {
  const now = input.now ?? new Date();
  assertMinutes(input.durationMin, "Duración");
  assertPeople(input.people);
  const settings = await loadAgendaSettings();
  const outcome = await bookingTransaction(async (tx): Promise<TxOutcome> => {
    const service = await loadService(tx, input.serviceId);
    if (!service) throw new NotFoundError("No se ha encontrado el servicio.");
    let contactName = cleanText(input.contactName, MAX_NAME);
    if (input.contactId) {
      const [contact] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!contact) throw new NotFoundError("No se ha encontrado el contacto.");
      contactName ??= cleanText(contact.name, MAX_NAME);
    }
    const request: SlotRequest = {
      serviceId: service.row.id,
      resourceId: input.resourceId,
      start: input.start,
      people: input.people ?? Math.max(1, service.row.minPeople),
      durationMin: input.durationMin ?? service.row.durationMin,
    };
    const check = await checkSlot(tx, settings, service, { ...request, now });
    if (!("resourceId" in check)) return { ok: false, reason: check.reason, request };
    const status: BookingStatus = input.status ?? (service.row.requiresManualConfirmation ? "pending" : "confirmed");
    const times = bookingTimes(input.start, service.row, request.durationMin);
    const [row] = await tx
      .insert(bookings)
      .values({
        contactId: input.contactId,
        contactName,
        serviceId: service.row.id,
        resourceId: check.resourceId,
        ...times,
        people: request.people,
        status,
        source: input.source,
        channelId: input.channelId ?? null,
        conversationId: input.conversationId ?? null,
        notes: cleanText(input.notes, MAX_NOTES),
        createdByUserId: input.actor.type === "user" ? input.actor.userId : null,
        createdByName: input.actor.type === "system" ? null : input.actor.name,
        isTest: input.isTest ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: bookings.id });
    await recordBookingEvent(
      tx,
      row.id,
      input.actor,
      "created",
      { status, source: input.source, serviceId: service.row.id, resourceId: check.resourceId, startsAt: times.startsAt.toISOString(), people: request.people },
      now,
    );
    return { ok: true, id: row.id };
  });
  if (!outcome.ok) return unavailable(outcome, now);
  const view = await viewOrThrow(outcome.id, settings.timezone);
  if (view.status === "pending" && !view.isTest) await notifyPendingBooking(view, settings);
  return view;
}

// ─── Load one booking for a change ───────────────────────────────────────────────────────────────────────

const changeColumns = {
  id: bookings.id,
  serviceId: bookings.serviceId,
  resourceId: bookings.resourceId,
  contactId: bookings.contactId,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  people: bookings.people,
  status: bookings.status,
  isTest: bookings.isTest,
  reminderSentAt: bookings.reminderSentAt,
};
type ChangeRow = Pick<typeof bookings.$inferSelect, keyof typeof changeColumns>;

function inScope(row: ChangeRow, scope: BookingScope | undefined): boolean {
  if (!scope) return true;
  if ("testOnly" in scope) return row.isTest;
  return !row.isTest && row.contactId === scope.contactId;
}

/** The booking, or «not found» also when it is outside the scope: an agent never learns that another exists. */
async function loadForChange(tx: Executor, bookingId: string, scope: BookingScope | undefined): Promise<ChangeRow> {
  const [row] = await tx.select(changeColumns).from(bookings).where(eq(bookings.id, bookingId));
  if (!row || !inScope(row, scope)) throw new NotFoundError(NOT_FOUND);
  return row;
}

const isOccupying = (status: BookingStatus) => OCCUPYING_STATUSES.includes(status);

// ─── Move, stretch or change the group ───────────────────────────────────────────────────────────────────

export type RescheduleBookingInput = {
  bookingId: string;
  /** New start; default the current one. */
  start?: Date;
  /** Another resource, or "any"; default the current one. */
  resourceId?: string;
  /** New visible length; default the current one. */
  durationMin?: number;
  people?: number;
  actor: BookingActor;
  scope?: BookingScope;
  now?: Date;
};

async function reminderLeadMinutes(tx: Executor): Promise<number | null> {
  const [settings] = await tx.select({ enabled: reminderSettings.enabled, leadMinutes: reminderSettings.leadMinutes }).from(reminderSettings).limit(1);
  return settings?.enabled ? settings.leadMinutes : null;
}

/**
 * Moves a booking (start, resource, length or group size) if the new slot is free when saving ([AGD-17],
 * [HER-06]). Only pending and confirmed bookings move. A reminder already sent is sent again at the new time when
 * that moment is still ahead ([AGD-25]).
 */
export async function rescheduleBooking(input: RescheduleBookingInput): Promise<BookingView> {
  const now = input.now ?? new Date();
  assertMinutes(input.durationMin, "Duración");
  assertPeople(input.people);
  const settings = await loadAgendaSettings();
  const outcome = await bookingTransaction(async (tx): Promise<TxOutcome> => {
    const current = await loadForChange(tx, input.bookingId, input.scope);
    if (!isOccupying(current.status)) throw new ValidationError("Solo se pueden cambiar las citas pendientes o confirmadas.");
    const service = await loadService(tx, current.serviceId);
    if (!service) throw new NotFoundError("No se ha encontrado el servicio.");
    const request: SlotRequest = {
      serviceId: service.row.id,
      resourceId: input.resourceId ?? current.resourceId,
      start: input.start ?? current.startsAt,
      people: input.people ?? current.people,
      durationMin: input.durationMin ?? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / MINUTE_MS),
    };
    const moved = request.start.getTime() !== current.startsAt.getTime();
    const check = await checkSlot(tx, settings, service, { ...request, now, excludeBookingId: current.id, ignoreAdvance: !moved });
    if (!("resourceId" in check)) return { ok: false, reason: check.reason, request };
    const times = bookingTimes(request.start, service.row, request.durationMin);
    const lead = await reminderLeadMinutes(tx);
    // «Si la cita se mueve, se recalcula»: a new reminder only if its new moment is still ahead.
    const resetReminder = moved && current.reminderSentAt !== null && lead !== null && request.start.getTime() - lead * MINUTE_MS > now.getTime();
    await tx
      .update(bookings)
      .set({ ...times, resourceId: check.resourceId, people: request.people, ...(resetReminder ? { reminderSentAt: null } : {}), updatedAt: now })
      .where(eq(bookings.id, current.id));
    const changes: Record<string, unknown> = {};
    if (moved) changes.startsAt = { from: current.startsAt.toISOString(), to: request.start.toISOString() };
    if (check.resourceId !== current.resourceId) changes.resourceId = { from: current.resourceId, to: check.resourceId };
    if (times.endsAt.getTime() !== current.endsAt.getTime()) changes.endsAt = { from: current.endsAt.toISOString(), to: times.endsAt.toISOString() };
    if (request.people !== current.people) changes.people = { from: current.people, to: request.people };
    if (Object.keys(changes).length > 0) {
      await recordBookingEvent(tx, current.id, input.actor, moved || changes.resourceId ? "moved" : "updated", changes, now);
    }
    return { ok: true, id: current.id };
  });
  if (!outcome.ok) return unavailable(outcome, now, input.bookingId);
  return viewOrThrow(outcome.id, settings.timezone);
}

// ─── Status ──────────────────────────────────────────────────────────────────────────────────────────────

export type ChangeBookingStatusInput = {
  bookingId: string;
  status: BookingStatus;
  /** Why it is cancelled (optional). */
  reason?: string | null;
  actor: BookingActor;
  scope?: BookingScope;
  /** Only from these statuses (the agent cancels only pending or confirmed bookings). */
  allowedFrom?: readonly BookingStatus[];
  now?: Date;
};

/**
 * Confirms, cancels, completes or marks a no-show ([AGD-14]). Bringing back a cancelled, completed or no-show
 * booking checks its slot again, since it may have been taken meanwhile ([AGD-13]).
 */
export async function changeBookingStatus(input: ChangeBookingStatusInput): Promise<BookingView> {
  const now = input.now ?? new Date();
  const settings = await loadAgendaSettings();
  const outcome = await bookingTransaction(async (tx): Promise<TxOutcome> => {
    const current = await loadForChange(tx, input.bookingId, input.scope);
    if (current.status === input.status) return { ok: true, id: current.id };
    if (input.allowedFrom && !input.allowedFrom.includes(current.status)) {
      throw new ValidationError(`Esta cita está ${BOOKING_STATUS_LABELS[current.status]}: no se puede cambiar así.`);
    }
    if (!isOccupying(current.status) && isOccupying(input.status)) {
      const service = await loadService(tx, current.serviceId);
      if (!service) throw new NotFoundError("No se ha encontrado el servicio.");
      const request: SlotRequest = {
        serviceId: current.serviceId,
        resourceId: current.resourceId,
        start: current.startsAt,
        people: current.people,
        durationMin: Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / MINUTE_MS),
      };
      const check = await checkSlot(tx, settings, service, { ...request, now, excludeBookingId: current.id, ignoreAdvance: true });
      if (!("resourceId" in check)) return { ok: false, reason: check.reason, request };
    }
    const cancelled = input.status === "cancelled";
    await tx
      .update(bookings)
      .set({ status: input.status, cancelledAt: cancelled ? now : null, cancelReason: cancelled ? cleanText(input.reason, MAX_REASON) : null, updatedAt: now })
      .where(eq(bookings.id, current.id));
    await recordBookingEvent(tx, current.id, input.actor, cancelled ? "cancelled" : "status_changed", { status: { from: current.status, to: input.status } }, now);
    return { ok: true, id: current.id };
  });
  if (!outcome.ok) return unavailable(outcome, now, input.bookingId);
  return viewOrThrow(outcome.id, settings.timezone);
}

/** Cancels a pending or confirmed booking; the slot is free again at once ([AGD-09], [AGD-26]). */
export async function cancelBooking(input: Omit<ChangeBookingStatusInput, "status" | "allowedFrom">): Promise<BookingView> {
  return changeBookingStatus({ ...input, status: "cancelled", allowedFrom: OCCUPYING_STATUSES });
}

// ─── Details that do not touch availability ──────────────────────────────────────────────────────────────

export type UpdateBookingDetailsInput = {
  bookingId: string;
  notes?: string | null;
  /** Another contact (or none). */
  contactId?: string | null;
  contactName?: string | null;
  actor: BookingActor;
  now?: Date;
};

export async function updateBookingDetails(input: UpdateBookingDetailsInput): Promise<BookingView> {
  const now = input.now ?? new Date();
  const settings = await loadAgendaSettings();
  await bookingTransaction(async (tx) => {
    const current = await loadForChange(tx, input.bookingId, undefined);
    const values: Partial<typeof bookings.$inferInsert> = {};
    if (input.notes !== undefined) values.notes = cleanText(input.notes, MAX_NOTES);
    if (input.contactId !== undefined) {
      values.contactId = input.contactId;
      if (input.contactId) {
        const [contact] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, input.contactId));
        if (!contact) throw new NotFoundError("No se ha encontrado el contacto.");
        values.contactName = cleanText(input.contactName, MAX_NAME) ?? cleanText(contact.name, MAX_NAME);
      }
    }
    if (input.contactName !== undefined && values.contactName === undefined) values.contactName = cleanText(input.contactName, MAX_NAME);
    if (Object.keys(values).length === 0) return;
    await tx.update(bookings).set({ ...values, updatedAt: now }).where(eq(bookings.id, current.id));
    // The history keeps which fields changed, not the text of the notes.
    await recordBookingEvent(tx, current.id, input.actor, "updated", { fields: Object.keys(values) }, now);
  });
  return viewOrThrow(input.bookingId, settings.timezone);
}

// ─── Absences and blocked slots ([AGD-02], [AGD-18]) ─────────────────────────────────────────────────────

export type AddTimeOffInput = {
  resourceId: string;
  kind: TimeOffKind;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
  actor: BookingActor;
  now?: Date;
};

/** Longest absence or block (a year). */
const MAX_TIME_OFF_MS = 366 * DAY_MS;

/**
 * Blocks a slot or records an absence: no new booking fits there. Bookings already inside stay, and are counted so
 * the screen can say so.
 */
export async function addTimeOff(input: AddTimeOffInput): Promise<{ id: string; overlappingBookings: number }> {
  const now = input.now ?? new Date();
  const length = input.endsAt.getTime() - input.startsAt.getTime();
  if (length <= 0) throw new ValidationError(undefined, { endsAt: ["El final tiene que ser posterior al inicio."] });
  if (length > MAX_TIME_OFF_MS) throw new ValidationError(undefined, { endsAt: ["Como mucho un año."] });
  const [resource] = await db.select({ id: resources.id }).from(resources).where(eq(resources.id, input.resourceId));
  if (!resource) throw new NotFoundError("No se ha encontrado el recurso.");
  const [row] = await db
    .insert(resourceTimeOff)
    .values({
      resourceId: resource.id,
      kind: input.kind,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: cleanText(input.reason, MAX_NAME),
      createdByUserId: input.actor.type === "user" ? input.actor.userId : null,
      createdByName: input.actor.type === "system" ? null : input.actor.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: resourceTimeOff.id });
  const overlapping = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.resourceId, resource.id),
        inArray(bookings.status, [...OCCUPYING_STATUSES]),
        lt(bookings.startsAt, input.endsAt),
        gt(bookings.endsAt, input.startsAt),
      ),
    );
  return { id: row.id, overlappingBookings: overlapping.length };
}

export async function removeTimeOff(timeOffId: string): Promise<void> {
  const deleted = await db.delete(resourceTimeOff).where(eq(resourceTimeOff.id, timeOffId)).returning({ id: resourceTimeOff.id });
  if (deleted.length === 0) throw new NotFoundError("Ese bloqueo o ausencia ya no existe.");
}

// ─── Test bookings ([PRU-04]) ────────────────────────────────────────────────────────────────────────────

/** Deletes every booking made from «Probar agente», history first (no cascades). Returns how many. */
export async function deleteTestBookings(): Promise<number> {
  return bookingTransaction(async (tx) => {
    const rows = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.isTest, true));
    if (rows.length === 0) return 0;
    const ids = rows.map((row) => row.id);
    await tx.delete(bookingEvents).where(inArray(bookingEvents.bookingId, ids));
    await tx.delete(bookings).where(inArray(bookings.id, ids));
    return ids.length;
  });
}
