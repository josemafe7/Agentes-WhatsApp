import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  formatLocalIso,
  formatLocalMinute,
  instantToLocal,
  isLocalDate,
  isRepeatedLocalTime,
  isSkippedLocalTime,
  localDayBounds,
  localToInstant,
  parseLocalDateTime,
  weekdayOf,
} from "./time";

const TZ = "Europe/Madrid";
const HOUR = 3_600_000;
const iso = (date: Date) => date.toISOString();

describe("business-local time ⇄ UTC [AGD-10] [AGD-28]", () => {
  it("reads a normal local time with the offset of that day (summer +02:00, winter +01:00)", () => {
    expect(iso(localToInstant("2026-09-29", 10 * 60, TZ))).toBe("2026-09-29T08:00:00.000Z");
    expect(iso(localToInstant("2026-12-01", 10 * 60, TZ))).toBe("2026-12-01T09:00:00.000Z");
    expect(iso(localToInstant("2026-09-29", 1_440, TZ))).toBe("2026-09-29T22:00:00.000Z");
  });

  it("clocks going back (2026-10-25): 02:30 happens twice, earlier by default, later on request", () => {
    expect(isRepeatedLocalTime("2026-10-25", 150, TZ)).toBe(true);
    expect(iso(localToInstant("2026-10-25", 150, TZ))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(localToInstant("2026-10-25", 150, TZ, "later"))).toBe("2026-10-25T01:30:00.000Z");
    expect(isRepeatedLocalTime("2026-10-25", 180, TZ)).toBe(false);
    expect(iso(localToInstant("2026-10-25", 180, TZ, "later"))).toBe("2026-10-25T02:00:00.000Z");
  });

  it("clocks going forward (2027-03-28): 02:30 does not exist; typed times shift, range edges clamp to the jump", () => {
    expect(isSkippedLocalTime("2027-03-28", 150, TZ)).toBe(true);
    expect(isSkippedLocalTime("2027-03-28", 180, TZ)).toBe(false);
    // 02:30 read with the old offset (+01:00) = 01:30 UTC = 03:30 local.
    expect(iso(localToInstant("2027-03-28", 150, TZ))).toBe("2027-03-28T01:30:00.000Z");
    // The jump: 02:00 CET = 01:00 UTC = 03:00 CEST.
    expect(iso(localToInstant("2027-03-28", 150, TZ, "earlier", "clamp"))).toBe("2027-03-28T01:00:00.000Z");
    expect(iso(localToInstant("2027-03-28", 120, TZ, "earlier", "clamp"))).toBe("2027-03-28T01:00:00.000Z");
    expect(iso(localToInstant("2027-03-28", 180, TZ))).toBe("2027-03-28T01:00:00.000Z");
  });

  it("change-of-time days last 25 and 23 hours; the rest, 24", () => {
    const length = (date: string) => {
      const { start, end } = localDayBounds(date, TZ);
      return (end.getTime() - start.getTime()) / HOUR;
    };
    expect(length("2026-10-25")).toBe(25);
    expect(length("2027-03-28")).toBe(23);
    expect(length("2026-10-26")).toBe(24);
  });

  it("formats an instant as the business clock reads it, with the offset", () => {
    expect(formatLocalIso(new Date("2026-10-25T00:30:00Z"), TZ)).toBe("2026-10-25T02:30:00+02:00");
    expect(formatLocalIso(new Date("2026-10-25T01:30:00Z"), TZ)).toBe("2026-10-25T02:30:00+01:00");
    expect(formatLocalIso(new Date("2027-03-28T01:00:00Z"), TZ)).toBe("2027-03-28T03:00:00+02:00");
    expect(formatLocalIso(new Date("2026-06-01T12:00:00Z"), "America/New_York")).toBe("2026-06-01T08:00:00-04:00");
    expect(instantToLocal(new Date("2026-09-28T22:30:00Z"), TZ)).toEqual({ date: "2026-09-29", minutes: 30, weekday: 2, offset: 120 });
  });

  it("the short form adds the offset only to repeated times, and reads back to the same instant", () => {
    const first = new Date("2026-10-25T00:30:00Z");
    const second = new Date("2026-10-25T01:30:00Z");
    expect(formatLocalMinute(new Date("2026-09-29T08:00:00Z"), TZ)).toBe("2026-09-29T10:00");
    expect(formatLocalMinute(first, TZ)).toBe("2026-10-25T02:30+02:00");
    expect(formatLocalMinute(second, TZ)).toBe("2026-10-25T02:30+01:00");
    for (const instant of [first, second, new Date("2027-03-28T01:00:00Z"), new Date("2026-12-31T23:15:00Z")]) {
      expect(parseLocalDateTime(formatLocalMinute(instant, TZ), TZ)?.getTime()).toBe(instant.getTime());
    }
  });

  it("parses local dates and times; rejects impossible ones and offsets that do not match", () => {
    expect(iso(parseLocalDateTime("2026-09-29T10:15", TZ) as Date)).toBe("2026-09-29T08:15:00.000Z");
    expect(iso(parseLocalDateTime("2026-09-29 10:15:30", TZ) as Date)).toBe("2026-09-29T08:15:30.000Z");
    expect(iso(parseLocalDateTime("2026-09-29", TZ) as Date)).toBe("2026-09-28T22:00:00.000Z");
    expect(iso(parseLocalDateTime("2026-10-25T02:30", TZ, "later") as Date)).toBe("2026-10-25T01:30:00.000Z");
    expect(iso(parseLocalDateTime("2026-10-25T02:30+0100", TZ) as Date)).toBe("2026-10-25T01:30:00.000Z");
    expect(parseLocalDateTime("2026-09-29T10:00+05:00", TZ)).toBeNull();
    expect(parseLocalDateTime("2026-02-30T10:00", TZ)).toBeNull();
    expect(parseLocalDateTime("2026-09-29T24:00", TZ)).toBeNull();
    expect(parseLocalDateTime("mañana a las 10", TZ)).toBeNull();
    expect(parseLocalDateTime("", TZ)).toBeNull();
  });

  it("calendar arithmetic on local dates", () => {
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2027-02-29")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-28", "2026-10-05")).toBe(7);
    expect(weekdayOf("2026-09-28")).toBe(1);
    expect(weekdayOf("2026-10-25")).toBe(7);
  });
});
