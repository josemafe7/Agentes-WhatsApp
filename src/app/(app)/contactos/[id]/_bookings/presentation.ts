// How a contact's bookings read on their card and next to the conversation ([CTO-02], [AGD-14]): the states and
// origins of DESIGN.md («Estados de cita»), the resource colours and the business's own words ([AGD-01]). Pure: used
// by server components and by the «Nueva cita» dialog.
import type { LucideIcon } from "lucide-react";
import type { Terminology } from "@/db/schema";
import { BOOKING_SOURCE_ICONS, BOOKING_STATUS_DISPLAY } from "@/lib/booking-display";
import type { BookingSource, BookingStatus } from "@/lib/enums";

type StateView = { label: string; icon: LucideIcon; className: string };

/** The same states as the agenda (src/lib/booking-display.ts). */
export const BOOKING_STATUS_VIEW: Record<BookingStatus, StateView> = BOOKING_STATUS_DISPLAY;

/** Origin of a booking: the AI (with its channel), a person or the web ([AGD-14]). */
export const BOOKING_SOURCE_VIEW: Record<BookingSource, StateView> = {
  ai: { label: "Creada por la IA", ...BOOKING_SOURCE_ICONS.ai },
  human: { label: "Creada por una persona", ...BOOKING_SOURCE_ICONS.human },
  web: { label: "Creada desde la web", ...BOOKING_SOURCE_ICONS.web },
};

/** Statuses that still hold the slot ([AGD-09]). */
const HOLDING: ReadonlySet<BookingStatus> = new Set(["pending", "confirmed"]);

type Timed = { status: BookingStatus; startsAt: Date; endsAt: Date };

/**
 * «Próximas»: pending or confirmed bookings that have not ended yet, soonest first. Everything else (past, cancelled,
 * completed or no-show) goes to «Pasadas y canceladas», newest first.
 */
export function splitBookings<T extends Timed>(bookings: readonly T[], now: Date): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const booking of bookings) {
    if (HOLDING.has(booking.status) && booking.endsAt.getTime() > now.getTime()) upcoming.push(booking);
    else past.push(booking);
  }
  upcoming.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  past.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  return { upcoming, past };
}

export type BookingWords = { title: string; newBooking: string; create: string; created: string; resource: string; none: string };

const capitalize = (word: string) => word.charAt(0).toLocaleUpperCase("es-ES") + word.slice(1);

/** «Citas» / «Nueva cita» or «Reservas» / «Nueva reserva»… Both words are feminine, so the sentences fit either. */
export function bookingWords(terminology: Terminology): BookingWords {
  const booking = terminology.booking?.trim() || "cita";
  const bookings = terminology.bookings?.trim() || "citas";
  const resource = terminology.resource?.trim() || "profesional";
  return {
    title: capitalize(bookings),
    newBooking: `Nueva ${booking}`,
    create: `Crear ${booking}`,
    created: `${capitalize(booking)} creada`,
    resource: capitalize(resource),
    none: `Todavía no tiene ${bookings}.`,
  };
}

/** The booking's card in the agenda (docs/pantallas.md «Ficha de la cita»), which links back to the contact. */
export const agendaBookingHref = (bookingId: string) => `/agenda?cita=${encodeURIComponent(bookingId)}`;
