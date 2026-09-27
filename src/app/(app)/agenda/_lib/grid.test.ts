import { describe, expect, it } from "vitest";
import { dayMinutes, dropHint, gridBounds, layoutLanes, minutesLabel, occupancy, snapMinutes, toLocalDateTime } from "./grid";

describe("Agenda grid: where each booking goes [AGD-16] [AGD-28]", () => {
  it("reads the business-local wall clock of a booking, clipped to the day shown", () => {
    expect(dayMinutes("2026-09-28T10:00:00+02:00", "2026-09-28T10:30:00+02:00", "2026-09-28")).toEqual({ startMin: 600, endMin: 630 });
    // A dinner from 23:00 to 00:30 shows on both days.
    expect(dayMinutes("2026-09-28T23:00:00+02:00", "2026-09-29T00:30:00+02:00", "2026-09-28")).toEqual({ startMin: 1380, endMin: 1440 });
    expect(dayMinutes("2026-09-28T23:00:00+02:00", "2026-09-29T00:30:00+02:00", "2026-09-29")).toEqual({ startMin: 0, endMin: 30 });
    expect(dayMinutes("2026-09-28T10:00:00+02:00", "2026-09-28T10:30:00+02:00", "2026-09-29")).toBeNull();
  });

  it("puts overlapping bookings side by side and the rest full width", () => {
    const lanes = layoutLanes([
      { id: "a", startMin: 600, endMin: 660 },
      { id: "b", startMin: 630, endMin: 690 },
      { id: "c", startMin: 700, endMin: 730 },
      { id: "d", startMin: 600, endMin: 620 },
    ]);
    // «d» ends before «b» starts, so «b» reuses its lane: two lanes are enough.
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 1 });
  });

  it("the grid spans the opening hours and any booking outside them, in whole hours", () => {
    expect(gridBounds([{ startMin: 540, endMin: 1200 }], [])).toEqual({ startMin: 480, endMin: 1260 });
    expect(gridBounds([{ startMin: 570, endMin: 1190 }], [{ startMin: 1260, endMin: 1290 }])).toEqual({ startMin: 480, endMin: 1380 });
    expect(gridBounds([], [])).toEqual({ startMin: 480, endMin: 1260 });
    expect(gridBounds([{ startMin: 0, endMin: 1440 }], [])).toEqual({ startMin: 0, endMin: 1440 });
  });

  it("snaps a dragged time to the slot interval and writes it for the server", () => {
    expect(snapMinutes(607, 15)).toBe(600);
    expect(snapMinutes(608, 15)).toBe(615);
    expect(snapMinutes(-10, 15)).toBe(0);
    expect(snapMinutes(1500, 30)).toBe(1440);
    expect(toLocalDateTime("2026-09-28", 615)).toBe("2026-09-28T10:15");
    expect(toLocalDateTime("2026-09-28", 1440)).toBe("2026-09-29T00:00");
    expect(minutesLabel(545)).toBe("09:05");
    expect(minutesLabel(1440)).toBe("24:00");
  });

  it("says why a drop place cannot work: outside opening hours or taken [AGD-17]", () => {
    const open = [
      { startMin: 540, endMin: 840 },
      { startMin: 960, endMin: 1200 },
    ];
    const others = [{ startMin: 600, endMin: 630 }];
    expect(dropHint({ startMin: 660, endMin: 690 }, open, others, true)).toBeNull();
    expect(dropHint({ startMin: 830, endMin: 860 }, open, others, true)).toBe("Fuera de horario");
    expect(dropHint({ startMin: 615, endMin: 645 }, open, others, true)).toBe("Ocupado");
    // With capacity the server counts people: no «Ocupado» guess here.
    expect(dropHint({ startMin: 615, endMin: 645 }, open, others, false)).toBeNull();
    expect(dropHint({ startMin: 600, endMin: 630 }, [], [], true)).toBe("Fuera de horario");
  });

  it("counts people per slot for the capacity view «6/8» [AGD-11]", () => {
    const items = [
      { startMin: 780, endMin: 870, people: 4 },
      { startMin: 810, endMin: 900, people: 2 },
    ];
    expect(occupancy(items, 780, 900, 30)).toEqual([
      { startMin: 780, people: 4 },
      { startMin: 810, people: 6 },
      { startMin: 840, people: 6 },
      { startMin: 870, people: 2 },
    ]);
    expect(occupancy([], 780, 840, 30)).toEqual([]);
  });
});
