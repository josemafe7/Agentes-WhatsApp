// The loop of `pnpm worker` with a fake tick(): no database needed.
import { describe, expect, it } from "vitest";
import type { TickSummary } from "../../src/server/jobs/tick";
import { runWorkerLoop } from "./worker-loop";

function summary(overrides: Partial<TickSummary>): TickSummary {
  return {
    workerId: "w",
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
    rescheduled: 0,
    lost: 0,
    durationMs: 1,
    stoppedBy: "idle",
    ...overrides,
  };
}

describe("pnpm worker loop", () => {
  it("runs rounds back to back while there is work, rests when idle and stops when asked", async () => {
    const controller = new AbortController();
    const rounds: TickSummary[] = [
      summary({ claimed: 1, completed: 1, stoppedBy: "max_jobs" }),
      summary({ claimed: 1, retried: 1, stoppedBy: "max_jobs" }),
      summary({ stoppedBy: "idle" }),
    ];
    let calls = 0;
    const started = Date.now();
    const logs: string[] = [];
    const result = await runWorkerLoop({
      runTick: async () => {
        const next = rounds[calls++];
        // After the idle round, ask it to stop while it rests.
        if (next.stoppedBy === "idle") setTimeout(() => controller.abort(), 20);
        return next;
      },
      signal: controller.signal,
      idleSleepMs: 60_000,
      log: (line) => logs.push(line),
    });
    expect(result.rounds).toBe(3);
    // Stopping interrupts the rest instead of waiting the full minute.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(logs).toHaveLength(2);
    expect(logs[1]).toContain("1 para reintentar");
  });

  it("does not start a new round once stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await runWorkerLoop({
      runTick: async () => {
        calls++;
        return summary({});
      },
      signal: controller.signal,
      idleSleepMs: 10,
    });
    expect(calls).toBe(0);
    expect(result.rounds).toBe(0);
  });

  it("an error round rests before trying again", async () => {
    const controller = new AbortController();
    const at: number[] = [];
    await runWorkerLoop({
      runTick: async () => {
        at.push(Date.now());
        if (at.length === 2) controller.abort();
        return summary({ stoppedBy: "error", error: "base de datos caída" });
      },
      signal: controller.signal,
      idleSleepMs: 50,
      log: () => {},
    });
    expect(at).toHaveLength(2);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(40);
  });
});
