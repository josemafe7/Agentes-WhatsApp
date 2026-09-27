// Weekly schedule summary, absence payload and absence labels of the resources screen ([AGD-02], [AGD-28]).
import { describe, expect, it } from "vitest";
import { absencePayload, scheduleSummary, timeOffLabel } from "./resource-form";

const TZ = "Europe/Madrid";

describe("scheduleSummary [AGD-02]", () => {
  it("joins consecutive days with the same ranges", () => {
    const week = [1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, start: "09:00", end: "14:00" },
      { weekday, start: "16:00", end: "20:00" },
    ]);
    week.push({ weekday: 6, start: "09:00", end: "14:00" });
    expect(scheduleSummary(week)).toBe("Lun–Vie 09:00–14:00 y 16:00–20:00 · Sáb 09:00–14:00");
  });

  it("does not join days separated by a day off, and orders the ranges of a day", () => {
    expect(
      scheduleSummary([
        { weekday: 3, start: "16:00", end: "20:00" },
        { weekday: 1, start: "09:00", end: "14:00" },
        { weekday: 3, start: "09:00", end: "14:00" },
      ]),
    ).toBe("Lun 09:00–14:00 · Mié 09:00–14:00 y 16:00–20:00");
  });

  it("says when there is no schedule (no slots at all)", () => {
    expect(scheduleSummary([])).toBe("Sin horario");
  });
});

describe("absencePayload [AGD-02]", () => {
  const resourceId = "0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d";

  it("whole days go as bare dates (the end day included)", () => {
    expect(absencePayload({ resourceId, wholeDays: true, startDate: "2026-10-12", endDate: "2026-10-16", startTime: "", endTime: "", reason: "Vacaciones" })).toEqual({
      resourceId,
      kind: "absence",
      start: "2026-10-12",
      end: "2026-10-16",
      reason: "Vacaciones",
    });
  });

  it("one whole day when the end is left empty", () => {
    expect(absencePayload({ resourceId, wholeDays: true, startDate: "2026-10-12", endDate: "", startTime: "", endTime: "", reason: "" })).toMatchObject({
      start: "2026-10-12",
      end: "2026-10-12",
      reason: "",
    });
  });

  it("with hours, local date and time (the same day when the end day is empty)", () => {
    expect(absencePayload({ resourceId, wholeDays: false, startDate: "2026-10-12", endDate: "", startTime: "10:00", endTime: "12:30", reason: "Médico" })).toMatchObject({
      start: "2026-10-12T10:00",
      end: "2026-10-12T12:30",
    });
  });
});

describe("timeOffLabel [AGD-28]", () => {
  it("shows whole days as dates, in the business time zone", () => {
    // 12 to 16 October, local midnight to local midnight (CEST, +02:00).
    expect(timeOffLabel({ startsAt: new Date("2026-10-11T22:00:00Z"), endsAt: new Date("2026-10-16T22:00:00Z") }, TZ)).toBe("12 oct 2026 – 16 oct 2026");
    expect(timeOffLabel({ startsAt: new Date("2026-10-11T22:00:00Z"), endsAt: new Date("2026-10-12T22:00:00Z") }, TZ)).toBe("12 oct 2026");
  });

  it("keeps whole days right across the change of time (25-hour day)", () => {
    // 25 October 2026: the clocks go back; the day ends at 23:00 UTC.
    expect(timeOffLabel({ startsAt: new Date("2026-10-24T22:00:00Z"), endsAt: new Date("2026-10-25T23:00:00Z") }, TZ)).toBe("25 oct 2026");
  });

  it("shows hours when it does not cover whole days", () => {
    expect(timeOffLabel({ startsAt: new Date("2026-10-12T08:00:00Z"), endsAt: new Date("2026-10-12T10:30:00Z") }, TZ)).toBe("12 oct 2026, 10:00 – 12:30");
    expect(timeOffLabel({ startsAt: new Date("2026-10-12T08:00:00Z"), endsAt: new Date("2026-10-13T10:30:00Z") }, TZ)).toBe("12 oct 2026, 10:00 – 13 oct 2026, 12:30");
  });
});
