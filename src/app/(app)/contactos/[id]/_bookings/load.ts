// What «Citas» of a contact needs ([CTO-02]), read through src/data with the person's permissions ([SEG-04]): their
// bookings split into upcoming and past, the business's words and time zone, and whether «Nueva cita» is shown. An
// Agent only reaches contacts of their channels ([PER-02]): anything they may not see reads as nothing.
import "server-only";
import { getAgendaSettings } from "@/data/agenda-config";
import { listContactBookings, type BookingView } from "@/data/bookings";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { AuthError } from "@/server/errors";
import { bookingWords, splitBookings, type BookingWords } from "./presentation";

export type ContactBookings = {
  timezone: string;
  words: BookingWords;
  upcoming: BookingView[];
  past: BookingView[];
  /** «Agenda: crear, editar, mover y cancelar citas» ([PER-01]); Solo lectura only looks. */
  canBook: boolean;
};

export async function loadContactBookings(actor: Actor, contactId: string, now: Date = new Date()): Promise<ContactBookings | null> {
  if (!can(actor, PERMISSIONS.agenda.view) || !can(actor, PERMISSIONS.contacts.view)) return null;
  let bookings: BookingView[];
  try {
    bookings = await listContactBookings(actor, contactId);
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
  const settings = await getAgendaSettings(actor);
  return {
    timezone: settings.timezone,
    words: bookingWords(settings.terminology),
    ...splitBookings(bookings, now),
    canBook: can(actor, PERMISSIONS.agenda.bookings),
  };
}
