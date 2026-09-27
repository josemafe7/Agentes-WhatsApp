// Byte ranges of served audio and video ([MED-08]): pure helpers of ./serve.ts.
import { describe, expect, it } from "vitest";
import { acceptsRanges, parseRange, sliceStream } from "./serve";

/** 0, 1, 2… `size - 1` (mod 256) in chunks of `chunk` bytes, noting whether the source was cancelled. */
function source(size: number, chunk: number) {
  const state = { cancelled: false, pulled: 0 };
  let position = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position >= size) return controller.close();
      const length = Math.min(chunk, size - position);
      controller.enqueue(Uint8Array.from({ length }, (_, index) => (position + index) % 256));
      position += length;
      state.pulled += length;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

const read = async (stream: ReadableStream<Uint8Array>) => [...new Uint8Array(await new Response(stream).arrayBuffer())];
const expected = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => (start + index) % 256);

describe("byte ranges [MED-08]", () => {
  it("only audio and video", () => {
    for (const type of ["audio/ogg; codecs=opus", "audio/mpeg", "video/mp4", "VIDEO/WEBM"]) expect(acceptsRanges(type), type).toBe(true);
    for (const type of ["image/png", "application/pdf", "text/html", ""]) expect(acceptsRanges(type), type).toBe(false);
  });

  it("reads one plain range and nothing else", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange(" bytes=500- ", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-10", 1000)).toEqual({ start: 990, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=990-5000", 1000)).toEqual({ start: 990, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
    for (const header of [null, "", "bytes=", "bytes=-", "bytes=9-3", "bytes=0-1,4-5", "bits=0-1", "bytes=0x1-2", `bytes=0-${"9".repeat(30)}`]) {
      expect(parseRange(header, 1000), String(header)).toBeNull();
    }
  });

  it("slices across chunk boundaries and stops reading once the range is out", async () => {
    for (const [start, end] of [
      [0, 0],
      [0, 6],
      [5, 14],
      [7, 7],
      [21, 29],
    ]) {
      const { stream, state } = source(30, 7);
      expect(await read(sliceStream(stream, { start, end })), `${start}-${end}`).toEqual(expected(start, end));
      if (end < 28) expect(state.cancelled, `${start}-${end}`).toBe(true);
    }
    const big = source(10_000_000, 64 * 1024);
    expect(await read(sliceStream(big.stream, { start: 0, end: 9 }))).toEqual(expected(0, 9));
    expect(big.state.pulled).toBeLessThan(1_000_000);
  });
});
