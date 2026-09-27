// How bookings read in Spanish for customers, the agent and notices ([AGD-01], [AGD-28]): always in the business
// time zone and with the business's own word for a booking.
import "server-only";
import type { Terminology } from "@/db/schema";
import { formatDateTime } from "@/lib/format";

/** «martes 29 de septiembre». */
export function bookingDayText(instant: Date, timeZone: string): string {
  return formatDateTime(instant, timeZone, { pattern: "EEEE d 'de' MMMM" });
}

/** «10:00». */
export function bookingTimeText(instant: Date, timeZone: string): string {
  return formatDateTime(instant, timeZone, { pattern: "HH:mm" });
}

/** «cita» or «reserva» ([AGD-01]); both are feminine, so the sentences around them fit either. */
export function bookingWord(terminology: Terminology | null | undefined): string {
  return terminology?.booking?.trim() || "cita";
}

export const BOOKING_STATUS_LABELS = {
  pending: "pendiente",
  confirmed: "confirmada",
  cancelled: "cancelada",
  completed: "completada",
  no_show: "no presentado",
} as const;
