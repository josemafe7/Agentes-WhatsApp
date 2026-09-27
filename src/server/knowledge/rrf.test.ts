import { describe, expect, it } from "vitest";
import { fuseRrf } from "./rrf";

const hits = (...ids: string[]) => ids.map((chunkId, index) => ({ chunkId, score: 1 - index / 100 }));

describe("RRF with k = 60 [CON-16] (docs/busqueda-hibrida.md §5)", () => {
  it("adds 1 / (60 + position) for each list: 1st by meaning and 3rd by words ≈ 0.0323", () => {
    const fused = fuseRrf({ vector: hits("a", "b"), text: hits("c", "d", "a") });
    const a = fused.find((hit) => hit.chunkId === "a");
    expect(a?.score).toBeCloseTo(1 / 61 + 1 / 63, 10);
    expect(a?.score).toBeCloseTo(0.0323, 4);
    expect(a).toMatchObject({ vectorRank: 1, textRank: 3, vectorScore: 1 });
    expect(fused[0].chunkId).toBe("a");
    // Only in one list at the top: 1/61 ≈ 0.0164.
    expect(fused.find((hit) => hit.chunkId === "c")?.score).toBeCloseTo(1 / 61, 10);
  });

  it("only positions count, never the scores of each list", () => {
    const one = fuseRrf({ vector: [{ chunkId: "x", score: 0.99 }, { chunkId: "y", score: 0.98 }], text: [] });
    const two = fuseRrf({ vector: [{ chunkId: "x", score: 0.2 }, { chunkId: "y", score: 0.01 }], text: [] });
    expect(one.map((hit) => hit.score)).toEqual(two.map((hit) => hit.score));
  });

  it("ties: better position by meaning first, then the id (stable order)", () => {
    // v1 is 1st by meaning, t1 1st by words: same score; the one by meaning wins.
    expect(fuseRrf({ vector: hits("v1"), text: hits("t1") }).map((hit) => hit.chunkId)).toEqual(["v1", "t1"]);
    // Two chunks only by words at the same score cannot happen; two only by meaning neither. Same list, same id order.
    expect(fuseRrf({ vector: [], text: hits("b", "a") }).map((hit) => hit.chunkId)).toEqual(["b", "a"]);
    expect(fuseRrf({ vector: hits("z"), text: hits("y") }).map((hit) => hit.chunkId)).toEqual(["z", "y"]);
  });

  it("a repeated id in one list counts once", () => {
    const fused = fuseRrf({ vector: hits("a", "a"), text: [] });
    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(1 / 61, 10);
  });

  it("empty lists give nothing", () => {
    expect(fuseRrf({ vector: [], text: [] })).toEqual([]);
  });
});
