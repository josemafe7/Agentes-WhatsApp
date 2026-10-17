// When each reminder is due ([AGD-24], [AGD-25]): in hours, so many minutes before; in days, at its local time of
// sending so many days before, also across a change of time; and how far a round looks ahead.
import { describe, expect, it } from "vitest";
import { joinReasons } from "./reminders";
import { longestLeadMs, reminderDueAt } from "./reminder-config";

const MADRID = "Europe/Madrid";

describe("the moment of a reminder [AGD-24]", () => {
  it("in hours: so many minutes before the booking", () => {
    expect(reminderDueAt({ kind: "hours", minutes: 120 }, new Date("2026-09-29T08:00:00Z"), MADRID).toISOString()).toBe("2026-09-29T06:00:00.000Z");
  });

  it("in days: at its local time, the clock already changed back on 25 October", () => {
    // A booking on Monday 26 October at 10:00 (UTC+1), reminded the day before at 10:00 — Sunday 25, already UTC+1.
    expect(reminderDueAt({ kind: "days", days: 1, at: "10:00" }, new Date("2026-10-26T09:00:00Z"), MADRID).toISOString()).toBe("2026-10-25T09:00:00.000Z");
    // Two days before, at 10:00 of Saturday 24, still UTC+2.
    expect(reminderDueAt({ kind: "days", days: 2, at: "10:00" }, new Date("2026-10-26T09:00:00Z"), MADRID).toISOString()).toBe("2026-10-24T08:00:00.000Z");
  });

  it("a round looks as far ahead as the longest reminder, a whole day more for those in days", () => {
    expect(longestLeadMs([{ id: "a", lead: { kind: "hours", minutes: 120 }, routes: ["email"], whatsapp: null, telegram: null, email: null }])).toBe(120 * 60_000);
    expect(longestLeadMs([{ id: "b", lead: { kind: "days", days: 2, at: "10:00" }, routes: ["email"], whatsapp: null, telegram: null, email: null }])).toBe(3 * 24 * 60 * 60_000);
  });

  it("why it did not go, in a few words: each reason once, joined with «y» [AGD-25]", () => {
    expect(joinReasons(["Sin permiso de avisos", "Sin email", "Sin permiso de avisos"])).toBe("Sin permiso de avisos y sin email");
    expect(joinReasons(["Ha bloqueado el bot"])).toBe("Ha bloqueado el bot");
  });
});
