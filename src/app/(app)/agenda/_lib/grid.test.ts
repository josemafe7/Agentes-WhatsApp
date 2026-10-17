import { describe, expect, it } from "vitest";
import { bookingCardRows, dayMinutes, dropHint, foldedStretches, gridBounds, gridScale, layoutCappedLanes, layoutLanes, minutesLabel, occupancy, snapMinutes, toLocalDateTime } from "./grid";

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

  it("[AGD-30] the grid goes from the first opening to the last closing, widened only for a booking outside them", () => {
    expect(gridBounds([{ startMin: 540, endMin: 1200 }], [])).toEqual({ startMin: 540, endMin: 1200 });
    expect(gridBounds([{ startMin: 570, endMin: 1190 }], [{ startMin: 1260, endMin: 1290 }])).toEqual({ startMin: 570, endMin: 1290 });
    expect(gridBounds([{ startMin: 600, endMin: 840 }], [{ startMin: 510, endMin: 540 }])).toEqual({ startMin: 510, endMin: 840 });
    // Nothing open in the days shown: 09:00 to 20:00.
    expect(gridBounds([], [])).toEqual({ startMin: 540, endMin: 1200 });
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

  it("[AGD-30] folds a stretch closed on every day shown, with nothing hidden in it", () => {
    const bounds = { startMin: 480, endMin: 1260 };
    const week = [
      { open: [{ startMin: 480, endMin: 840 }, { startMin: 930, endMin: 1260 }] },
      { open: [{ startMin: 600, endMin: 840 }, { startMin: 960, endMin: 1200 }] },
      // Closed all day (a Sunday or a holiday): closed at that time too.
      { open: [] },
    ];
    expect(foldedStretches(week, bounds, [], [])).toEqual([{ startMin: 840, endMin: 930, label: "Cerrado de 14:00 a 15:30" }]);
    // A booking in the stretch keeps it open, so no booking is ever hidden.
    expect(foldedStretches(week, bounds, [{ startMin: 870, endMin: 900 }], [])).toEqual([]);
    // A block or an absence in the stretch, even one that goes on beyond it (a whole day), keeps it open too.
    expect(foldedStretches(week, bounds, [], [{ startMin: 850, endMin: 880 }])).toEqual([]);
    expect(foldedStretches(week, bounds, [], [{ startMin: 0, endMin: 1440 }])).toEqual([]);
    // A stretch open on one day (the other closes from 14:00 to 15:30 only) is not folded; a short one is not worth it.
    expect(foldedStretches([{ open: [{ startMin: 480, endMin: 1260 }] }, week[0]], bounds, [], [])).toEqual([]);
    expect(foldedStretches([{ open: [{ startMin: 480, endMin: 840 }, { startMin: 870, endMin: 1260 }] }], bounds, [], [])).toEqual([]);
  });

  it("[AGD-30] turns minutes into height and back across a folded stretch, linear inside the open parts", () => {
    const bounds = { startMin: 480, endMin: 1260 };
    const fold = { startMin: 840, endMin: 930, label: "Cerrado de 14:00 a 15:30" };
    const scale = gridScale(bounds, [fold], 1, 24);
    expect(scale.height).toBe(360 + 24 + 330);
    expect(scale.toY(480)).toBe(0);
    expect(scale.toY(600)).toBe(120);
    expect(scale.toY(840)).toBe(360);
    expect(scale.toY(930)).toBe(384);
    expect(scale.toY(1000)).toBe(454);
    expect(scale.toMinute(120)).toBe(600);
    expect(scale.toMinute(454)).toBe(1000);
    // On the fold: its start in the upper half, its end in the lower one.
    expect(scale.toMinute(365)).toBe(840);
    expect(scale.toMinute(380)).toBe(930);
    expect(scale.foldAt(370)).toEqual(fold);
    expect(scale.foldAt(300)).toBeNull();
    const plain = gridScale(bounds, [], 64 / 60, 24);
    expect(plain.toY(540)).toBeCloseTo(64);
    expect(plain.toMinute(64)).toBeCloseTo(540);
  });

  it("[AGD-29] with more than three bookings at once, shows three and keeps the rest for «+N»", () => {
    const at = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });
    const layout = layoutCappedLanes([at("a", 600, 660), at("b", 600, 660), at("c", 610, 640), at("d", 620, 650), at("e", 630, 700), at("f", 720, 750)], 3);
    expect(layout.lanes.get("a")).toEqual({ lane: 0, lanes: 3, overflow: true });
    expect(layout.lanes.get("c")).toEqual({ lane: 2, lanes: 3, overflow: true });
    expect(layout.lanes.has("d")).toBe(false);
    expect(layout.lanes.has("e")).toBe(false);
    expect(layout.overflow).toEqual([{ key: "d:more", startMin: 620, endMin: 700, ids: ["d", "e"] }]);
    expect(layout.lanes.get("f")).toEqual({ lane: 0, lanes: 1, overflow: false });
    // Bookings one after the other are never «at once», however long the chain.
    const chain = layoutCappedLanes([at("a", 600, 660), at("b", 640, 700), at("c", 680, 740), at("d", 720, 780), at("e", 760, 820)], 3);
    expect(chain.overflow).toEqual([]);
  });

  it("[AGD-29] a booking shows its time, name and service; narrower, the time and the first name, never cut in a word", () => {
    const upTo = (chars: number) => (text: string) => text.length <= chars;
    const card = { time: "10:00", timeRange: "10:00–10:45", who: "Marta Gil Sánchez", service: "Sesión de fisioterapia · Álvaro", serviceOnly: "Sesión de fisioterapia" };
    expect(bookingCardRows({ ...card, lines: 3, fits: upTo(60) })).toEqual(["10:00–10:45", "Marta Gil Sánchez", "Sesión de fisioterapia · Álvaro"]);
    // The professional goes before the service is shortened; then the service is cut at a whole word.
    expect(bookingCardRows({ ...card, lines: 3, fits: upTo(22) })).toEqual(["10:00–10:45", "Marta Gil Sánchez", "Sesión de fisioterapia"]);
    expect(bookingCardRows({ ...card, lines: 3, fits: upTo(12) })).toEqual(["10:00–10:45", "Marta Gil…", "Sesión de…"]);
    expect(bookingCardRows({ ...card, lines: 2, fits: upTo(60) })).toEqual(["10:00 Marta Gil Sánchez", "Sesión de fisioterapia · Álvaro"]);
    expect(bookingCardRows({ ...card, lines: 2, fits: upTo(12) })).toEqual(["10:00 Marta…", "Sesión de…"]);
    // Too narrow for the time and the first name on one line: one under the other.
    expect(bookingCardRows({ ...card, lines: 2, fits: upTo(7) })).toEqual(["10:00", "Marta…"]);
    expect(bookingCardRows({ ...card, lines: 1, fits: upTo(60) })).toEqual(["10:00 Marta Gil Sánchez · Sesión de fisioterapia"]);
    expect(bookingCardRows({ ...card, lines: 1, fits: upTo(20) })).toEqual(["10:00 Marta Gil…"]);
    // One short line with no room for both: the first name, which the hour lines cannot tell.
    expect(bookingCardRows({ ...card, lines: 1, fits: upTo(7) })).toEqual(["Marta…"]);
    // Not even one word fits: the time if it does, or «…»; never part of a word.
    expect(bookingCardRows({ ...card, lines: 1, fits: upTo(5) })).toEqual(["10:00"]);
    expect(bookingCardRows({ ...card, lines: 1, fits: upTo(3) })).toEqual(["…"]);
    expect(bookingCardRows({ ...card, lines: 3, fits: upTo(5) })).toEqual(["10:00", "…", "…"]);
  });
});
