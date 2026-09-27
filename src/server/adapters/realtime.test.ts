import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { realtimeEvents } from "@/db/schema";
import { PgRealtime } from "./realtime";

let nowMs = new Date("2026-09-26T10:00:00Z").getTime();
const realtime = new PgRealtime({ now: () => new Date(nowMs) });

beforeEach(async () => {
  await db.delete(realtimeEvents);
});

describe("Realtime (polling) [BAN-03]", () => {
  it("a new client starts at the current head and then receives only later events", async () => {
    await realtime.publish("inbox", { old: true });
    const start = await realtime.poll(null, ["inbox"]);
    expect(start.events).toEqual([]);

    await realtime.publish("inbox", { conversationId: "c1" });
    await realtime.publish("conversation:c1", { messageId: "m1" });
    const next = await realtime.poll(start.cursor, ["inbox", "conversation:c1"]);
    expect(next.events.map((e) => e.payload)).toEqual([{ conversationId: "c1" }, { messageId: "m1" }]);
    expect(Number(next.cursor)).toBeGreaterThan(Number(start.cursor));

    const again = await realtime.poll(next.cursor, ["inbox", "conversation:c1"]);
    expect(again.events).toEqual([]);
    expect(again.cursor).toBe(next.cursor);
  });

  it("filters by topic but still moves the cursor past other topics", async () => {
    const { cursor } = await realtime.poll(null, ["inbox"]);
    await realtime.publish("conversation:secret", { x: 1 });
    await realtime.publish("inbox", { y: 2 });
    const result = await realtime.poll(cursor, ["inbox"]);
    expect(result.events.map((e) => e.topic)).toEqual(["inbox"]);
    await realtime.publish("conversation:secret", { x: 3 });
    const later = await realtime.poll(result.cursor, ["inbox"]);
    expect(later.events).toEqual([]);
    expect(Number(later.cursor)).toBeGreaterThan(Number(result.cursor));
  });

  it("pages with the limit without losing events", async () => {
    const { cursor } = await realtime.poll(null, ["t"]);
    for (let i = 0; i < 5; i++) await realtime.publish("t", { i });
    const page1 = await realtime.poll(cursor, ["t"], 3);
    const page2 = await realtime.poll(page1.cursor, ["t"], 3);
    expect([...page1.events, ...page2.events].map((e) => (e.payload as { i: number }).i)).toEqual([0, 1, 2, 3, 4]);
  });

  it("assigns strictly growing cursors under concurrent publishing", async () => {
    const events = await Promise.all(Array.from({ length: 10 }, (_, i) => realtime.publish("t", { i })));
    const cursors = events.map((e) => Number(e.cursor)).sort((a, b) => a - b);
    expect(new Set(cursors).size).toBe(10);
  });

  it("seq strictly increases across publishes in separate transactions, and a rolled back one leaves no hole", async () => {
    const inTransactions = await Promise.all(Array.from({ length: 5 }, (_, i) => db.transaction((tx) => realtime.publish("t", { i }, tx))));
    const own = await realtime.publish("t", { own: true });
    const cursors = [...inTransactions, own].map((event) => Number(event.cursor));
    expect(new Set(cursors).size).toBe(6);
    expect(Math.max(...cursors)).toBe(Number(own.cursor));

    await expect(
      db.transaction(async (tx) => {
        await realtime.publish("t", { rolledBack: true }, tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const next = await realtime.publish("t", {});
    expect(Number(next.cursor)).toBe(Number(own.cursor) + 1);
    const { events } = await realtime.poll(String(Math.min(...cursors) - 1), ["t"]);
    expect(events.map((event) => Number(event.cursor))).toEqual([...[...cursors].sort((a, b) => a - b), Number(next.cursor)]);
  });

  it("an invalid or future cursor restarts from the head", async () => {
    await realtime.publish("t", {});
    const head = await realtime.poll(null, ["t"]);
    expect(await realtime.poll("abc", ["t"])).toEqual({ events: [], cursor: head.cursor });
    expect(await realtime.poll("999999", ["t"])).toEqual({ events: [], cursor: head.cursor });
  });

  it("retention clean-up deletes old events but keeps the newest one", async () => {
    await realtime.publish("t", { a: 1 });
    await realtime.publish("t", { a: 2 });
    nowMs += 3_600_000;
    await realtime.publish("t", { a: 3 });
    expect(await realtime.deleteBefore(new Date(nowMs - 60_000))).toBe(2);
    expect(await db.select().from(realtimeEvents)).toHaveLength(1);
    expect(await realtime.deleteBefore(new Date(nowMs + 60_000))).toBe(0);
  });
});
