// Reciprocal Rank Fusion ([CON-16], docs/busqueda-hibrida.md §5): each chunk adds 1 / (k + position) for every list
// it appears in, positions from 1. Only positions count, never the scores of each list. Ties: the better position by
// meaning first, then the id, so the order is stable.
import { RRF_K } from "./constants";

export type RankedHit = { chunkId: string; score: number };

export type FusedHit = {
  chunkId: string;
  /** Sum of 1 / (k + position). */
  score: number;
  /** Position (from 1) in the list by meaning, or null. */
  vectorRank: number | null;
  /** Cosine similarity of the list by meaning, or null. */
  vectorScore: number | null;
  /** Position (from 1) in the list by words, or null. */
  textRank: number | null;
};

export function fuseRrf(lists: { vector: readonly RankedHit[]; text: readonly RankedHit[] }, k: number = RRF_K): FusedHit[] {
  const fused = new Map<string, FusedHit>();
  const entry = (chunkId: string) => {
    let hit = fused.get(chunkId);
    if (!hit) {
      hit = { chunkId, score: 0, vectorRank: null, vectorScore: null, textRank: null };
      fused.set(chunkId, hit);
    }
    return hit;
  };
  lists.vector.forEach((hit, index) => {
    const fusedHit = entry(hit.chunkId);
    if (fusedHit.vectorRank !== null) return;
    fusedHit.vectorRank = index + 1;
    fusedHit.vectorScore = hit.score;
    fusedHit.score += 1 / (k + index + 1);
  });
  lists.text.forEach((hit, index) => {
    const fusedHit = entry(hit.chunkId);
    if (fusedHit.textRank !== null) return;
    fusedHit.textRank = index + 1;
    fusedHit.score += 1 / (k + index + 1);
  });
  return [...fused.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (a.vectorRank ?? Number.POSITIVE_INFINITY) - (b.vectorRank ?? Number.POSITIVE_INFINITY) ||
      (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
  );
}
