import { describe, expect, it } from "vitest";
import type { AvailableSlot } from "@/server/booking";
import { toSlotOptions } from "./slots";

const TZ = "Europe/Madrid";

const slot = (start: string, startLocal: string, resourceIds = ["r1"]): AvailableSlot => ({
  start: new Date(start),
  end: new Date(new Date(start).getTime() + 30 * 60_000),
  startLocal,
  endLocal: startLocal,
  resourceIds,
  remaining: 1,
});

describe("Agenda: free slots offered to a person, as the engine gives them [AGD-08] [AGD-17]", () => {
  it("keeps the exact local time with its offset as the value and shows the hour and the day", () => {
    const [option] = toSlotOptions([slot("2026-09-29T08:00:00Z", "2026-09-29T10:00:00+02:00", ["r1", "r2"])], TZ);
    expect(option).toEqual({
      value: "2026-09-29T10:00:00+02:00",
      date: "2026-09-29",
      time: "10:00",
      label: "10:00",
      dayLabel: "martes 29 de septiembre",
      resourceIds: ["r1", "r2"],
      remaining: 1,
    });
  });

  it("tells apart the two 02:30 of the day the clocks go back, so none is lost or duplicated [AGD-10]", () => {
    const options = toSlotOptions(
      [slot("2026-10-25T00:30:00Z", "2026-10-25T02:30:00+02:00"), slot("2026-10-25T01:30:00Z", "2026-10-25T02:30:00+01:00")],
      TZ,
    );
    expect(options.map((option) => option.label)).toEqual(["02:30 (antes del cambio de hora)", "02:30 (después del cambio de hora)"]);
    expect(new Set(options.map((option) => option.value)).size).toBe(2);
  });
});
