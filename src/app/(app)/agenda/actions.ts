"use server";
// Server Actions of the Agenda screen ([AGD-13]–[AGD-19], [PRU-04]). Thin: session and permission here, then
// src/data/bookings*.ts, which checks the permission again and validates every field with Zod ([SEG-04], [SEG-05]).
// People follow the same availability rules as the AI ([AGD-17]): a slot taken meanwhile answers «Ese hueco ya no
// está libre» with the closest free ones ([AGD-13]).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAgendaSettings, listResources } from "@/data/agenda-config";
import { createBookingByPerson, deleteTestBookings, getAvailability, moveBooking, setBookingStatus, updateBooking } from "@/data/bookings";
import { addResourceTimeOff, removeResourceTimeOff } from "@/data/bookings-time-off";
import { createContact, listContacts } from "@/data/contacts";
import { fail, ok, type ActionFailure, type ActionResult, type ActionSuccess } from "@/lib/action-result";
import type { BookingStatus } from "@/lib/enums";
import { can, channelFilter, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { type BookingNoticeResult, SlotUnavailableError, UNAVAILABLE_REASON_TEXT } from "@/server/booking";
import { parseInput, toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { ALL_RESOURCES, agendaWords, noticeText, type AgendaWords } from "./_lib/labels";
import { AGENDA_PATH } from "./_lib/search-params";
import { toSlotOptions, type SlotOption } from "./_lib/slots";

/** A booking that could not be saved: the closest free slots when it was taken, and the contact already created. */
export type BookingFailure = ActionFailure & { alternatives?: SlotOption[]; contactId?: string };
export type BookingActionResult<T = void> = ActionSuccess<T> | BookingFailure;

export type SlotsView = { slots: SlotOption[]; reason: string | null };
export type ContactOption = { id: string; name: string; detail: string | null };

const CONTACT_RESULTS = 10;

async function wordsFor(actor: Actor): Promise<{ words: AgendaWords; timezone: string }> {
  const settings = await getAgendaSettings(actor);
  return { words: agendaWords(settings.terminology), timezone: settings.timezone };
}

function bookingFailure(error: unknown, timezone: string, contactId?: string): BookingFailure {
  const extra = contactId ? { contactId } : {};
  if (error instanceof SlotUnavailableError) return { ...fail(error.userMessage), alternatives: toSlotOptions(error.alternatives, timezone), ...extra };
  return { ...toActionFailure(error), ...extra };
}

function withNotice(message: string, notice: BookingNoticeResult | null, words: AgendaWords): string {
  const told = noticeText(notice, words);
  return told ? `${message} ${told}` : message;
}

// ─── Free slots and customers for the dialog ─────────────────────────────────────────────────────────────

/** The engine's free slots of a service between two local days ([AGD-08]), or why there are none. */
export async function getSlotsAction(input: unknown): Promise<ActionResult<SlotsView>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.view);
    const { timezone, slots, reason } = await getAvailability(actor, input);
    return ok({ slots: toSlotOptions(slots, timezone), reason: reason ? UNAVAILABLE_REASON_TEXT[reason] : null });
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Customers for «Nueva cita», by name, phone or email; an agent only finds those of their channels ([PER-02]). */
export async function searchContactsAction(search: unknown): Promise<ActionResult<ContactOption[]>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.bookings);
    const text = parseInput(z.string().trim().max(100), search);
    const { items } = await listContacts(actor, text ? { search: text } : {});
    return ok(
      items.slice(0, CONTACT_RESULTS).map((item) => ({
        id: item.id,
        name: item.name?.trim() || item.phone || item.email || "Sin nombre",
        detail: item.phone ?? item.email ?? null,
      })),
    );
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────────────────────────────────

const newContactSchema = z
  .object({
    name: z.string({ error: "Escribe el nombre." }).trim().min(1, "Escribe el nombre.").max(100, "Como mucho 100 caracteres."),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().max(254).optional(),
  })
  .strict();

/** The rest of the fields go to createBookingByPerson, which validates them strictly. */
const createEnvelopeSchema = z.object({ newContact: newContactSchema.optional() }).passthrough();

/**
 * «Nueva cita» ([AGD-17]). A new customer gets a contact card when the person may create contacts that they will
 * see again (not an agent limited to some channels, [PER-02]); otherwise the booking keeps just the name.
 */
export async function createBookingAction(input: unknown): Promise<BookingActionResult<{ id: string }>> {
  let timezone: string | undefined;
  let contactId: string | undefined;
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.bookings);
    const context = await wordsFor(actor);
    timezone = context.timezone;
    const { newContact, ...booking } = parseInput(createEnvelopeSchema, input);
    const request: Record<string, unknown> = { ...booking };
    if (newContact) {
      delete request.contactId;
      if (can(actor, PERMISSIONS.contacts.edit) && channelFilter(actor) === null) {
        contactId = (await createContact(actor, { name: newContact.name, phone: newContact.phone ?? "", email: newContact.email ?? "" })).id;
        request.contactId = contactId;
      } else {
        request.contactName = newContact.name;
      }
    }
    const created = await createBookingByPerson(actor, request);
    revalidatePath(AGENDA_PATH);
    return ok({ id: created.id }, `${context.words.Booking} creada.`);
  } catch (error) {
    return bookingFailure(error, timezone ?? "UTC", contactId);
  }
}

// ─── Move, edit and status ───────────────────────────────────────────────────────────────────────────────

/** Drag and drop: a new start, resource or length; a place that is not free is refused and it stays ([AGD-17]). */
export async function moveBookingAction(input: unknown): Promise<BookingActionResult> {
  let timezone: string | undefined;
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.bookings);
    const context = await wordsFor(actor);
    timezone = context.timezone;
    const { notice } = await moveBooking(actor, input);
    revalidatePath(AGENDA_PATH);
    return ok(undefined, withNotice(`${context.words.Booking} movida.`, notice, context.words));
  } catch (error) {
    return bookingFailure(error, timezone ?? "UTC");
  }
}

const editSchema = z
  .object({
    bookingId: idSchema,
    /** Start, resource, length and people: checked again like a move. */
    schedule: z.record(z.string(), z.unknown()).optional(),
    /** Notes and customer. */
    details: z.record(z.string(), z.unknown()).optional(),
    notifyCustomer: z.boolean().optional(),
  })
  .strict();

/** «Cambiar» in the booking's card: the keyboard alternative to dragging (WCAG 2.5.7). The time goes first. */
export async function updateBookingAction(input: unknown): Promise<BookingActionResult> {
  let timezone: string | undefined;
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.bookings);
    const context = await wordsFor(actor);
    timezone = context.timezone;
    const { bookingId, schedule, details, notifyCustomer } = parseInput(editSchema, input);
    let notice: BookingNoticeResult | null = null;
    if (schedule && Object.keys(schedule).length > 0) {
      notice = (await moveBooking(actor, { ...schedule, bookingId, ...(notifyCustomer !== undefined ? { notifyCustomer } : {}) })).notice;
    }
    if (details && Object.keys(details).length > 0) await updateBooking(actor, { ...details, bookingId });
    revalidatePath(AGENDA_PATH);
    return ok(undefined, withNotice("Cambios guardados.", notice, context.words));
  } catch (error) {
    return bookingFailure(error, timezone ?? "UTC");
  }
}

const STATUS_DONE: Record<BookingStatus, (words: AgendaWords) => string> = {
  pending: (words) => `${words.Booking} marcada como pendiente.`,
  confirmed: (words) => `${words.Booking} confirmada.`,
  cancelled: (words) => `${words.Booking} cancelada.`,
  completed: (words) => `${words.Booking} marcada como completada.`,
  no_show: (words) => `${words.Booking} marcada como no presentado.`,
};

/** Confirm, cancel (with a reason), completed or no-show ([AGD-14]); optionally tells the customer ([AGD-23]). */
export async function setBookingStatusAction(input: unknown): Promise<BookingActionResult> {
  let timezone: string | undefined;
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.bookings);
    const context = await wordsFor(actor);
    timezone = context.timezone;
    const { booking, notice } = await setBookingStatus(actor, input);
    revalidatePath(AGENDA_PATH);
    return ok(undefined, withNotice(STATUS_DONE[booking.status](context.words), notice, context.words));
  } catch (error) {
    return bookingFailure(error, timezone ?? "UTC");
  }
}

// ─── Blocked slots ([AGD-18]) ────────────────────────────────────────────────────────────────────────────

const blockSchema = z
  .object({
    resourceId: z.union([z.literal(ALL_RESOURCES), idSchema], { error: "Elige un recurso o «Todos»." }),
    start: z.string().max(40),
    end: z.string().max(40),
    reason: z.string().max(200).optional(),
  })
  .strict();

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** «Bloquear hueco» for one resource or every active one; bookings already inside stay and are counted. */
export async function blockSlotAction(input: unknown): Promise<ActionResult<{ blocked: number; overlappingBookings: number }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.block);
    const { words } = await wordsFor(actor);
    const { resourceId, ...slot } = parseInput(blockSchema, input);
    const targets = resourceId === ALL_RESOURCES ? (await listResources(actor)).filter((resource) => resource.active).map((resource) => resource.id) : [resourceId];
    if (targets.length === 0) return fail("No hay recursos activos que bloquear.");
    let overlappingBookings = 0;
    for (const target of targets) {
      overlappingBookings += (await addResourceTimeOff(actor, { resourceId: target, kind: "block", ...slot })).overlappingBookings;
    }
    revalidatePath(AGENDA_PATH);
    let message = resourceId === ALL_RESOURCES ? `Hueco bloqueado para ${plural(targets.length, words.resource, words.resources)}.` : "Hueco bloqueado.";
    if (overlappingBookings > 0) {
      const many = overlappingBookings > 1;
      message += ` Dentro queda${many ? "n" : ""} ${plural(overlappingBookings, words.booking, words.bookings)}, que sigue${many ? "n" : ""} en la agenda.`;
    }
    return ok({ blocked: targets.length, overlappingBookings }, message);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeTimeOffAction(timeOffId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.block);
    await removeResourceTimeOff(actor, { timeOffId });
    revalidatePath(AGENDA_PATH);
    return ok(undefined, "Bloqueo quitado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Test bookings ([PRU-04]) ────────────────────────────────────────────────────────────────────────────

/** «Borrar citas de prueba»: every booking made from «Probar agente», at once. */
export async function deleteTestBookingsAction(): Promise<ActionResult<{ deleted: number }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.deleteTestBookings);
    const { words } = await wordsFor(actor);
    const { deleted } = await deleteTestBookings(actor);
    revalidatePath(AGENDA_PATH);
    return ok({ deleted }, `${words.Bookings} de prueba borradas: ${deleted}.`);
  } catch (error) {
    return toActionFailure(error);
  }
}
