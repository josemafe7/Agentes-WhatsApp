import { describe, expect, it } from "vitest";
import { countOf, formatDuration, formatPercent, percentOf, roundPercent, toMinutes } from "./format";

describe("[INF-05] times until the first human answer", () => {
  it.each([
    [0, "0 s"],
    [45_000, "45 s"],
    [59_600, "1 min"],
    [121_000, "2 min 1 s"],
    [150_000, "2 min 30 s"],
    [180_000, "3 min"],
    [599_000, "9 min 59 s"],
    [630_000, "11 min"],
    [3_599_000, "1 h"],
    [3_900_000, "1 h 5 min"],
    [90_000_000, "1 d 1 h"],
    [172_800_000, "2 d"],
    [-5_000, "0 s"],
  ])("%i ms is «%s»", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it("gives minutes with two decimals for charts and spreadsheets", () => {
    expect(toMinutes(150_000)).toBe(2.5);
    expect(toMinutes(121_000)).toBe(2.02);
    expect(toMinutes(0)).toBe(0);
  });
});

describe("[INF-03] [INF-05] shares", () => {
  it("is the share of the whole, or nothing when there is no whole", () => {
    expect(percentOf(3, 8)).toBe(37.5);
    expect(percentOf(0, 4)).toBe(0);
    expect(percentOf(0, 0)).toBeNull();
  });

  it("is written in Spanish with at most one decimal, and «—» without a share", () => {
    expect(formatPercent(37.5)).toMatch(/^37,5\s%$/);
    expect(formatPercent(200 / 7)).toMatch(/^28,6\s%$/);
    expect(formatPercent(100)).toMatch(/^100\s%$/);
    expect(formatPercent(null)).toBe("—");
    expect(roundPercent(200 / 7)).toBe(28.6);
    expect(roundPercent(null)).toBeNull();
  });

  it("counts in singular and plural", () => {
    expect(countOf(1, "mensaje", "mensajes")).toBe("1 mensaje");
    expect(countOf(2, "mensaje", "mensajes")).toBe("2 mensajes");
    expect(countOf(12_345, "mensaje", "mensajes")).toBe("12.345 mensajes");
  });
});
