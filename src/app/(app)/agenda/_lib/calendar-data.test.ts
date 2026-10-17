import { describe, expect, it } from "vitest";
import type { ResourceItem } from "@/data/agenda-config";
import type { BookingDetail } from "@/data/bookings";
import { busyRanges, dayColumns, drawnTimeOff, monthDays, panelBooking, placeItems, resourceColumns, visibleResources, workingResources } from "./calendar-data";
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

const booking = (id: string, resourceId: string, startLocal: string, endLocal: string, overrides: Partial<CalendarBooking> = {}): CalendarBooking => ({
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
  customerConfirmed: false,
  ...overrides,
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

});

const WORDS = { booking: "cita", bookings: "citas" };
const at = (date: string, from: string, to: string) => [`${date}T${from}:00+02:00`, `${date}T${to}:00+02:00`] as const;
const monthContext = (overrides: Partial<Parameters<typeof monthDays>[2]> = {}): Parameters<typeof monthDays>[2] => ({
  frame: FRAME,
  today: "2026-10-13",
  resources: [resource("laura", { schedule: [{ weekday: 2, start: "09:00", end: "14:00" }] }), resource("marta", { schedule: [{ weekday: 2, start: "16:00", end: "20:00" }] })],
  timeOff: [],
  mode: "individual",
  resourceIds: [],
  serviceIds: [],
  words: WORDS,
  ...overrides,
});
const dayOf = (weeks: ReturnType<typeof monthDays>, date: string) => weeks.flat().find((day) => day.date === date);

describe("Agenda: each day of the month says how many bookings and how full it is [AGD-31]", () => {
  // Tuesday 13 October: Laura works 09:00–14:00 (300 min) and Marta 16:00–20:00 (240 min), 540 minutes in all.
  it("counts the day's bookings but not the cancelled ones, and compares booked time with working time", () => {
    const weeks = monthDays(
      "2026-10-01",
      [
        booking("a", "laura", ...at("2026-10-13", "10:00", "11:00")),
        booking("b", "marta", ...at("2026-10-13", "16:00", "17:30")),
        booking("c", "marta", ...at("2026-10-13", "18:00", "19:00"), { status: "cancelled" }),
      ],
      monthContext(),
    );
    expect(dayOf(weeks, "2026-10-13")).toMatchObject({ isToday: true, count: 2, ratio: 150 / 540, closedLabel: null });
    expect(dayOf(weeks, "2026-10-13")?.previews.map((item) => item.id)).toEqual(["a", "b"]);
    expect(dayOf(weeks, "2026-10-14")).toMatchObject({ count: 0, ratio: null });
    expect(weeks.flat()[0]).toMatchObject({ date: "2026-09-28", inMonth: false });
  });

  it("absences and blocks take their time away from the working time", () => {
    const off = (id: string, kind: "absence" | "block", resourceId: string, from: string, to: string) => {
      const [startLocal, endLocal] = at("2026-10-13", from, to);
      return { id, kind, resourceId, resourceName: resourceId, startLocal, endLocal, reason: null };
    };
    const weeks = monthDays(
      "2026-10-01",
      [booking("a", "laura", ...at("2026-10-13", "10:00", "11:00"))],
      monthContext({ timeOff: [off("x", "absence", "marta", "00:00", "23:59"), off("y", "block", "laura", "13:00", "14:00")] }),
    );
    expect(dayOf(weeks, "2026-10-13")?.ratio).toBe(60 / 240);
  });

  it("with filters, only what is filtered counts, in the bookings and in the working time", () => {
    const resources = [
      resource("laura", { schedule: [{ weekday: 2, start: "09:00", end: "14:00" }], serviceIds: ["corte"] }),
      resource("marta", { schedule: [{ weekday: 2, start: "16:00", end: "20:00" }], serviceIds: ["tinte"] }),
    ];
    const bookings = [booking("a", "laura", ...at("2026-10-13", "10:00", "11:00"))];
    expect(dayOf(monthDays("2026-10-01", bookings, monthContext({ resources, resourceIds: ["laura"] })), "2026-10-13")?.ratio).toBe(60 / 300);
    expect(dayOf(monthDays("2026-10-01", bookings, monthContext({ resources, serviceIds: ["corte"] })), "2026-10-13")?.ratio).toBe(60 / 300);
  });

  it("in capacity mode compares people by duration with capacity by open hours", () => {
    const table = resource("terraza", { capacity: 10, schedule: [{ weekday: 2, start: "09:00", end: "14:00" }] });
    const weeks = monthDays("2026-10-01", [booking("a", "terraza", ...at("2026-10-13", "13:00", "14:30"), { people: 4 })], monthContext({ resources: [table], mode: "capacity" }));
    // Only the hour inside the opening hours counts: 4 people × 60 min over 10 × 300.
    expect(dayOf(weeks, "2026-10-13")?.ratio).toBe(240 / 3000);
  });

  it("a closed day or a holiday reads «Cerrado», with its bookings if it has any", () => {
    const weeks = monthDays("2026-10-01", [booking("a", "laura", ...at("2026-10-12", "10:00", "10:30")), booking("b", "laura", ...at("2026-10-18", "10:00", "10:30"))], monthContext());
    expect(dayOf(weeks, "2026-10-12")).toMatchObject({ closedLabel: "Cerrado · Fiesta nacional · 1 cita", count: 1, ratio: null });
    expect(dayOf(weeks, "2026-10-18")).toMatchObject({ closedLabel: "Cerrado · 1 cita" });
    expect(dayOf(weeks, "2026-10-11")).toMatchObject({ closedLabel: "Cerrado", count: 0 });
  });

  it("works on the days the clocks change, on the wall clock of the business", () => {
    const sundays = { hours: [{ weekday: 7, startMin: 540, endMin: 840 }], closures: [] };
    const open = (date: string, offset: string) => booking("a", "laura", `${date}T10:00:00${offset}`, `${date}T11:00:00${offset}`);
    const laura = [resource("laura", { schedule: [{ weekday: 7, start: "09:00", end: "14:00" }] })];
    expect(dayOf(monthDays("2026-10-01", [open("2026-10-25", "+01:00")], monthContext({ frame: sundays, resources: laura })), "2026-10-25")?.ratio).toBe(60 / 300);
    expect(dayOf(monthDays("2027-03-01", [open("2027-03-28", "+02:00")], monthContext({ frame: sundays, resources: laura, today: "2027-03-01" })), "2027-03-28")?.ratio).toBe(60 / 300);
  });
});

describe("Agenda: free and busy time in the day and week [AGD-29]", () => {
  // Tuesday 13 October, business open 09:00–14:00 and 16:00–20:00.
  const laura = resource("laura", { schedule: [{ weekday: 2, start: "09:00", end: "14:00" }] });
  const marta = resource("marta", { schedule: [{ weekday: 2, start: "09:00", end: "12:00" }] });
  const open = [{ startMin: 540, endMin: 840 }, { startMin: 960, endMin: 1200 }];

  it("an open stretch is free while at least one professional who works then has nothing in it", () => {
    const bookings = [booking("a", "laura", ...at("2026-10-13", "10:00", "11:00")), booking("b", "marta", ...at("2026-10-13", "10:30", "11:30"))];
    // 10:30–11:00 both are busy; from 12:00 only Laura works, and nobody works in the afternoon.
    expect(busyRanges("2026-10-13", open, [laura, marta], bookings, [], FRAME, "individual")).toEqual([
      { startMin: 630, endMin: 660 },
      { startMin: 960, endMin: 1200 },
    ]);
  });

  it("cancelled bookings free their time; absences and blocks take it", () => {
    const bookings = [booking("a", "laura", ...at("2026-10-13", "10:00", "11:00"), { status: "cancelled" })];
    const absence = { id: "x", kind: "absence" as const, resourceId: "laura", resourceName: "laura", startLocal: "2026-10-13T00:00:00+02:00", endLocal: "2026-10-14T00:00:00+02:00", reason: null };
    expect(busyRanges("2026-10-13", open, [laura], bookings, [], FRAME, "individual")).toEqual([{ startMin: 960, endMin: 1200 }]);
    expect(busyRanges("2026-10-13", open, [laura], [], [absence], FRAME, "individual")).toEqual(open);
  });

  it("counts the professionals filtered or, without a filter, every active one", () => {
    const left = resource("ana", { active: false });
    expect(workingResources([laura, marta, left], []).map((item) => item.id)).toEqual(["laura", "marta"]);
    expect(workingResources([laura, marta, left], ["marta"]).map((item) => item.id)).toEqual(["marta"]);
  });

  it("draws one professional's absence only when filtering by them or by resource; blocks always", () => {
    const absence = { id: "x", kind: "absence" as const, resourceId: "laura", resourceName: "laura", startLocal: "2026-10-13T10:00:00+02:00", endLocal: "2026-10-13T12:00:00+02:00", reason: null };
    const block = { ...absence, id: "y", kind: "block" as const };
    expect(drawnTimeOff([absence, block], false, []).map((item) => item.id)).toEqual(["y"]);
    expect(drawnTimeOff([absence, block], false, ["laura"]).map((item) => item.id)).toEqual(["x", "y"]);
    expect(drawnTimeOff([absence, block], true, []).map((item) => item.id)).toEqual(["x", "y"]);
  });

  it("in capacity mode a stretch is busy only when the people booked fill the capacity", () => {
    const table = resource("terraza", { capacity: 6, schedule: [{ weekday: 2, start: "09:00", end: "14:00" }] });
    const bookings = [booking("a", "terraza", ...at("2026-10-13", "13:00", "14:00"), { people: 4 }), booking("b", "terraza", ...at("2026-10-13", "13:30", "14:00"), { people: 2 })];
    expect(busyRanges("2026-10-13", [{ startMin: 540, endMin: 840 }], [table], bookings, [], FRAME, "capacity")).toEqual([{ startMin: 810, endMin: 840 }]);
  });
});

describe("Agenda: the reminders on the booking's card [AGD-25] [AGD-33]", () => {
  const words = agendaWords({ booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" });
  const context = { timezone: "Europe/Madrid", words, resourceNames: new Map<string, string>(), contactHref: null, conversationHref: null };
  const sentAt = new Date("2026-09-28T08:00:00Z");
  const detail = (reminders: BookingDetail["reminders"], overrides: Partial<BookingDetail> = {}): BookingDetail => ({
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
    reminderSentAt: null,
    customerConfirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date("2026-09-20T08:00:00Z"),
    history: [],
    reminders,
    canNotify: false,
    ...overrides,
  });

  it("each reminder of its time: by what channel it went, or that it did not and why", () => {
    const card = panelBooking(
      detail([
        { lead: "1 día antes, a las 10:00", status: "sent", channel: "whatsapp", reason: null, at: sentAt },
        { lead: "2 horas antes", status: "not_sent", channel: null, reason: "Sin permiso de avisos y sin email", at: sentAt },
      ]),
      context,
    );
    expect(card.reminderLines).toEqual(["1 día antes, a las 10:00: enviado por WhatsApp el 28 sep 2026, 10:00", "2 horas antes: no enviado (Sin permiso de avisos y sin email)"]);
  });

  it("a booking reminded before phase 12 says when; «Confirmada por el cliente» reaches the card", () => {
    expect(panelBooking(detail([], { reminderSentAt: sentAt }), context).reminderLines).toEqual(["Enviado el 28 sep 2026, 10:00"]);
    expect(panelBooking(detail([], { customerConfirmedAt: sentAt }), context).customerConfirmed).toBe(true);
  });
});
