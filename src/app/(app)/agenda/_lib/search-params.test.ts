import { describe, expect, it } from "vitest";
import { agendaHref, bookingFilters, hasActiveFilters, matchesViewFilters, parseAgendaQuery, type AgendaQuery } from "./search-params";

const LAURA = "0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d";
const MARTA = "0b6f2c3e-2222-4c1c-9a55-6a4f0f0b3a2d";
const CUT = "0b6f2c3e-3333-4c1c-9a55-6a4f0f0b3a2d";
const BOOKING = "0b6f2c3e-4444-4c1c-9a55-6a4f0f0b3a2d";

const base: AgendaQuery = parseAgendaQuery({});

describe("Agenda: view, day and filters in the URL [AGD-16]", () => {
  it("defaults to the week of today without filters", () => {
    expect(base).toEqual({
      view: "semana",
      date: undefined,
      resourceIds: [],
      serviceIds: [],
      statuses: [],
      sources: [],
      tests: "incluir",
      showCancelled: false,
      bookingId: undefined,
      newBooking: undefined,
    });
    expect(hasActiveFilters(base)).toBe(false);
  });

  it("reads the Spanish parameters: view, day, resources, services, status, origin, test bookings and cancelled", () => {
    const query = parseAgendaQuery({
      vista: "recursos",
      fecha: "2026-09-28",
      recurso: [LAURA, MARTA],
      servicio: CUT,
      estado: ["pendiente", "no-presentado"],
      origen: ["ia", "web"],
      pruebas: "solo",
      canceladas: "1",
      cita: BOOKING,
    });
    expect(query).toEqual({
      view: "recursos",
      date: "2026-09-28",
      resourceIds: [LAURA, MARTA],
      serviceIds: [CUT],
      statuses: ["pending", "no_show"],
      sources: ["ai", "web"],
      tests: "solo",
      showCancelled: true,
      bookingId: BOOKING,
      newBooking: undefined,
    });
    expect(hasActiveFilters(query)).toBe(true);
  });

  it("ignores unknown views, statuses, origins and test choices; ids pass through for the data layer to validate", () => {
    const query = parseAgendaQuery({ vista: "año", estado: ["pendiente", "rara"], origen: "robot", pruebas: "quizá", recurso: "no-es-un-id" });
    expect(query.view).toBe("semana");
    expect(query.statuses).toEqual(["pending"]);
    expect(query.sources).toEqual([]);
    expect(query.tests).toBe("incluir");
    expect(query.resourceIds).toEqual(["no-es-un-id"]);
  });

  it("opens «Nueva cita» for a contact or a conversation", () => {
    expect(parseAgendaQuery({ nueva: "1", contacto: LAURA }).newBooking).toEqual({ contactId: LAURA });
    expect(parseAgendaQuery({ nueva: "1", conversacion: MARTA }).newBooking).toEqual({ conversationId: MARTA });
    expect(parseAgendaQuery({ nueva: "1" }).newBooking).toEqual({});
    expect(parseAgendaQuery({ contacto: LAURA }).newBooking).toBeUndefined();
  });

  it("builds links that keep the view and filters, leaving out the defaults", () => {
    expect(agendaHref(base)).toBe("/agenda");
    expect(agendaHref(base, { view: "dia", date: "2026-09-28" })).toBe("/agenda?vista=dia&fecha=2026-09-28");
    const query = parseAgendaQuery({ vista: "mes", fecha: "2026-09-01", recurso: [LAURA, MARTA], estado: "confirmada", origen: "persona", pruebas: "sin", canceladas: "1" });
    expect(agendaHref(query)).toBe(
      `/agenda?vista=mes&fecha=2026-09-01&recurso=${LAURA}&recurso=${MARTA}&estado=confirmada&origen=persona&pruebas=sin&canceladas=1`,
    );
    expect(agendaHref(query, { bookingId: BOOKING })).toContain(`&cita=${BOOKING}`);
  });

  it("turns the filters into the calendar request of the data layer", () => {
    const query = parseAgendaQuery({ recurso: LAURA, servicio: CUT, estado: "pendiente", pruebas: "sin", canceladas: "1" });
    expect(bookingFilters(query, { from: "2026-09-28", to: "2026-10-04" })).toEqual({
      from: "2026-09-28",
      to: "2026-10-04",
      resourceIds: [LAURA],
      serviceIds: [CUT],
      statuses: ["pending"],
      includeCancelled: true,
      includeTest: false,
    });
    expect(bookingFilters(base, { from: "2026-09-28", to: "2026-09-28" })).toEqual({ from: "2026-09-28", to: "2026-09-28", includeCancelled: false, includeTest: true });
  });

  it("filters by origin and «solo pruebas» on what the data layer returns [PRU-04]", () => {
    const ai = { source: "ai" as const, isTest: false };
    const test = { source: "ai" as const, isTest: true };
    const person = { source: "human" as const, isTest: false };
    expect([ai, test, person].filter((item) => matchesViewFilters(item, base))).toHaveLength(3);
    expect([ai, test, person].filter((item) => matchesViewFilters(item, parseAgendaQuery({ origen: "persona" })))).toEqual([person]);
    expect([ai, test, person].filter((item) => matchesViewFilters(item, parseAgendaQuery({ pruebas: "solo" })))).toEqual([test]);
  });
});
