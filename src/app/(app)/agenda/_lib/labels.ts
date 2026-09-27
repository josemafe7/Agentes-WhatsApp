// Words of the Agenda screen ([AGD-01]): the business chooses Cita or Reserva; Profesional, Mesa, Sala or Box;
// Cliente, Paciente or Comensal, and the screen uses them everywhere. Also the names of statuses and origins, and what
// the person reads after a customer notice ([AGD-23]). Pure: used by server and client components.
import type { BookingNoticeResult } from "@/server/booking";
import { BOOKING_STATUS_DISPLAY } from "@/lib/booking-display";
import type { BookingSource, BookingStatus } from "@/lib/enums";

type Terminology = { booking: string; bookings: string; resource: string; resources: string; customer: string };

export type AgendaWords = Terminology & {
  Booking: string;
  Bookings: string;
  Resource: string;
  Resources: string;
  Customer: string;
  /** «Nueva cita», «Nueva reserva» (both words are feminine). */
  newBooking: string;
  /** «Todos los profesionales», «Todas las mesas». */
  allResources: string;
  /** «Cualquier profesional», «Cualquier mesa». */
  anyResource: string;
};

/** Resource words that are feminine in Spanish; the rest (profesional, box) take the masculine. */
const FEMININE_RESOURCES = new Set(["mesa", "sala"]);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function agendaWords(terminology: Terminology): AgendaWords {
  const feminine = FEMININE_RESOURCES.has(terminology.resource);
  return {
    ...terminology,
    Booking: capitalize(terminology.booking),
    Bookings: capitalize(terminology.bookings),
    Resource: capitalize(terminology.resource),
    Resources: capitalize(terminology.resources),
    Customer: capitalize(terminology.customer),
    newBooking: `Nueva ${terminology.booking}`,
    allResources: `${feminine ? "Todas las" : "Todos los"} ${terminology.resources}`,
    anyResource: `Cualquier ${terminology.resource}`,
  };
}

/** «Bloquear hueco» for every active resource at once. */
export const ALL_RESOURCES = "all";

/** DESIGN.md «Estados de cita» (src/lib/booking-display.ts). */
export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: BOOKING_STATUS_DISPLAY.pending.label,
  confirmed: BOOKING_STATUS_DISPLAY.confirmed.label,
  cancelled: BOOKING_STATUS_DISPLAY.cancelled.label,
  completed: BOOKING_STATUS_DISPLAY.completed.label,
  no_show: BOOKING_STATUS_DISPLAY.no_show.label,
};

/** Origin of a booking ([AGD-14]): the AI (with its channel), a person or the web. */
export const SOURCE_LABELS: Record<BookingSource, string> = { ai: "IA", human: "Persona", web: "Web" };

type NoticeFailure = Extract<BookingNoticeResult, { sent: false }>["reason"];

const NOTICE_FAILURES: Record<Exclude<NoticeFailure, "test">, (words: AgendaWords) => string> = {
  no_conversation: (words) => `esta ${words.booking} no tiene conversación`,
  channel_disabled: () => "su canal está desactivado",
  opted_out: () => "se ha dado de baja de este canal",
  window_closed: () => "la ventana de 24 h de WhatsApp está cerrada",
  failed: () => "no se ha podido enviar el mensaje",
};

/** After «Avisar al cliente»: whether the notice went out and, if not, why. Null when nobody was to be told. */
export function noticeText(notice: BookingNoticeResult | null, words: AgendaWords): string | null {
  if (!notice) return null;
  if (notice.sent) return `Hemos avisado al ${words.customer} por su conversación.`;
  if (notice.reason === "test") return null;
  return `No hemos podido avisar al ${words.customer}: ${NOTICE_FAILURES[notice.reason](words)}.`;
}

/** «4 pers.» (DESIGN.md «Agenda»: people of each booking in the capacity view). */
export function peopleLabel(people: number): string {
  return `${people} pers.`;
}
