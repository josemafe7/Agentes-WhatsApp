// Free slots as the «Nueva cita» dialog offers them: one day at a time, in the business's time zone, and the repeated
// hour of the change of time told apart so no time is lost or duplicated ([AGD-08], [AGD-10], [AGD-28]).
import { describe, expect, it } from "vitest";
import { at, TZ } from "@/server/booking/test-helpers";
import { daySlots, slotChoice } from "./slot-options";

const slot = (start: Date) => ({ start });

describe("slots of one day [AGD-08] [AGD-28]", () => {
  it("offers the chosen day's slots in local time and says which later day has free slots", () => {
    const slots = [at("2026-09-28T10:00"), at("2026-09-28T10:30"), at("2026-09-30T11:00"), at("2026-10-01T09:00")].map(slot);
    expect(daySlots(slots, "2026-09-28", TZ)).toEqual({
      slots: [
        { value: "2026-09-28T10:00", date: "2026-09-28", dayLabel: "lunes 28 de septiembre", time: "10:00", note: null },
        { value: "2026-09-28T10:30", date: "2026-09-28", dayLabel: "lunes 28 de septiembre", time: "10:30", note: null },
      ],
      next: { date: "2026-09-30", dayLabel: "miércoles 30 de septiembre" },
    });
    expect(daySlots(slots, "2026-09-29", TZ)).toEqual({ slots: [], next: { date: "2026-09-30", dayLabel: "miércoles 30 de septiembre" } });
    expect(daySlots(slots, "2026-10-01", TZ)).toMatchObject({ next: null });
    expect(daySlots([], "2026-10-01", TZ)).toEqual({ slots: [], next: null });
  });

  it("the day clocks go back offers the repeated 02:30 twice, each with its own offset and note [AGD-10]", () => {
    const first = new Date("2026-10-25T00:30:00Z");
    const second = new Date("2026-10-25T01:30:00Z");
    const after = new Date("2026-10-25T02:00:00Z");
    const { slots } = daySlots([first, second, after].map(slot), "2026-10-25", TZ);
    expect(slots.map(({ value, time, note }) => ({ value, time, note }))).toEqual([
      { value: "2026-10-25T02:30+02:00", time: "02:30", note: "antes del cambio de hora" },
      { value: "2026-10-25T02:30+01:00", time: "02:30", note: "después del cambio de hora" },
      { value: "2026-10-25T03:00", time: "03:00", note: null },
    ]);
  });

  it("an alternative after a taken slot says its day and time [AGD-13]", () => {
    expect(slotChoice(at("2026-10-02T17:30"), TZ)).toEqual({ value: "2026-10-02T17:30", date: "2026-10-02", dayLabel: "viernes 2 de octubre", time: "17:30", note: null });
  });
});
