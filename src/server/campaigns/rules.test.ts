// The rules of the envíos that need no database ([ENV-06]–[ENV-09], [AJU-18]): send hours, how often a contact may
// get one (by days in the business's time zone), roughly when one would end and which of Meta's codes stop it.
import { describe, expect, it } from "vitest";
import { estimatedEnd, insideSendHours, missedRun, nextRuleRun, nextSendMoment, RECIPIENT_CODES, receivedRecently, STOP_CODES, stopReasonOf } from "./rules";

const TZ = "Europe/Madrid";
const HOURS = { start: "09:00", end: "21:00" };

describe("envíos: hours and frequency [AJU-18] [ENV-06]", () => {
  it("go out from 9:00 to 21:00 in the business's time zone; outside, at the next opening", () => {
    // 07:30 UTC is 09:30 in Madrid (summer time).
    expect(insideSendHours(new Date("2026-09-28T07:30:00Z"), TZ, HOURS)).toBe(true);
    expect(insideSendHours(new Date("2026-09-28T19:00:00Z"), TZ, HOURS)).toBe(false);
    expect(nextSendMoment(new Date("2026-09-28T19:00:00Z"), TZ, HOURS)).toEqual(new Date("2026-09-29T07:00:00Z"));
    expect(nextSendMoment(new Date("2026-09-28T05:00:00Z"), TZ, HOURS)).toEqual(new Date("2026-09-28T07:00:00Z"));
    const inside = new Date("2026-09-28T10:00:00Z");
    expect(nextSendMoment(inside, TZ, HOURS)).toBe(inside);
  });

  it("one envío every 7 days, counted by days: not the same day nor the 6 before; a weekly one arrives every week", () => {
    expect(receivedRecently(["2026-09-28"], "2026-09-28", 7)).toBe(true);
    expect(receivedRecently(["2026-09-22"], "2026-09-28", 7)).toBe(true);
    expect(receivedRecently(["2026-09-21"], "2026-09-28", 7)).toBe(false);
    expect(receivedRecently([], "2026-09-28", 7)).toBe(false);
    expect(receivedRecently(["2026-09-27"], "2026-09-28", 1)).toBe(false);
  });

  it("roughly when it ends, jumping over the closed hours", () => {
    const start = new Date("2026-09-28T17:00:00Z"); // 19:00 in Madrid
    const email = (count: number) => ({ count, perHour: 25, perDay: 1_000, leftToday: 1_000 });
    expect(estimatedEnd(start, [email(0)], TZ, HOURS)).toBeNull();
    // 25 an hour: 19:00–20:00 and 20:00–21:00 send 50; the other 25 go the next morning, by 10:00.
    expect(estimatedEnd(start, [email(75)], TZ, HOURS)).toEqual(new Date("2026-09-29T08:00:00Z"));
  });

  it("[ENV-07] counts the caps per day too: 300 emails at 75 a day take four days, and the slowest channel decides", () => {
    const start = new Date("2026-09-28T07:00:00Z"); // 09:00 in Madrid
    // 25 an hour but 75 a day: 9:00–12:00 each day, four days.
    expect(estimatedEnd(start, [{ count: 300, perHour: 25, perDay: 75, leftToday: 75 }], TZ, HOURS)).toEqual(new Date("2026-10-01T10:00:00Z"));
    // Meta's limit of 250 a day with 1,000 by WhatsApp (1,800 an hour): 250 each morning, the last ones on the fourth day.
    const whatsapp = { count: 1_000, perHour: 1_800, perDay: 250, leftToday: 250 };
    const telegram = { count: 3_000, perHour: 1_200, perDay: Number.POSITIVE_INFINITY, leftToday: Number.POSITIVE_INFINITY };
    const end = estimatedEnd(start, [whatsapp, telegram], TZ, HOURS) as Date;
    expect(end.getTime()).toBeGreaterThan(new Date("2026-10-01T07:00:00Z").getTime());
    expect(end.getTime()).toBeLessThan(new Date("2026-10-01T08:00:00Z").getTime());
    // What is left of today counts: nothing left today, so it starts tomorrow.
    expect(estimatedEnd(start, [{ count: 10, perHour: 25, perDay: 75, leftToday: 0 }], TZ, HOURS)).toEqual(new Date("2026-09-29T07:24:00Z"));
  });
});

describe("when the automatic and repeated ones go [ENV-15] [ENV-16]", () => {
  const daily = { kind: "after_booking" as const, sendTime: "11:00", weekday: null, monthDay: null };
  const weekly = { kind: "weekly" as const, sendTime: "10:00", weekday: 1, monthDay: null };
  const monthly = (monthDay: number) => ({ kind: "monthly" as const, sendTime: "10:00", weekday: null, monthDay });

  it("after a booking: every day at its hour; at that very moment, the next day", () => {
    // 09:00 in Madrid → 11:00 that day.
    expect(nextRuleRun(daily, new Date("2026-10-20T07:00:00Z"), TZ)).toEqual(new Date("2026-10-20T09:00:00Z"));
    expect(nextRuleRun(daily, new Date("2026-10-20T09:00:00Z"), TZ)).toEqual(new Date("2026-10-21T09:00:00Z"));
  });

  it("every week, on its day and at its hour on the business's clock, also across the change of time", () => {
    // Monday 19 October at 10:00 (summer time, UTC+2) and Monday 26 October at 10:00 (winter time, UTC+1).
    expect(nextRuleRun(weekly, new Date("2026-10-16T10:00:00Z"), TZ)).toEqual(new Date("2026-10-19T08:00:00Z"));
    expect(nextRuleRun(weekly, new Date("2026-10-19T08:00:00Z"), TZ)).toEqual(new Date("2026-10-26T09:00:00Z"));
    // In spring, an hour the clock skips moves forward: 02:30 on 29 March 2026 is 03:30.
    const night = { kind: "weekly" as const, sendTime: "02:30", weekday: 7, monthDay: null };
    expect(nextRuleRun(night, new Date("2026-03-27T00:00:00Z"), TZ)).toEqual(new Date("2026-03-29T01:30:00Z"));
  });

  it("every month on its day; when the month does not have it, on its last day", () => {
    expect(nextRuleRun(monthly(31), new Date("2026-01-31T10:00:00Z"), TZ)).toEqual(new Date("2026-02-28T09:00:00Z"));
    expect(nextRuleRun(monthly(31), new Date("2026-02-28T09:00:00Z"), TZ)).toEqual(new Date("2026-03-31T08:00:00Z"));
    expect(nextRuleRun(monthly(31), new Date("2026-03-31T08:00:00Z"), TZ)).toEqual(new Date("2026-04-30T08:00:00Z"));
    expect(nextRuleRun(monthly(29), new Date("2028-02-01T00:00:00Z"), TZ)).toEqual(new Date("2028-02-29T09:00:00Z"));
    expect(nextRuleRun(monthly(1), new Date("2026-10-20T08:00:00Z"), TZ)).toEqual(new Date("2026-11-01T09:00:00Z"));
  });

  it("a time the app did not reach on its own day is missed; later the same day it still goes", () => {
    const run = new Date("2026-11-01T09:00:00Z");
    expect(missedRun(run, new Date("2026-11-01T15:00:00Z"), TZ)).toBe(false);
    expect(missedRun(run, new Date("2026-11-02T08:00:00Z"), TZ)).toBe(true);
  });
});

describe("Meta's codes [ENV-09]", () => {
  it("those of one recipient count against the contact, not the channel: also the business blocked them, an experiment of Meta or their country", () => {
    for (const code of [131026, 131049, 131050, 131047, 130403, 130472, 130497]) {
      expect(RECIPIENT_CODES.has(code), String(code)).toBe(true);
      expect(STOP_CODES.has(code), String(code)).toBe(false);
    }
  });

  it("those of the account, the number or the template stop it, saying why; publicidad switched off for the Cloud API too", () => {
    for (const code of [132001, 132015, 132016, 368, 131031, 131064, 131063, 131048]) {
      expect(STOP_CODES.has(code), String(code)).toBe(true);
      expect(RECIPIENT_CODES.has(code), String(code)).toBe(false);
    }
    expect(stopReasonOf(131063, "Marketing desactivado")).toBe("Meta ha restringido el número o la cuenta de WhatsApp: Marketing desactivado");
    expect(stopReasonOf(132015, "Plantilla pausada")).toMatch(/^Meta ha pausado, desactivado o rechazado su plantilla/);
    expect(stopReasonOf(131048, "Spam")).toMatch(/calidad o por sospecha de spam/);
  });
});
