// How a contact's bookings read on their card and next to the conversation ([CTO-02], [AGD-01], [AGD-14]).
import { describe, expect, it } from "vitest";
import type { BookingStatus } from "@/lib/enums";
import { agendaBookingHref, BOOKING_STATUS_VIEW, bookingWords, splitBookings } from "./presentation";

const NOW = new Date("2026-09-28T09:00:00Z");
const hours = (value: number) => new Date(NOW.getTime() + value * 3_600_000);
const booking = (id: string, status: BookingStatus, startHours: number, lengthHours = 0.5) => ({ id, status, startsAt: hours(startHours), endsAt: hours(startHours + lengthHours) });

describe("upcoming and past bookings of a contact [CTO-02]", () => {
  it("upcoming: pending or confirmed that have not ended, soonest first; the rest newest first", () => {
    const later = booking("later", "confirmed", 48);
    const soon = booking("soon", "pending", 2);
    const ongoing = booking("ongoing", "confirmed", -0.25);
    const futureCancelled = booking("future-cancelled", "cancelled", 24);
    const done = booking("done", "completed", -24);
    const missed = booking("missed", "no_show", -72);
    const finishedConfirmed = booking("finished", "confirmed", -3);
    const { upcoming, past } = splitBookings([done, later, missed, soon, futureCancelled, ongoing, finishedConfirmed], NOW);
    expect(upcoming.map((item) => item.id)).toEqual(["ongoing", "soon", "later"]);
    expect(past.map((item) => item.id)).toEqual(["future-cancelled", "finished", "done", "missed"]);
  });

  it("nothing to show gives two empty lists", () => {
    expect(splitBookings([], NOW)).toEqual({ upcoming: [], past: [] });
  });
});

describe("the business's words [AGD-01]", () => {
  it("defaults to «cita» and follows «reserva» and the resource word", () => {
    expect(bookingWords({})).toEqual({ title: "Citas", newBooking: "Nueva cita", create: "Crear cita", created: "Cita creada", resource: "Profesional", none: "Todavía no tiene citas." });
    expect(bookingWords({ booking: "reserva", bookings: "reservas", resource: "sala", resources: "salas", customer: "comensal" })).toEqual({
      title: "Reservas",
      newBooking: "Nueva reserva",
      create: "Crear reserva",
      created: "Reserva creada",
      resource: "Sala",
      none: "Todavía no tiene reservas.",
    });
  });
});

describe("booking states of DESIGN.md [AGD-14]", () => {
  it("every state has its own text", () => {
    expect(Object.fromEntries(Object.entries(BOOKING_STATUS_VIEW).map(([status, view]) => [status, view.label]))).toEqual({
      pending: "Pendiente",
      confirmed: "Confirmada",
      cancelled: "Cancelada",
      completed: "Completada",
      no_show: "No presentado",
    });
  });

  it("each booking opens its card in the agenda [AGD-19]", () => {
    expect(agendaBookingHref("3f1c6d2e-0000-4000-8000-000000000001")).toBe("/agenda?cita=3f1c6d2e-0000-4000-8000-000000000001");
  });
});
