import { describe, expect, it } from "vitest";
import { createRealtimeClient, nextPollDelay, POLL, type RealtimeEvent } from "./use-realtime";

describe("how often screens ask for news [BAN-03]", () => {
  it("every 3–5 s while the person is active: 4 s, or 3 s right after news", () => {
    expect(nextPollDelay({ idleForMs: 0, failures: 0, hadEvents: false })).toBe(4_000);
    expect(nextPollDelay({ idleForMs: 59_000, failures: 0, hadEvents: true })).toBe(3_000);
    for (const delay of [POLL.baseMs, POLL.busyMs]) {
      expect(delay).toBeGreaterThanOrEqual(3_000);
      expect(delay).toBeLessThanOrEqual(5_000);
    }
  });

  it("while nobody touches the screen it asks a little less, but never later than 5 s: news shows within 5 s", () => {
    expect(nextPollDelay({ idleForMs: 60_000, failures: 0, hadEvents: false })).toBe(5_000);
    expect(nextPollDelay({ idleForMs: 120_000, failures: 0, hadEvents: false })).toBe(5_000);
    expect(nextPollDelay({ idleForMs: 10 * 60 * 60_000, failures: 0, hadEvents: false })).toBe(5_000);
    for (const idleForMs of [0, 30_000, 60_000, 5 * 60_000, 24 * 60 * 60_000]) {
      for (const hadEvents of [false, true]) expect(nextPollDelay({ idleForMs, failures: 0, hadEvents })).toBeLessThanOrEqual(5_000);
    }
  });

  it("waits longer after each failure, up to 30 s", () => {
    expect(nextPollDelay({ idleForMs: 0, failures: 1, hadEvents: false })).toBe(8_000);
    expect(nextPollDelay({ idleForMs: 0, failures: 2, hadEvents: false })).toBe(16_000);
    expect(nextPollDelay({ idleForMs: 0, failures: 9, hadEvents: false })).toBe(30_000);
  });
});

type Reply = { status: number; body?: unknown } | Error;

function harness(replies: Reply[]) {
  const calls: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let clock = 1_000_000;
  let visible = true;
  const client = createRealtimeClient({
    fetchImpl: async (input) => {
      calls.push(String(input));
      const reply = replies.shift() ?? { status: 200, body: { cursor: "9", events: [] } };
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
    },
    now: () => clock,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    isVisible: () => visible,
  });
  const pending = () => timers.filter((timer) => !timer.cleared);
  /** Runs the next pending timer and lets the poll finish. */
  const tick = async () => {
    const timer = pending()[0];
    if (!timer) throw new Error("no hay ningún sondeo programado");
    timer.cleared = true;
    clock += timer.ms;
    timer.fn();
    await settle();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    client,
    calls,
    pending,
    tick,
    settle,
    advance: (ms: number) => {
      clock += ms;
    },
    setVisible: (value: boolean) => {
      visible = value;
      client.setVisible(value);
    },
  };
}

const event = (cursor: string, conversationId = "c-1"): RealtimeEvent => ({
  type: "conversation.updated",
  cursor,
  conversationId,
  channelId: "ch-1",
  change: "inbound",
});

describe("realtime client [BAN-03]", () => {
  it("starts from now, then asks after its cursor and hands the news to every screen listening", async () => {
    const h = harness([
      { status: 200, body: { cursor: "5", events: [] } },
      { status: 200, body: { cursor: "7", events: [event("6"), event("7", "c-2")] } },
    ]);
    const received: RealtimeEvent[][] = [];
    const other: RealtimeEvent[][] = [];
    h.client.subscribe((events) => received.push(events));
    h.client.subscribe((events) => other.push(events));
    await h.settle();
    expect(h.calls).toEqual(["/api/realtime"]);
    expect(h.client.getStatus()).toBe("online");
    expect(h.pending()[0]?.ms).toBe(4_000);
    await h.tick();
    expect(h.calls[1]).toBe("/api/realtime?cursor=5");
    expect(received).toEqual([[event("6"), event("7", "c-2")]]);
    expect(other).toHaveLength(1);
    // Right after news it asks sooner.
    expect(h.pending()[0]?.ms).toBe(3_000);
    await h.tick();
    expect(h.calls[2]).toBe("/api/realtime?cursor=7");
  });

  it("only one poll runs for all the screens of the tab", async () => {
    const h = harness([]);
    h.client.subscribe(() => undefined);
    h.client.subscribe(() => undefined);
    await h.settle();
    expect(h.calls).toHaveLength(1);
    expect(h.pending()).toHaveLength(1);
  });

  it("stops while the tab is hidden and asks at once when it is shown again", async () => {
    const h = harness([]);
    h.client.subscribe(() => undefined);
    await h.settle();
    h.setVisible(false);
    expect(h.pending()).toHaveLength(0);
    await h.settle();
    expect(h.calls).toHaveLength(1);
    h.setVisible(true);
    await h.settle();
    expect(h.calls).toHaveLength(2);
    expect(h.pending()).toHaveLength(1);
  });

  it("while nobody touches the screen it waits a little longer (never over 5 s), and activity brings it back at once", async () => {
    const h = harness([]);
    h.client.subscribe(() => undefined);
    await h.settle();
    h.advance(3 * 60_000);
    await h.tick();
    expect(h.pending()[0]?.ms).toBe(5_000);
    h.client.markActive();
    await h.settle();
    expect(h.calls).toHaveLength(3);
    expect(h.pending()[0]?.ms).toBe(4_000);
  });

  it("without connection it says so, keeps retrying with longer waits and recovers", async () => {
    const h = harness([new Error("sin red"), { status: 503 }, { status: 200, body: { cursor: "3", events: [] } }]);
    h.client.subscribe(() => undefined);
    await h.settle();
    expect(h.client.getStatus()).toBe("offline");
    expect(h.pending()[0]?.ms).toBe(8_000);
    await h.tick();
    expect(h.client.getStatus()).toBe("offline");
    expect(h.pending()[0]?.ms).toBe(16_000);
    await h.tick();
    expect(h.client.getStatus()).toBe("online");
    expect(h.pending()[0]?.ms).toBe(4_000);
  });

  it("stops when the session is gone", async () => {
    const h = harness([{ status: 401, body: { error: "Tu sesión ha caducado. Vuelve a entrar." } }]);
    h.client.subscribe(() => undefined);
    await h.settle();
    expect(h.client.getStatus()).toBe("stopped");
    expect(h.pending()).toHaveLength(0);
  });

  it("ignores answers that are not what the server sends", async () => {
    const h = harness([
      { status: 200, body: { cursor: "5", events: [] } },
      { status: 200, body: { cursor: "x; drop", events: [{ type: 42 }] } },
    ]);
    const received: RealtimeEvent[][] = [];
    h.client.subscribe((events) => received.push(events));
    await h.settle();
    await h.tick();
    expect(received).toEqual([]);
    await h.tick();
    expect(h.calls[2]).toBe("/api/realtime?cursor=5");
  });

  it("asks right away when a screen needs it (after a change), and stops when nobody listens", async () => {
    const h = harness([]);
    const unsubscribe = h.client.subscribe(() => undefined);
    await h.settle();
    h.client.pollNow();
    await h.settle();
    expect(h.calls).toHaveLength(2);
    unsubscribe();
    expect(h.pending()).toHaveLength(0);
    h.client.pollNow();
    await h.settle();
    expect(h.calls).toHaveLength(2);
  });
});
