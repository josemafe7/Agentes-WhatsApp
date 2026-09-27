import { describe, expect, it } from "vitest";
import { closureOf, dayHeading, intersectRanges, monthWeeks, nowLocal, openRanges, periodLabel, stepDate, viewRange } from "./calendar";

const TZ = "Europe/Madrid";
// Monday–Friday 09:00–14:00 and 16:00–20:00; Saturday 10:00–14:00; Sunday closed.
const HOURS = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, startMin: 540, endMin: 840 },
  { weekday, startMin: 960, endMin: 1200 },
]).concat([{ weekday: 6, startMin: 600, endMin: 840 }]);

describe("Agenda: days of each view [AGD-16] [AGD-28]", () => {
  it("day and resources show one day; the week goes Monday to Sunday", () => {
    expect(viewRange("dia", "2026-09-30")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(viewRange("recursos", "2026-09-30")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(viewRange("semana", "2026-09-30")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(viewRange("semana", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("the month shows whole weeks around it (at most six)", () => {
    expect(viewRange("mes", "2026-09-15")).toEqual({ from: "2026-08-31", to: "2026-10-04" });
    const weeks = monthWeeks("2026-09-15");
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toEqual({ date: "2026-08-31", inMonth: false });
    expect(weeks[0][1]).toEqual({ date: "2026-09-01", inMonth: true });
    expect(weeks[4][6]).toEqual({ date: "2026-10-04", inMonth: false });
    expect(monthWeeks("2026-03-10")).toHaveLength(6);
  });

  it("«anterior» and «siguiente» move a day, a week or a month", () => {
    expect(stepDate("dia", "2026-09-30", 1)).toBe("2026-10-01");
    expect(stepDate("recursos", "2026-09-30", -1)).toBe("2026-09-29");
    expect(stepDate("semana", "2026-09-30", 1)).toBe("2026-10-07");
    expect(stepDate("mes", "2026-01-31", 1)).toBe("2026-02-01");
    expect(stepDate("mes", "2026-01-31", -1)).toBe("2025-12-01");
  });

  it("names the period in Spanish", () => {
    expect(periodLabel("dia", "2026-09-28")).toBe("Lunes, 28 de septiembre de 2026");
    expect(periodLabel("semana", "2026-09-23")).toBe("Semana del 21 al 27 de septiembre");
    expect(periodLabel("semana", "2026-09-30")).toBe("Semana del 28 de septiembre al 4 de octubre");
    expect(periodLabel("semana", "2026-12-30")).toBe("Semana del 28 de diciembre de 2026 al 3 de enero de 2027");
    expect(periodLabel("mes", "2026-09-15")).toBe("Septiembre de 2026");
    expect(dayHeading("2026-09-28")).toEqual({ weekday: "lun", day: "28", long: "lunes, 28 de septiembre" });
  });

  it("today and the current minute in the business time zone, also on the day the clocks go back [AGD-10]", () => {
    expect(nowLocal(TZ, new Date("2026-09-27T08:00:00Z"))).toEqual({ date: "2026-09-27", minutes: 600 });
    expect(nowLocal(TZ, new Date("2026-09-27T22:30:00Z"))).toEqual({ date: "2026-09-28", minutes: 30 });
    expect(nowLocal(TZ, new Date("2026-10-25T01:30:00Z"))).toEqual({ date: "2026-10-25", minutes: 150 });
  });
});

describe("Agenda: opening hours and holidays on the calendar [AGD-05]", () => {
  it("gives the open ranges of each day; closed days and holidays have none", () => {
    expect(openRanges("2026-09-28", HOURS, [])).toEqual([
      { startMin: 540, endMin: 840 },
      { startMin: 960, endMin: 1200 },
    ]);
    expect(openRanges("2026-10-03", HOURS, [])).toEqual([{ startMin: 600, endMin: 840 }]);
    expect(openRanges("2026-10-04", HOURS, [])).toEqual([]);
    const closures = [{ startDate: "2026-10-12", endDate: "2026-10-12", reason: "Fiesta nacional" }];
    expect(openRanges("2026-10-12", HOURS, closures)).toEqual([]);
    expect(closureOf("2026-10-12", closures)).toEqual({ reason: "Fiesta nacional" });
    expect(closureOf("2026-10-13", closures)).toBeNull();
  });

  it("joins touching ranges and keeps them in order", () => {
    const hours = [
      { weekday: 1, startMin: 960, endMin: 1200 },
      { weekday: 1, startMin: 540, endMin: 840 },
      { weekday: 1, startMin: 840, endMin: 900 },
    ];
    expect(openRanges("2026-09-28", hours, [])).toEqual([
      { startMin: 540, endMin: 900 },
      { startMin: 960, endMin: 1200 },
    ]);
  });
});

describe("Agenda: a resource's own hours inside the business's [AGD-05]", () => {
  it("only the part of the resource's schedule within opening hours is open", () => {
    const business = [
      { startMin: 540, endMin: 840 },
      { startMin: 960, endMin: 1200 },
    ];
    expect(intersectRanges(business, [{ startMin: 600, endMin: 1080 }])).toEqual([
      { startMin: 600, endMin: 840 },
      { startMin: 960, endMin: 1080 },
    ]);
    expect(intersectRanges(business, [])).toEqual([]);
    expect(intersectRanges([], [{ startMin: 600, endMin: 700 }])).toEqual([]);
  });
});
