"use server";
// «Nueva cita» from the contact's card and from a conversation ([CTO-02], [AGD-17], [AGD-19]). Thin: session and the
// area permission here, the input validated with Zod, then src/data, which checks the permission again, that an
// Agent only books for contacts and conversations of their channels ([PER-02]) and the same availability rules as
// the AI; a slot taken meanwhile comes back with its closest alternatives ([AGD-13]). Solo lectura never books
// ([PER-03]).
import { refresh } from "next/cache";
import { z } from "zod";
import { getAgendaSettings, listResources, listServices } from "@/data/agenda-config";
import { createBookingByPerson, createBookingInputSchema, getAvailability, localDateSchema } from "@/data/bookings";
import { fromZodError, ok, type ActionFailure, type ActionResult, type ActionSuccess } from "@/lib/action-result";
import type { BookingStatus, ResourceColor } from "@/lib/enums";
import { can, PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { addDays, ANY_RESOURCE, instantToLocal, SlotUnavailableError, UNAVAILABLE_REASON_TEXT } from "@/server/booking";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { bookingWords, type BookingWords } from "./presentation";
import { daySlots, slotChoice, type NextFreeDay, type SlotChoice } from "./slot-options";

/** Days looked at to point to the next day with free slots when the chosen one is full. */
const SEARCH_DAYS = 14;

export type ServiceOption = {
  id: string;
  name: string;
  category: string | null;
  durationMin: number;
  minPeople: number;
  maxPeople: number;
  requiresManualConfirmation: boolean;
  /** Active resources that do it ([AGD-03]). */
  resourceIds: string[];
};
export type ResourceOption = { id: string; name: string; color: ResourceColor };
export type NewBookingForm = {
  /** Today in the business's time zone ([AGD-28]). */
  today: string;
  words: BookingWords;
  services: ServiceOption[];
  resources: ResourceOption[];
  /** Owner and admin get a link to configure the agenda when it is empty. */
  canConfigure: boolean;
};

/** The active services and resources, in the business's words, read when the dialog opens. */
export async function loadNewBookingFormAction(): Promise<ActionResult<NewBookingForm>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.view);
    const [settings, services, resources] = await Promise.all([getAgendaSettings(actor), listServices(actor, { activeOnly: true }), listResources(actor)]);
    const active = resources.filter((resource) => resource.active);
    const activeIds = new Set(active.map((resource) => resource.id));
    return ok({
      today: instantToLocal(new Date(), settings.timezone).date,
      words: bookingWords(settings.terminology),
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        durationMin: service.durationMin,
        minPeople: service.minPeople,
        maxPeople: service.maxPeople,
        requiresManualConfirmation: service.requiresManualConfirmation,
        resourceIds: service.resourceIds.filter((id) => activeIds.has(id)),
      })),
      resources: active.map(({ id, name, color }) => ({ id, name, color })),
      canConfigure: can(actor, PERMISSIONS.agenda.configure),
    });
  } catch (error) {
    return toActionFailure(error);
  }
}

const findSlotsSchema = z
  .object({
    serviceId: idSchema,
    resourceId: z.union([z.literal(ANY_RESOURCE), idSchema], { error: "Elige un recurso o «Cualquiera»." }),
    date: localDateSchema,
    people: z.number({ error: "Escribe cuántas personas." }).int().min(1).max(500).optional(),
  })
  .strict();

export type FreeSlots = {
  slots: SlotChoice[];
  /** First later day with free slots, to jump to it when the chosen one is full. */
  next: NextFreeDay | null;
  /** Why the request can never fit (group size, inactive service…), in Spanish. */
  reason: string | null;
};

/** Free slots of one day, computed like the AI does ([AGD-08], [AGD-09], [AGD-17]). */
export async function findFreeSlotsAction(input: unknown): Promise<ActionResult<FreeSlots>> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.view);
    const parsed = findSlotsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { date, ...request } = parsed.data;
    const availability = await getAvailability(actor, { ...request, from: date, to: addDays(date, SEARCH_DAYS - 1) });
    if (availability.reason) return ok({ slots: [], next: null, reason: UNAVAILABLE_REASON_TEXT[availability.reason] });
    return ok({ ...daySlots(availability.slots, date, availability.timezone), reason: null });
  } catch (error) {
    return toActionFailure(error);
  }
}

const newBookingSchema = createBookingInputSchema
  .pick({ serviceId: true, resourceId: true, start: true, people: true, notes: true, contactId: true, conversationId: true })
  .strict()
  .refine((value) => Boolean(value.contactId) !== Boolean(value.conversationId), { path: ["contactId"], message: "Falta el contacto de la cita." });

export type CreatedBooking = { id: string; status: BookingStatus };
/** A slot taken meanwhile also brings the closest free ones ([AGD-13]). */
export type CreateBookingResult = ActionSuccess<CreatedBooking> | (ActionFailure & { alternatives?: SlotChoice[] });

/** Creates the booking for the contact, or for the conversation's contact linking the conversation and its channel. */
export async function createContactBookingAction(input: unknown): Promise<CreateBookingResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.agenda.bookings);
    const parsed = newBookingSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const settings = await getAgendaSettings(actor);
    try {
      const booking = await createBookingByPerson(actor, parsed.data);
      refresh();
      const created = `${bookingWords(settings.terminology).created}.`;
      return ok({ id: booking.id, status: booking.status }, booking.status === "pending" ? `${created} Queda pendiente de confirmar.` : created);
    } catch (error) {
      if (!(error instanceof SlotUnavailableError)) throw error;
      return { ok: false, error: error.userMessage, alternatives: error.alternatives.map((slot) => slotChoice(slot.start, settings.timezone)) };
    }
  } catch (error) {
    return toActionFailure(error);
  }
}
