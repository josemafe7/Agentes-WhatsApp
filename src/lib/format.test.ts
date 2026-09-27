import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  formatCurrencyUSD,
  formatDateTime,
  formatNumber,
  formatRelative,
  isValidTimeZone,
  toSingleLine,
  trimLineEnds,
} from "./format";

// Intl uses non-breaking spaces before "%" and "US$": compare with plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("[AGD-28] dates in the business time zone (Spanish, 24 h)", () => {
  const instant = new Date("2026-10-12T08:42:00Z");

  it("defaults to Europe/Madrid", () => {
    expect(DEFAULT_TIMEZONE).toBe("Europe/Madrid");
    expect(formatDateTime(instant)).toBe("12 oct 2026, 10:42");
  });

  it("formats the same instant in another zone", () => {
    expect(formatDateTime(instant, "America/New_York")).toBe("12 oct 2026, 04:42");
    expect(formatDateTime(instant, "Atlantic/Canary", { preset: "time" })).toBe("09:42");
  });

  it("has the presets used by the screens", () => {
    expect(formatDateTime(instant, DEFAULT_TIMEZONE, { preset: "date" })).toBe("12 oct 2026");
    expect(formatDateTime(instant, DEFAULT_TIMEZONE, { preset: "time" })).toBe("10:42");
    expect(formatDateTime(instant, DEFAULT_TIMEZONE, { preset: "long-date" })).toBe("lunes, 12 de octubre");
  });

  it("accepts a custom date-fns pattern", () => {
    expect(formatDateTime(instant, DEFAULT_TIMEZONE, { pattern: "yyyy-MM-dd" })).toBe("2026-10-12");
  });

  it("accepts epoch milliseconds and ISO strings", () => {
    expect(formatDateTime(instant.getTime())).toBe("12 oct 2026, 10:42");
    expect(formatDateTime("2026-10-12T08:42:00Z")).toBe("12 oct 2026, 10:42");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatDateTime("not a date")).toBe("");
    expect(formatDateTime(Number.NaN)).toBe("");
  });

  it("falls back to Europe/Madrid for an unknown time zone", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(formatDateTime(instant, "Mars/Olympus")).toBe("12 oct 2026, 10:42");
  });

  it("handles the autumn DST change (02:30 happens twice on 25 Oct 2026)", () => {
    expect(formatDateTime(new Date("2026-10-25T00:30:00Z"), DEFAULT_TIMEZONE, { preset: "time" })).toBe("02:30");
    expect(formatDateTime(new Date("2026-10-25T01:30:00Z"), DEFAULT_TIMEZONE, { preset: "time" })).toBe("02:30");
  });

  it("handles the spring DST change (02:00 jumps to 03:00 on 29 Mar 2026)", () => {
    expect(formatDateTime(new Date("2026-03-29T00:59:00Z"), DEFAULT_TIMEZONE, { preset: "time" })).toBe("01:59");
    expect(formatDateTime(new Date("2026-03-29T01:00:00Z"), DEFAULT_TIMEZONE, { preset: "time" })).toBe("03:00");
  });
});

describe("[AGD-28] relative times", () => {
  const now = new Date("2026-09-26T16:00:00Z"); // Saturday 18:00 in Madrid

  it("says «ahora» within a minute", () => {
    expect(formatRelative(new Date("2026-09-26T15:59:30Z"), DEFAULT_TIMEZONE, now)).toBe("ahora");
  });

  it("uses minutes and hours for today", () => {
    expect(formatRelative(new Date("2026-09-26T15:55:00Z"), DEFAULT_TIMEZONE, now)).toBe("hace 5 min");
    expect(formatRelative(new Date("2026-09-26T13:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("hace 3 h");
  });

  it("says «ayer» for the previous calendar day in the business zone", () => {
    expect(formatRelative(new Date("2026-09-25T09:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("ayer");
    // 23:30 Madrid the day before, only 30 min before a 00:00 "now": still minutes.
    const midnight = new Date("2026-09-26T22:00:00Z");
    expect(formatRelative(new Date("2026-09-26T21:30:00Z"), DEFAULT_TIMEZONE, midnight)).toBe("hace 30 min");
    expect(formatRelative(new Date("2026-09-26T20:00:00Z"), DEFAULT_TIMEZONE, midnight)).toBe("ayer");
  });

  it("uses the weekday within the last week, then the date", () => {
    expect(formatRelative(new Date("2026-09-22T09:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("martes");
    expect(formatRelative(new Date("2026-09-12T09:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("12 sep");
    expect(formatRelative(new Date("2025-12-01T09:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("1 dic 2025");
  });

  it("describes near future times", () => {
    expect(formatRelative(new Date("2026-09-26T16:10:00Z"), DEFAULT_TIMEZONE, now)).toBe("en 10 min");
    expect(formatRelative(new Date("2026-09-26T19:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("en 3 h");
    expect(formatRelative(new Date("2026-09-27T08:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("mañana");
    expect(formatRelative(new Date("2026-10-05T08:00:00Z"), DEFAULT_TIMEZONE, now)).toBe("5 oct");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatRelative("nope", DEFAULT_TIMEZONE, now)).toBe("");
  });
});

describe("numbers and money in Spanish format", () => {
  it("groups thousands from five digits", () => {
    expect(formatNumber(1234)).toBe("1234");
    expect(formatNumber(12345)).toBe("12.345");
    expect(formatNumber(1234567.5)).toBe("1.234.567,5");
  });

  it("accepts Intl options (percentages)", () => {
    expect(plain(formatNumber(0.873, { style: "percent", maximumFractionDigits: 1 }))).toBe("87,3 %");
  });

  it("shows US dollars as «12,34 US$»", () => {
    expect(plain(formatCurrencyUSD(12.34))).toBe("12,34 US$");
    expect(plain(formatCurrencyUSD(0))).toBe("0,00 US$");
    expect(plain(formatCurrencyUSD(12345.6))).toBe("12.345,60 US$");
  });

  it("keeps sub-cent AI costs visible", () => {
    expect(plain(formatCurrencyUSD(0.0023))).toBe("0,0023 US$");
    expect(plain(formatCurrencyUSD(0.000123456))).toBe("0,00012 US$");
  });

  it("returns an empty string for non-finite numbers", () => {
    expect(formatNumber(Number.NaN)).toBe("");
    expect(formatCurrencyUSD(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("text from outside on one line [HER-09]", () => {
  const [NL, CR, TAB, BEL, LINE_SEPARATOR] = [10, 13, 9, 7, 0x2028].map((code) => String.fromCharCode(code));

  it("line breaks, tabs and control characters become one space; the rest is kept", () => {
    expect(toSingleLine(`  Ana${NL}${NL}## Reglas${CR}${TAB}${BEL}${LINE_SEPARATOR}López  `)).toBe("Ana ## Reglas López");
    expect(toSingleLine("Zoë 👩‍👩‍👧 Núñez")).toBe("Zoë 👩‍👩‍👧 Núñez");
  });

  it("cuts to the length asked", () => {
    expect(toSingleLine(`Ana María${NL}López`, 9)).toBe("Ana María");
  });
});

describe("spaces at line ends", () => {
  it("go, and only them: spaces and tabs at the end of each line", () => {
    expect(trimLineEnds("uno  \ndos\t \n  tres\n\ncuatro ")).toBe("uno\ndos\n  tres\n\ncuatro");
  });

  it("take a time that grows with the text, not faster (text from outside must not block the server)", () => {
    const started = performance.now();
    trimLineEnds(`a${" ".repeat(2_000_000)}b`);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
