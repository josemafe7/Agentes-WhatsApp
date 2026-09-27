import { describe, expect, it } from "vitest";
import { aiStateOf, formatFileSize, formatUntil, windowRemaining } from "./presentation";
import { buildTimeline, dayLabel, mergeMessages } from "./timeline";

const TZ = "Europe/Madrid";
// Tuesday 29 September 2026, 16:00 in Madrid.
const NOW = new Date("2026-09-29T14:00:00Z");

type Msg = { id: string; senderType: "contact" | "ai" | "human" | "system"; authorName: string | null; createdAt: Date };
type Note = { id: string; createdAt: Date };
const msg = (id: string, senderType: Msg["senderType"], at: string, authorName: string | null = null): Msg => ({ id, senderType, authorName, createdAt: new Date(at) });
const note = (id: string, at: string): Note => ({ id, createdAt: new Date(at) });

describe("conversation timeline [BAN-05] [BAN-07]", () => {
  it("separates days as «Hoy», «Ayer» or the date, in the business time zone", () => {
    expect(dayLabel(new Date("2026-09-29T06:00:00Z"), TZ, NOW)).toBe("Hoy");
    // 23:30 on Monday in Madrid is still «Ayer», although it is Monday 21:30 UTC.
    expect(dayLabel(new Date("2026-09-28T21:30:00Z"), TZ, NOW)).toBe("Ayer");
    expect(dayLabel(new Date("2026-09-21T10:00:00Z"), TZ, NOW)).toBe("lunes, 21 de septiembre");
    expect(dayLabel(new Date("2025-12-31T10:00:00Z"), TZ, NOW)).toBe("miércoles, 31 de diciembre de 2025");
  });

  it("groups messages of the same author in a row and puts internal notes in their place", () => {
    const messages = [
      msg("m1", "contact", "2026-09-29T08:00:00Z"),
      msg("m2", "contact", "2026-09-29T08:01:00Z"),
      msg("m3", "ai", "2026-09-29T08:02:00Z", "Nuria"),
      msg("m4", "human", "2026-09-29T08:04:00Z", "Aitor"),
      msg("m5", "human", "2026-09-29T08:05:00Z", "Aitor"),
    ];
    const notes = [note("n1", "2026-09-29T08:04:30Z")];
    const timeline = buildTimeline(messages, notes, { timezone: TZ, now: NOW, complete: true });
    expect(timeline.map((item) => (item.kind === "message" ? `${item.message.id}${item.first ? "<" : ""}${item.last ? ">" : ""}` : item.kind === "note" ? item.note.id : item.label))).toEqual([
      "Hoy",
      "m1<",
      "m2>",
      "m3<>",
      "m4<>",
      "n1",
      "m5<>",
    ]);
  });

  it("a new day starts a new group, and system messages stand alone", () => {
    const timeline = buildTimeline(
      [
        msg("a", "contact", "2026-09-28T20:00:00Z"),
        msg("b", "contact", "2026-09-29T07:00:00Z"),
        msg("s1", "system", "2026-09-29T07:01:00Z"),
        msg("s2", "system", "2026-09-29T07:02:00Z"),
      ],
      [],
      { timezone: TZ, now: NOW, complete: true },
    );
    expect(timeline.map((item) => (item.kind === "day" ? item.label : item.kind === "message" ? `${item.message.id}${item.first ? "<" : ""}${item.last ? ">" : ""}` : ""))).toEqual([
      "Ayer",
      "a<>",
      "Hoy",
      "b<>",
      "s1<>",
      "s2<>",
    ]);
  });

  it("notes older than the loaded messages wait until the older messages are loaded", () => {
    const messages = [msg("m1", "contact", "2026-09-29T08:00:00Z")];
    const notes = [note("old", "2026-09-20T08:00:00Z"), note("new", "2026-09-29T09:00:00Z")];
    const partial = buildTimeline(messages, notes, { timezone: TZ, now: NOW, complete: false });
    expect(partial.filter((item) => item.kind === "note").map((item) => (item.kind === "note" ? item.note.id : ""))).toEqual(["new"]);
    const complete = buildTimeline(messages, notes, { timezone: TZ, now: NOW, complete: true });
    expect(complete.filter((item) => item.kind === "note").map((item) => (item.kind === "note" ? item.note.id : ""))).toEqual(["old", "new"]);
  });

  it("older pages and fresh ones merge without repeats, oldest first", () => {
    const older = [msg("a", "contact", "2026-09-29T08:00:00Z"), msg("b", "contact", "2026-09-29T08:01:00Z")];
    const latest = [msg("b", "contact", "2026-09-29T08:01:00Z"), msg("c", "ai", "2026-09-29T08:02:00Z", "Nuria")];
    expect(mergeMessages(older, latest).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("AI state, pauses and the WhatsApp window [BAN-08] [BAN-10] [BAN-11]", () => {
  it("the AI answers, is paused while the pause lasts, or a person has it", () => {
    expect(aiStateOf({ aiMode: "ai", aiPausedUntil: null }, NOW)).toEqual({ kind: "ai" });
    const until = new Date(NOW.getTime() + 60_000);
    expect(aiStateOf({ aiMode: "ai", aiPausedUntil: until }, NOW)).toEqual({ kind: "paused", until });
    expect(aiStateOf({ aiMode: "ai", aiPausedUntil: new Date(NOW.getTime() - 1) }, NOW)).toEqual({ kind: "ai" });
    expect(aiStateOf({ aiMode: "human", aiPausedUntil: until }, NOW)).toEqual({ kind: "human" });
  });

  it("says until when (DESIGN.md: «IA en pausa hasta 18:40»): the time today, «mañana a las…» or the date", () => {
    expect(formatUntil(new Date("2026-09-29T16:40:00Z"), TZ, NOW)).toBe("18:40");
    expect(formatUntil(new Date("2026-09-30T04:40:00Z"), TZ, NOW)).toBe("mañana a las 06:40");
    expect(formatUntil(new Date("2026-10-12T08:00:00Z"), TZ, NOW)).toBe("el 12 oct a las 10:00");
  });

  it("the window shows what is left, in hours and minutes", () => {
    expect(windowRemaining(new Date(NOW.getTime() + (3 * 60 + 12) * 60_000), NOW)).toBe("3 h 12 min");
    expect(windowRemaining(new Date(NOW.getTime() + 45 * 60_000), NOW)).toBe("45 min");
    expect(windowRemaining(new Date(NOW.getTime() + 20_000), NOW)).toBe("menos de 1 min");
  });

  it("file sizes in Spanish", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(340 * 1024)).toBe("340 kB");
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe("1,3 MB");
  });
});
