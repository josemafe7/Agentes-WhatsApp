import { describe, expect, it } from "vitest";
import { isWithinOpeningHours } from "./opening-hours";

// Tuesday 10:00–14:00 and 16:00–20:00, Saturday 09:00–14:00 (Madrid).
const HOURS = [
  { weekday: 2, startMin: 600, endMin: 840 },
  { weekday: 2, startMin: 960, endMin: 1200 },
  { weekday: 6, startMin: 540, endMin: 840 },
];
const TZ = "Europe/Madrid";

describe("inside or outside opening hours [AJU-03] [TRA-03]", () => {
  it("reads the ranges in the business time zone, end excluded", () => {
    // Tuesday 29 Sep 2026 (UTC+2).
    expect(isWithinOpeningHours(new Date("2026-09-29T08:00:00Z"), TZ, HOURS)).toBe(true); // 10:00
    expect(isWithinOpeningHours(new Date("2026-09-29T07:59:00Z"), TZ, HOURS)).toBe(false); // 09:59
    expect(isWithinOpeningHours(new Date("2026-09-29T12:00:00Z"), TZ, HOURS)).toBe(false); // 14:00
    expect(isWithinOpeningHours(new Date("2026-09-29T14:30:00Z"), TZ, HOURS)).toBe(true); // 16:30
    // Monday: closed all day.
    expect(isWithinOpeningHours(new Date("2026-09-28T09:00:00Z"), TZ, HOURS)).toBe(false);
  });

  it("follows the change of time: Saturday 09:00 is 07:00 UTC in summer and 08:00 UTC in winter", () => {
    expect(isWithinOpeningHours(new Date("2026-10-24T07:00:00Z"), TZ, HOURS)).toBe(true);
    // 31 Oct 2026 is after the change (25 Oct): 07:00 UTC is 08:00 local, still closed.
    expect(isWithinOpeningHours(new Date("2026-10-31T07:00:00Z"), TZ, HOURS)).toBe(false);
    expect(isWithinOpeningHours(new Date("2026-10-31T08:00:00Z"), TZ, HOURS)).toBe(true);
  });

  it("a closure day is outside opening hours even within the weekly ranges", () => {
    const closures = [{ startDate: "2026-09-29", endDate: "2026-09-29" }];
    expect(isWithinOpeningHours(new Date("2026-09-29T08:00:00Z"), TZ, HOURS, closures)).toBe(false);
  });
});
