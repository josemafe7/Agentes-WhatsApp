import { describe, expect, it } from "vitest";
import {
  type AvailabilityBooking,
  type AvailabilityInput,
  type AvailabilityResource,
  type AvailabilityService,
  bookingTimes,
  closestSlots,
  computeAvailability,
  freeResourcesForStart,
  pickSuggestions,
  type WeeklyRange,
} from "./availability";
import { formatLocalMinute, parseLocalDateTime } from "./time";

const TZ = "Europe/Madrid";
const MIN = 60_000;

/** Business-local "YYYY-MM-DDTHH:mm" (or with an offset) → instant. */
const at = (local: string): Date => {
  const instant = parseLocalDateTime(local, TZ);
  if (!instant) throw new Error(`bad time ${local}`);
  return instant;
};
const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** The same ranges every weekday listed. */
const week = (days: number[], ...ranges: [string, string][]): WeeklyRange[] =>
  days.flatMap((weekday) => ranges.map(([start, end]) => ({ weekday, startMin: hm(start), endMin: end === "24:00" ? 1_440 : hm(end) })));
const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

const service = (overrides: Partial<AvailabilityService> = {}): AvailabilityService => ({
  id: "corte",
  durationMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minPeople: 1,
  maxPeople: 1,
  minAdvanceMin: 0,
  maxAdvanceDays: null,
  active: true,
  resourceIds: ["laura", "marta"],
  ...overrides,
});

const resource = (id: string, overrides: Partial<AvailabilityResource> = {}): AvailabilityResource => ({
  id,
  capacity: 1,
  active: true,
  schedule: week(WEEKDAYS, ["09:00", "14:00"], ["16:00", "20:00"]),
  timeOff: [],
  ...overrides,
});

let bookingNumber = 0;
const booking = (resourceId: string, start: string, minutes: number, overrides: Partial<AvailabilityBooking> = {}): AvailabilityBooking => ({
  id: `b${++bookingNumber}`,
  resourceId,
  blockedStartAt: at(start),
  blockedEndAt: new Date(at(start).getTime() + minutes * MIN),
  people: 1,
  status: "confirmed",
  ...overrides,
});

/** Monday 2026-09-28, with «now» the Sunday before. */
const input = (overrides: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  service: service(),
  resources: [resource("laura"), resource("marta")],
  bookings: [],
  businessHours: week([...WEEKDAYS, 6], ["09:00", "14:00"], ["16:00", "20:00"]),
  closures: [],
  timezone: TZ,
  mode: "individual",
  from: at("2026-09-28"),
  to: at("2026-09-29"),
  resourceId: "any",
  people: 1,
  stepMinutes: 30,
  now: at("2026-09-27T10:00"),
  ...overrides,
});

const starts = (result: ReturnType<typeof computeAvailability>) => result.slots.map((slot) => formatLocalMinute(slot.start, TZ).slice(11));
const startsOn = (overrides: Partial<AvailabilityInput>) => starts(computeAvailability(input(overrides)));
const range = (first: string, last: string, step = 30) => {
  const times: string[] = [];
  for (let m = hm(first); m <= hm(last); m += step) times.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return times;
};

describe("free slots of a day, individual mode [AGD-08] [AGD-06]", () => {
  it("offers every step inside the opening ranges where the whole service fits", () => {
    const result = computeAvailability(input());
    expect(starts(result)).toEqual([...range("09:00", "13:30"), ...range("16:00", "19:30")]);
    expect(result.reason).toBeNull();
    expect(result.slots[0]).toMatchObject({
      startLocal: "2026-09-28T09:00:00+02:00",
      endLocal: "2026-09-28T09:30:00+02:00",
      resourceIds: ["laura", "marta"],
      remaining: 2,
    });
    expect(result.slots[0].end.getTime() - result.slots[0].start.getTime()).toBe(30 * MIN);
  });

  it("the step is configurable, and a service longer than the step only starts where it still fits", () => {
    expect(startsOn({ stepMinutes: 15, service: service({ durationMin: 45 }), businessHours: week(WEEKDAYS, ["09:00", "11:00"]) })).toEqual(range("09:00", "10:15", 15));
    expect(startsOn({ stepMinutes: 60, service: service({ durationMin: 90 }) })).toEqual(["09:00", "10:00", "11:00", "12:00", "16:00", "17:00", "18:00"]);
  });

  it("slots start on the grid from midnight: an opening at 09:10 offers 09:15 first", () => {
    expect(startsOn({ stepMinutes: 15, businessHours: week(WEEKDAYS, ["09:10", "10:00"]) })).toEqual(["09:15", "09:30"]);
  });

  it("returns nothing for a range with no opening day and respects from/to inside a day", () => {
    expect(startsOn({ from: at("2026-10-04"), to: at("2026-10-05") })).toEqual([]);
    expect(startsOn({ from: at("2026-09-28T12:00"), to: at("2026-09-28T17:00") })).toEqual([...range("12:00", "13:30"), ...range("16:00", "16:30")]);
  });

  it("stops at the limit", () => {
    expect(startsOn({ limit: 3 })).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("a range longer than two months is refused", () => {
    expect(() => computeAvailability(input({ to: at("2026-12-31") }))).toThrow(RangeError);
    expect(() => computeAvailability(input({ stepMinutes: 0 }))).toThrow(RangeError);
  });
});

describe("business hours and holidays limit everything [AGD-05] [AJU-03]", () => {
  it("a resource that works longer than the business only gets the business hours", () => {
    const long = resource("laura", { schedule: week(EVERY_DAY, ["07:00", "22:00"]) });
    expect(startsOn({ resources: [long], businessHours: week(WEEKDAYS, ["10:00", "12:00"]) })).toEqual(range("10:00", "11:30"));
  });

  it("a resource that works less than the business only gets its own schedule", () => {
    const short = resource("laura", { schedule: week(WEEKDAYS, ["10:00", "12:00"]) });
    expect(startsOn({ resources: [short] })).toEqual(range("10:00", "11:30"));
  });

  it("a closure removes the whole local day, also inside a multi-day range; the next day is open again", () => {
    const closures = [{ startDate: "2026-09-28", endDate: "2026-09-29" }];
    expect(startsOn({ closures })).toEqual([]);
    expect(startsOn({ closures, from: at("2026-09-30"), to: at("2026-10-01") })).toHaveLength(18);
  });

  it("a business with no opening hours has no slots at all", () => {
    expect(startsOn({ businessHours: [] })).toEqual([]);
  });

  it("each weekday uses its own ranges", () => {
    const hours = [...week([1], ["09:00", "10:00"]), ...week([2], ["17:00", "18:00"])];
    const everyDay = resource("laura", { schedule: week(EVERY_DAY, ["00:00", "24:00"]) });
    const result = computeAvailability(input({ businessHours: hours, resources: [everyDay], from: at("2026-09-28"), to: at("2026-09-30") }));
    expect(result.slots.map((slot) => formatLocalMinute(slot.start, TZ))).toEqual(["2026-09-28T09:00", "2026-09-28T09:30", "2026-09-29T17:00", "2026-09-29T17:30"]);
  });
});

describe("resource schedules with several ranges per day [AGD-02]", () => {
  it("overlapping or touching ranges join into one", () => {
    const overlapping = resource("laura", { schedule: week(WEEKDAYS, ["09:00", "11:00"], ["10:30", "12:00"], ["12:00", "13:00"]) });
    expect(startsOn({ resources: [overlapping], stepMinutes: 60, service: service({ durationMin: 120 }) })).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("a service never spans the break between two ranges", () => {
    const split = resource("laura", { schedule: week(WEEKDAYS, ["09:00", "11:00"], ["11:30", "13:00"]) });
    expect(startsOn({ resources: [split], stepMinutes: 30, service: service({ durationMin: 60 }) })).toEqual(["09:00", "09:30", "10:00", "11:30", "12:00"]);
  });

  it("a slot may cross midnight when the ranges of both days touch", () => {
    const hours = [...week([5], ["20:00", "24:00"]), ...week([6], ["00:00", "02:00"])];
    const night = resource("laura", { schedule: hours });
    const result = computeAvailability(input({ businessHours: hours, resources: [night], stepMinutes: 60, service: service({ durationMin: 120 }), from: at("2026-10-02"), to: at("2026-10-04") }));
    expect(result.slots.map((slot) => formatLocalMinute(slot.start, TZ))).toEqual(["2026-10-02T20:00", "2026-10-02T21:00", "2026-10-02T22:00", "2026-10-02T23:00", "2026-10-03T00:00"]);
  });
});

describe("absences, blocks and bookings [AGD-09] [AGD-12] [AGD-18]", () => {
  it("an absence or a block takes the resource out; with «cualquiera» another one still offers the slot", () => {
    const away = resource("laura", { timeOff: [{ startsAt: at("2026-09-28T10:00"), endsAt: at("2026-09-28T11:00") }] });
    const result = computeAvailability(input({ resources: [away, resource("marta")] }));
    const ten = result.slots.find((slot) => formatLocalMinute(slot.start, TZ).endsWith("10:00"));
    expect(ten?.resourceIds).toEqual(["marta"]);
    expect(ten?.remaining).toBe(1);
    expect(startsOn({ resources: [away, resource("marta")], resourceId: "laura" })).not.toContain("10:00");
    expect(startsOn({ resources: [away, resource("marta")], resourceId: "laura" })).not.toContain("10:30");
    expect(startsOn({ resources: [away, resource("marta")], resourceId: "laura" })).toContain("11:00");
  });

  it("an absence of several days empties those days", () => {
    const holidays = resource("laura", { timeOff: [{ startsAt: at("2026-09-27"), endsAt: at("2026-10-03") }] });
    expect(startsOn({ resources: [holidays], from: at("2026-09-28"), to: at("2026-10-03") })).toEqual([]);
  });

  it("pending and confirmed bookings take the slot; cancelled, completed and no-shows free it", () => {
    const one = resource("laura");
    const bookings = [
      booking("laura", "2026-09-28T09:00", 30, { status: "confirmed" }),
      booking("laura", "2026-09-28T09:30", 30, { status: "pending" }),
      booking("laura", "2026-09-28T10:00", 30, { status: "cancelled" }),
      booking("laura", "2026-09-28T10:30", 30, { status: "no_show" }),
      booking("laura", "2026-09-28T11:00", 30, { status: "completed" }),
    ];
    const free = startsOn({ resources: [one], bookings, businessHours: week(WEEKDAYS, ["09:00", "11:30"]) });
    expect(free).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("with «cualquiera» a slot is free while any resource of the service is free, and the resource chosen must do it", () => {
    const bookings = [booking("laura", "2026-09-28T09:00", 30), booking("marta", "2026-09-28T09:00", 30), booking("laura", "2026-09-28T09:30", 30)];
    const result = computeAvailability(input({ bookings }));
    expect(starts(result)[0]).toBe("09:30");
    expect(result.slots[0].resourceIds).toEqual(["marta"]);
    expect(startsOn({ bookings, resourceId: "laura" })[0]).toBe("10:00");
    expect(computeAvailability(input({ resourceId: "pedro" }))).toEqual({ slots: [], reason: "no_resources" });
    expect(computeAvailability(input({ service: service({ resourceIds: ["laura"] }), resourceId: "marta" }))).toEqual({ slots: [], reason: "no_resources" });
  });

  it("an inactive resource takes no new bookings; an inactive service is not offered [AGD-03]", () => {
    expect(computeAvailability(input({ resources: [resource("laura", { active: false }), resource("marta")] })).slots[0].resourceIds).toEqual(["marta"]);
    expect(computeAvailability(input({ resources: [resource("laura", { active: false })] }))).toEqual({ slots: [], reason: "no_resources" });
    expect(computeAvailability(input({ service: service({ active: false }) }))).toEqual({ slots: [], reason: "service_inactive" });
  });

  it("services that need two resources at once are prepared but not offered [AGD-07]", () => {
    expect(computeAvailability(input({ service: service({ needsSecondResource: true }) }))).toEqual({ slots: [], reason: "second_resource" });
  });

  it("the booking being moved does not block itself", () => {
    const own = booking("laura", "2026-09-28T09:00", 30);
    expect(startsOn({ resources: [resource("laura")], bookings: [own], excludeBookingId: own.id })[0]).toBe("09:00");
  });
});

describe("margins before and after [AGD-04] [AGD-09]", () => {
  const buffered = service({ durationMin: 30, bufferBeforeMin: 10, bufferAfterMin: 10, resourceIds: ["laura"] });

  it("the margins of both bookings keep them apart", () => {
    // Existing 10:00–10:30 occupies 09:50–10:40.
    const existing = { ...booking("laura", "2026-09-28T09:50", 50) };
    const free = startsOn({ service: buffered, resources: [resource("laura")], bookings: [existing], stepMinutes: 15, businessHours: week(WEEKDAYS, ["09:00", "12:00"]) });
    // 09:00 → occupies 08:50–09:40 (free); 09:15 → 09:05–09:55 overlaps; 10:45 → 10:35–11:25 overlaps; 11:00 free.
    expect(free).toEqual(["09:00", "11:00", "11:15", "11:30"]);
  });

  it("margins may fall outside opening hours, but not over an absence", () => {
    const hours = week(WEEKDAYS, ["09:00", "10:00"]);
    expect(startsOn({ service: buffered, resources: [resource("laura")], businessHours: hours })).toEqual(["09:00", "09:30"]);
    const away = resource("laura", { timeOff: [{ startsAt: at("2026-09-28T08:55"), endsAt: at("2026-09-28T09:00") }] });
    expect(startsOn({ service: buffered, resources: [away], businessHours: hours })).toEqual(["09:30"]);
  });

  it("bookingTimes gives the visible and the occupied range", () => {
    const times = bookingTimes(at("2026-09-28T10:00"), buffered);
    expect(times.endsAt.toISOString()).toBe(at("2026-09-28T10:30").toISOString());
    expect(times.blockedStartAt.toISOString()).toBe(at("2026-09-28T09:50").toISOString());
    expect(times.blockedEndAt.toISOString()).toBe(at("2026-09-28T10:40").toISOString());
    expect(bookingTimes(at("2026-09-28T10:00"), buffered, 60).endsAt.toISOString()).toBe(at("2026-09-28T11:00").toISOString());
  });
});

describe("minimum and maximum advance [AGD-09]", () => {
  it("nothing in the past and nothing before the minimum notice", () => {
    const now = at("2026-09-28T10:05");
    expect(startsOn({ now, businessHours: week(WEEKDAYS, ["09:00", "12:00"]) })).toEqual(["10:30", "11:00", "11:30"]);
    expect(startsOn({ now, service: service({ minAdvanceMin: 60 }), businessHours: week(WEEKDAYS, ["09:00", "12:00"]) })).toEqual(["11:30"]);
  });

  it("nothing beyond the maximum days ahead", () => {
    const result = computeAvailability(
      input({ now: at("2026-09-28T12:00"), service: service({ maxAdvanceDays: 2 }), from: at("2026-09-28"), to: at("2026-10-03"), businessHours: week(WEEKDAYS, ["09:00", "14:00"]) }),
    );
    const last = result.slots[result.slots.length - 1];
    expect(formatLocalMinute(last.start, TZ)).toBe("2026-09-30T12:00");
  });

  it("changing a booking without moving it ignores the advance limits", () => {
    expect(startsOn({ now: at("2026-09-28T13:00"), ignoreAdvance: true, businessHours: week(WEEKDAYS, ["09:00", "10:00"]) })).toEqual(["09:00", "09:30"]);
  });
});

describe("capacity mode: tables, rooms and classes [AGD-06] [AGD-11]", () => {
  const dinner = service({ id: "cena", durationMin: 90, minPeople: 1, maxPeople: 12, resourceIds: ["sala", "terraza"] });
  const room = resource("sala", { capacity: 10, schedule: week(EVERY_DAY, ["13:00", "16:00"], ["20:00", "23:30"]) });
  const terrace = resource("terraza", { capacity: 6, schedule: week(EVERY_DAY, ["20:00", "23:30"]) });
  const evening = { businessHours: week(EVERY_DAY, ["20:00", "23:30"]), mode: "capacity" as const, service: dinner, stepMinutes: 30 };

  it("a slot is free while the people at the busiest moment plus the group fit", () => {
    const bookings = [booking("sala", "2026-09-28T20:00", 90, { people: 6 }), booking("sala", "2026-09-28T21:30", 90, { people: 6 })];
    const three = computeAvailability(input({ ...evening, resources: [room], bookings, people: 3 }));
    // 21:00–22:30 overlaps both, but never more than 6 at once: 6 + 3 ≤ 10.
    const nine = three.slots.find((slot) => formatLocalMinute(slot.start, TZ).endsWith("21:00"));
    expect(nine).toMatchObject({ resourceIds: ["sala"], remaining: 4 });
    const five = startsOn({ ...evening, resources: [room], bookings, people: 5 });
    expect(five).toEqual([]);
    expect(startsOn({ ...evening, resources: [room], bookings, people: 4 })).toEqual(["20:00", "20:30", "21:00", "21:30", "22:00"]);
  });

  it("overlapping bookings add up", () => {
    const bookings = [booking("sala", "2026-09-28T20:00", 90, { people: 6 }), booking("sala", "2026-09-28T20:00", 90, { people: 3 })];
    expect(startsOn({ ...evening, resources: [room], bookings, people: 2 })).toEqual(["21:30", "22:00"]);
    expect(startsOn({ ...evening, resources: [room], bookings, people: 1 })).toEqual(["20:00", "20:30", "21:00", "21:30", "22:00"]);
  });

  it("a group outside the service limits or larger than every capacity has no slots", () => {
    expect(computeAvailability(input({ ...evening, resources: [room, terrace], people: 13 }))).toEqual({ slots: [], reason: "group_size" });
    expect(computeAvailability(input({ ...evening, resources: [room, terrace], people: 0 }))).toEqual({ slots: [], reason: "group_size" });
    expect(computeAvailability(input({ ...evening, service: service({ ...dinner, minPeople: 2 }), resources: [room], people: 1 }))).toEqual({ slots: [], reason: "group_size" });
    expect(computeAvailability(input({ ...evening, resources: [room, terrace], people: 11 }))).toEqual({ slots: [], reason: "group_too_large" });
    // 8 people only fit in the room.
    expect(computeAvailability(input({ ...evening, resources: [room, terrace], people: 8 })).slots[0].resourceIds).toEqual(["sala"]);
  });

  it("with «cualquiera» the free seats of every free resource are summed", () => {
    const result = computeAvailability(input({ ...evening, resources: [room, terrace], bookings: [booking("terraza", "2026-09-28T20:00", 90, { people: 4 })], people: 2 }));
    expect(result.slots[0]).toMatchObject({ resourceIds: ["sala", "terraza"], remaining: 12 });
  });

  it("classes: a fixed-time group fills up to its capacity", () => {
    const yoga = service({ id: "yoga", durationMin: 60, maxPeople: 1, resourceIds: ["aula"] });
    const hall = resource("aula", { capacity: 3, schedule: week(WEEKDAYS, ["18:00", "19:00"]) });
    const hours = week(WEEKDAYS, ["18:00", "19:00"]);
    const full = [1, 2, 3].map(() => booking("aula", "2026-09-28T18:00", 60));
    expect(startsOn({ service: yoga, resources: [hall], businessHours: hours, mode: "capacity", bookings: full.slice(0, 2) })).toEqual(["18:00"]);
    expect(startsOn({ service: yoga, resources: [hall], businessHours: hours, mode: "capacity", bookings: full })).toEqual([]);
  });

  it("in individual mode a table takes one group at a time, whatever its size", () => {
    const table = resource("mesa", { capacity: 4, schedule: week(EVERY_DAY, ["20:00", "23:30"]) });
    const two = service({ ...dinner, resourceIds: ["mesa"] });
    const taken = [booking("mesa", "2026-09-28T20:00", 90, { people: 2 })];
    expect(startsOn({ ...evening, mode: "individual", service: two, resources: [table], bookings: taken, people: 2 })).toEqual(["21:30", "22:00"]);
    expect(computeAvailability(input({ ...evening, mode: "individual", service: two, resources: [table], people: 6 }))).toEqual({ slots: [], reason: "group_too_large" });
  });
});

describe("change-of-time days in Europe/Madrid [AGD-10]", () => {
  const allDay = week(EVERY_DAY, ["00:00", "24:00"]);
  const open = { businessHours: allDay, resources: [resource("laura", { schedule: allDay })], service: service({ durationMin: 60, resourceIds: ["laura"] }), stepMinutes: 30 };

  it("2026-10-25 (clocks go back): 25 hours of slots, the repeated hour twice with its own offset, none lost", () => {
    const result = computeAvailability(input({ ...open, from: at("2026-10-25"), to: at("2026-10-26") }));
    expect(result.slots).toHaveLength(50);
    const locals = result.slots.map((slot) => slot.startLocal);
    expect(locals).toContain("2026-10-25T02:30:00+02:00");
    expect(locals).toContain("2026-10-25T02:30:00+01:00");
    expect(locals[0]).toBe("2026-10-25T00:00:00+02:00");
    expect(locals[locals.length - 1]).toBe("2026-10-25T23:30:00+01:00");
    // Every step is exactly 30 real minutes: no instant duplicated or skipped.
    result.slots.slice(1).forEach((slot, index) => expect(slot.start.getTime() - result.slots[index].start.getTime()).toBe(30 * MIN));
  });

  it("2027-03-28 (clocks go forward): 23 hours of slots and no 02:xx, which does not exist", () => {
    const result = computeAvailability(input({ ...open, from: at("2027-03-28"), to: at("2027-03-29") }));
    expect(result.slots).toHaveLength(46);
    const times = starts(result);
    expect(times.filter((time) => time.startsWith("02:"))).toEqual([]);
    expect(times.slice(2, 5)).toEqual(["01:00", "01:30", "03:00"]);
    // A 60-minute service at 01:30 ends at 03:30 local: one real hour.
    const half = result.slots.find((slot) => slot.startLocal === "2027-03-28T01:30:00+01:00");
    expect(half?.endLocal).toBe("2027-03-28T03:30:00+02:00");
  });

  it("normal opening hours on those days keep their local times with the new offset", () => {
    const sundays = week([6, 7], ["10:00", "12:00"]);
    const base = { ...open, businessHours: sundays };
    const saturday = computeAvailability(input({ ...base, from: at("2026-10-24"), to: at("2026-10-25") }));
    const sunday = computeAvailability(input({ ...base, from: at("2026-10-25"), to: at("2026-10-26") }));
    expect(saturday.slots.map((slot) => slot.startLocal)).toEqual(["2026-10-24T10:00:00+02:00", "2026-10-24T10:30:00+02:00", "2026-10-24T11:00:00+02:00"]);
    expect(sunday.slots.map((slot) => slot.startLocal)).toEqual(["2026-10-25T10:00:00+01:00", "2026-10-25T10:30:00+01:00", "2026-10-25T11:00:00+01:00"]);
    expect(sunday.slots[0].start.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    const spring = computeAvailability(input({ ...base, from: at("2027-03-28"), to: at("2027-03-29") }));
    expect(spring.slots[0].start.toISOString()).toBe("2027-03-28T08:00:00.000Z");
  });

  it("a range that starts in the nonexistent hour opens at the jump; one that ends in it closes there", () => {
    const night = week([7], ["02:30", "05:00"]);
    const result = computeAvailability(input({ ...open, businessHours: night, from: at("2027-03-28"), to: at("2027-03-29") }));
    expect(starts(result)).toEqual(["03:00", "03:30", "04:00"]);
    const early = week([7], ["00:00", "02:30"]);
    expect(starts(computeAvailability(input({ ...open, businessHours: early, from: at("2027-03-28"), to: at("2027-03-29") })))).toEqual(["00:00", "00:30", "01:00"]);
  });

  it("a range that ends in the repeated hour includes both occurrences", () => {
    const night = week([7], ["01:00", "02:30"]);
    const result = computeAvailability(input({ ...open, service: service({ durationMin: 30, resourceIds: ["laura"] }), businessHours: night, from: at("2026-10-25"), to: at("2026-10-26") }));
    expect(result.slots.map((slot) => slot.startLocal)).toEqual([
      "2026-10-25T01:00:00+02:00",
      "2026-10-25T01:30:00+02:00",
      "2026-10-25T02:00:00+02:00",
      "2026-10-25T02:30:00+02:00",
      "2026-10-25T02:00:00+01:00",
    ]);
  });

  it("a booking in the second 02:30 only blocks that one", () => {
    const second = at("2026-10-25T02:30+01:00");
    const taken = { ...booking("laura", "2026-10-25T02:30+01:00", 30), blockedStartAt: second, blockedEndAt: new Date(second.getTime() + 30 * MIN) };
    const result = computeAvailability(input({ ...open, service: service({ durationMin: 30, resourceIds: ["laura"] }), bookings: [taken], from: at("2026-10-25"), to: at("2026-10-25T05:00") }));
    const locals = result.slots.map((slot) => slot.startLocal);
    expect(locals).toContain("2026-10-25T02:30:00+02:00");
    expect(locals).not.toContain("2026-10-25T02:30:00+01:00");
  });

  it("a 15-minute grid stays on :00, :15, :30 and :45 on both sides of the change", () => {
    const result = computeAvailability(input({ ...open, stepMinutes: 15, from: at("2026-10-25"), to: at("2026-10-26") }));
    expect(new Set(starts(result).map((time) => time.slice(3, 5)))).toEqual(new Set(["00", "15", "30", "45"]));
    expect(result.slots).toHaveLength(100);
  });
});

describe("one start and the agent's suggestions [AGD-13] [AGD-21]", () => {
  it("checks any exact start, not only the grid, and orders capacity resources by best fit", () => {
    const off = freeResourcesForStart({ ...input(), from: at("2026-09-28T10:05") });
    expect(off.resources.map((r) => r.resourceId)).toEqual(["laura", "marta"]);
    expect(freeResourcesForStart({ ...input(), from: at("2026-09-28T13:45") }).resources).toEqual([]);
    expect(freeResourcesForStart({ ...input(), from: at("2026-09-28T10:00"), people: 3 })).toEqual({ resources: [], reason: "group_size" });

    const dinner = service({ durationMin: 90, maxPeople: 8, resourceIds: ["grande", "pequena"] });
    const big = resource("grande", { capacity: 40, schedule: week(EVERY_DAY, ["20:00", "23:30"]) });
    const small = resource("pequena", { capacity: 8, schedule: week(EVERY_DAY, ["20:00", "23:30"]) });
    const fit = freeResourcesForStart({ ...input({ service: dinner, resources: [big, small], mode: "capacity", businessHours: week(EVERY_DAY, ["20:00", "23:30"]), people: 2 }), from: at("2026-09-28T20:00") });
    expect(fit.resources).toEqual([
      { resourceId: "pequena", remaining: 8 },
      { resourceId: "grande", remaining: 40 },
    ]);
  });

  it("suggests the first slot and then others spread over the day or the next days", () => {
    const result = computeAvailability(input({ from: at("2026-09-28"), to: at("2026-09-30") }));
    const picked = pickSuggestions(result.slots, TZ, 3).map((slot) => formatLocalMinute(slot.start, TZ));
    expect(picked).toEqual(["2026-09-28T09:00", "2026-09-28T11:00", "2026-09-28T13:00"]);
    const sparse = pickSuggestions(result.slots.filter((slot) => formatLocalMinute(slot.start, TZ).endsWith("09:00")), TZ, 3).map((slot) => formatLocalMinute(slot.start, TZ));
    expect(sparse).toEqual(["2026-09-28T09:00", "2026-09-29T09:00"]);
    // Few slots close together: still 2 or 3 to choose from.
    const close = pickSuggestions(result.slots.filter((slot) => /T19:(00|30)$/.test(formatLocalMinute(slot.start, TZ))), TZ, 3).map((slot) => formatLocalMinute(slot.start, TZ));
    expect(close).toEqual(["2026-09-28T19:00", "2026-09-28T19:30", "2026-09-29T19:00"]);
  });

  it("offers the closest alternatives to a slot that was just taken", () => {
    const result = computeAvailability(input({ bookings: [booking("laura", "2026-09-28T11:00", 30), booking("marta", "2026-09-28T11:00", 30)] }));
    expect(closestSlots(result.slots, at("2026-09-28T11:00"), 3).map((slot) => formatLocalMinute(slot.start, TZ).slice(11))).toEqual(["10:00", "10:30", "11:30"]);
  });
});
