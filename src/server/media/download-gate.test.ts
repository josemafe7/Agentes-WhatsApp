import { describe, expect, it } from "vitest";
import { inboundMediaGate, MEDIA_DOWNLOAD_CONCURRENCY, MEDIA_DOWNLOAD_MEMORY_BYTES, MediaBusyError, MemoryGate } from "./download-gate";
import { INBOUND_MEDIA_CAPS } from "./limits";

const MB = 1024 * 1024;
/** Lets the promises that are ready settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("files held in memory while they download, per process [WA-41]", () => {
  it("never more at once than allowed, nor more reserved bytes than the budget; the next one waits its turn", async () => {
    const gate = new MemoryGate(100 * MB, 2);
    const order: string[] = [];
    const first = await gate.acquire(60 * MB, 1_000);
    const second = await gate.acquire(30 * MB, 1_000);
    // A third would pass both the count and the budget: it waits.
    const third = gate.acquire(5 * MB, 1_000).then((release) => {
      order.push("third");
      return release;
    });
    await settle();
    expect(order).toEqual([]);
    expect(gate.usage()).toEqual({ active: 2, reservedBytes: 90 * MB, waiting: 1 });
    second();
    // Releasing twice gives the place back only once.
    second();
    expect((await third)()).toBeUndefined();
    expect(order).toEqual(["third"]);
    first();
    expect(gate.usage()).toEqual({ active: 0, reservedBytes: 0, waiting: 0 });
  });

  it("in order of arrival: a big file is not overtaken for ever by small ones", async () => {
    const gate = new MemoryGate(100 * MB, 3);
    const order: string[] = [];
    const noted = (name: string) => (release: () => void) => {
      order.push(name);
      return release;
    };
    const running = await gate.acquire(60 * MB, 1_000);
    const big = gate.acquire(60 * MB, 1_000).then(noted("big"));
    const small = gate.acquire(1 * MB, 1_000).then(noted("small"));
    await settle();
    expect(order).toEqual([]);
    running();
    (await big)();
    (await small)();
    expect(order).toEqual(["big", "small"]);
  });

  it("alone, any file may go, even one bigger than the budget", async () => {
    const gate = new MemoryGate(10 * MB, 2);
    const release = await gate.acquire(50 * MB, 1_000);
    expect(gate.usage()).toMatchObject({ active: 1 });
    release();
  });

  it("a download that cannot get its turn in time gives up with an error the job retries later, and leaves the queue", async () => {
    const gate = new MemoryGate(100 * MB, 1);
    const busy = await gate.acquire(1 * MB, 1_000);
    await expect(gate.acquire(1 * MB, 20)).rejects.toBeInstanceOf(MediaBusyError);
    expect(gate.usage()).toEqual({ active: 1, reservedBytes: 1 * MB, waiting: 0 });
    busy();
  });

  it("the process-wide gate fits Meta's biggest document next to a voice note and an image, and is shared by every copy of the module", () => {
    expect(inboundMediaGate()).toBe(inboundMediaGate());
    expect(INBOUND_MEDIA_CAPS.document + INBOUND_MEDIA_CAPS.audio + INBOUND_MEDIA_CAPS.image).toBeLessThanOrEqual(MEDIA_DOWNLOAD_MEMORY_BYTES);
    expect(MEDIA_DOWNLOAD_CONCURRENCY).toBeGreaterThanOrEqual(2);
    // Two of Meta's biggest documents never sit in memory together.
    expect(2 * INBOUND_MEDIA_CAPS.document).toBeGreaterThan(MEDIA_DOWNLOAD_MEMORY_BYTES);
  });
});
