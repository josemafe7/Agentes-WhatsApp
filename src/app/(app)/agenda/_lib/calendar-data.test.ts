import { describe, expect, it } from "vitest";
import type { ResourceItem } from "@/data/agenda-config";
import type { BookingDetail } from "@/data/bookings";
import { dayColumns, monthDays, panelBooking, placeItems, resourceColumns, visibleResources } from "./calendar-data";
import { agendaWords } from "./labels";
import type { CalendarBooking } from "./types";

const FRAME = {
  hours: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, startMin: 540, endMin: 840 },
    { weekday, startMin: 960, endMin: 1200 },
  ]),
  closures: [{ startDate: "2026-10-12", endDate: "2026-10-12", reason: "Fiesta nacional" }],
};

const resource = (id: string, overrides: Partial<ResourceItem> = {}): ResourceItem => ({
  id,
  type: "person",
  name: id,
  color: "blue",
  capacity: 1,
  active: true,
  sortOrder: 0,
  schedule: [{ weekday: 1, start: "10:00", end: "18:00" }],
  serviceIds: [],
  ...overrides,
});

const booking = (id: string, resourceId: string, startLocal: string, endLocal: string): CalendarBooking => ({
  id,
  status: "confirmed",
  source: "human",
  isTest: false,
  startLocal,
  endLocal,
  durationMin: 30,
  people: 1,
  serviceName: "Corte",
  resourceId,
  resourceName: resourceId,
  resourceColor: "blue",
  contactName: "Rosa",
  channel: null,
});

describe("Agenda: the columns of each view [AGD-16] [AGD-05]", () => {
  it("the week has a column per day with its opening hours; Sundays and holidays read «Cerrado»", () => {
    const columns = dayColumns({ from: "2026-10-12", to: "2026-10-18" }, FRAME, "2026-10-13");
    expect(columns.map((column) => column.title)).toEqual(["lun 12", "mar 13", "mié 14", "jue 15", "vie 16", "sáb 17", "dom 18"]);
    expect(columns[0]).toMatchObject({ closedLabel: "Cerrado · Fiesta nacional", open: [] });
    expect(columns[1]).toMatchObject({ isToday: true, closedLabel: null, open: [{ startMin: 540, endMin: 840 }, { startMin: 960, endMin: 1200 }] });
    expect(columns[6].closedLabel).toBe("Cerrado");
  });

  it("the resources view has a column per resource, open only where the business and the resource both are", () => {
    const [laura, table] = resourceColumns("2026-09-28", [resource("laura"), resource("mesa", { capacity: 8, schedule: [] })], FRAME, "2026-09-28", "capacity");
    expect(laura).toMatchObject({ resourceId: "laura", subtitle: "Aforo 1", capacity: 1, open: [{ startMin: 600, endMin: 840 }, { startMin: 960, endMin: 1080 }], closedLabel: null });
    expect(table).toMatchObject({ subtitle: "Aforo 8", open: [], closedLabel: "No trabaja este día" });
  });

  it("an inactive resource shows only while it still has bookings [AGD-03]; a filter shows just the chosen ones", () => {
    const resources = [resource("laura"), resource("antigua", { active: false }), resource("vieja", { active: false })];
    const bookings = [booking("b1", "antigua", "2026-09-28T10:00:00+02:00", "2026-09-28T10:30:00+02:00")];
    expect(visibleResources(resources, [], bookings).map((item) => item.id)).toEqual(["laura", "antigua"]);
    expect(visibleResources(resources, ["vieja"], bookings).map((item) => item.id)).toEqual(["vieja"]);
  });
});

describe("Agenda: where each booking is drawn [AGD-16] [AGD-28]", () => {
  it("a booking goes to its day, or to its resource's column; a night booking shows on both days", () => {
    const days = dayColumns({ from: "2026-09-28", to: "2026-09-29" }, FRAME, "2026-09-28");
    const night = booking("n", "laura", "2026-09-28T23:30:00+02:00", "2026-09-29T00:30:00+02:00");
    expect(placeItems(days, [night])).toEqual([
      { key: "n:2026-09-28", columnKey: "2026-09-28", id: "n", startMin: 1410, endMin: 1440, startsHere: true, endsHere: false },
      { key: "n:2026-09-29", columnKey: "2026-09-29", id: "n", startMin: 0, endMin: 30, startsHere: false, endsHere: true },
    ]);
    const byResource = resourceColumns("2026-09-28", [resource("laura"), resource("marta")], FRAME, "2026-09-28", "individual");
    const morning = booking("m", "marta", "2026-09-28T10:00:00+02:00", "2026-09-28T10:30:00+02:00");
    expect(placeItems(byResource, [morning]).map((placement) => placement.columnKey)).toEqual(["marta"]);
  });

  it("the month lists each day's bookings and marks closed days", () => {
    const weeks = monthDays("2026-10-01", [booking("a", "laura", "2026-10-13T10:00:00+02:00", "2026-10-13T10:30:00+02:00")], FRAME, "2026-10-13");
    const days = weeks.flat();
    expect(days.find((day) => day.date === "2026-10-13")).toMatchObject({ isToday: true, bookings: [{ id: "a" }] });
    expect(days.find((day) => day.date === "2026-10-12")?.closedLabel).toBe("Cerrado · Fiesta nacional");
    expect(days[0]).toMatchObject({ date: "2026-09-28", inMonth: false });
  });
});

describe("Agenda: the reminder on the booking's card [AGD-25]", () => {
  const words = agendaWords({ booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" });
  const context = { timezone: "Europe/Madrid", words, resourceNames: new Map<string, string>(), contactHref: null, conversationHref: null };
  const sentAt = new Date("2026-09-28T08:00:00Z");
  const detail = (history: BookingDetail["history"]): BookingDetail => ({
    id: "b1",
    status: "confirmed",
    source: "human",
    startsAt: new Date("2026-09-29T08:00:00Z"),
    endsAt: new Date("2026-09-29T08:30:00Z"),
    startLocal: "2026-09-29T10:00:00+02:00",
    endLocal: "2026-09-29T10:30:00+02:00",
    people: 1,
    isTest: false,
    notes: null,
    service: { id: "s1", name: "Corte" },
    resource: { id: "r1", name: "Lucía", color: "blue" },
    contactId: "c1",
    contactName: "Laura",
    channel: null,
    conversationId: null,
    createdByUserId: null,
    createdByName: null,
    reminderSentAt: sentAt,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date("2026-09-20T08:00:00Z"),
    history,
  });
  const event = (action: string, changes: Record<string, unknown>) => ({ id: action, action, actorType: "system" as const, actorName: null, changes, createdAt: sentAt });

  it("says when it went out, or that it could not go out and why (it is never retried)", () => {
    expect(panelBooking(detail([event("reminder_sent", { channel: "email" })]), context).reminderText).toBe("Enviado el 28 sep 2026, 10:00");
    expect(panelBooking(detail([event("reminder_failed", { channel: "email", reason: "El cliente no tiene email." })]), context).reminderText).toBe(
      "No se ha podido enviar (28 sep 2026, 10:00): El cliente no tiene email.",
    );
  });
});
