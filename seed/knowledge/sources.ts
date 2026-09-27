// The knowledge fragments the demo's AI answers «used» ([CON-20], [BAN-07]): the seed never calls the AI or the
// search (it writes inside one transaction), so the sources of a few demo answers are chosen here, in memory, by the
// words they share with the question and the answer, as a search by words would. Pure: same input, same sources.
import { RRF_K } from "@/server/knowledge/constants";

export type SourceCandidate = { title: string; section: string | null; content: string };
export type PickedSource<T> = { candidate: T; rank: number; score: number };

/** At most this many sources per answer (the live search gives up to 8; a short answer uses fewer). */
const MAX_SOURCES = 3;
/** A source must share at least this share of the best source's weight. */
const MIN_SHARE_OF_BEST = 0.5;

const STOP_WORDS = new Set(
  (
    "que los las del por una uno unos unas con para como mas pero sus les ese esa eso esto este esta estos estas " +
    "hay muy sin sobre tambien hasta donde desde todo toda todos todas nos ante antes algo alguna alguno cual " +
    "cuando porque tan tanto otro otra otros otras hola buenas buenos dias tardes noches gracias queria quiero " +
    "saber puedo podeis tengo tiene tienes teneis hace hacer hacen haceis estar estamos esta estan ser son eres " +
    "soy fue muy bien vale pues ahi aqui alli luego entonces dime dinos quieres ayudo ayudar mas menos poco " +
    "mucho mucha muchos muchas cada vez veces sera sido han has hemos habeis"
  ).split(" "),
);

/** Words of a text for matching: no accents, lower case, three letters or more, no stop words. */
export function sourceWords(text: string): Set<string> {
  const words =
    text
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

/**
 * The candidates that best match `query` (rare shared words weigh more), best first, with the fused score the
 * live hybrid search would give a result found first by both lists at that rank (2 / (RRF_K + rank)).
 */
export function pickDemoSources<T extends SourceCandidate>(query: string, candidates: readonly T[]): PickedSource<T>[] {
  const wanted = sourceWords(query);
  const wordsOf = candidates.map((candidate) => sourceWords(`${candidate.title}\n${candidate.section ?? ""}\n${candidate.content}`));
  const documentFrequency = new Map<string, number>();
  for (const words of wordsOf) for (const word of words) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  const weightOf = (word: string) => Math.log(1 + candidates.length / (documentFrequency.get(word) ?? candidates.length));

  const scored = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      weight: [...wanted].reduce((sum, word) => sum + (wordsOf[index].has(word) ? weightOf(word) : 0), 0),
    }))
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const best = scored[0]?.weight ?? 0;
  return scored
    .filter((item) => item.weight >= best * MIN_SHARE_OF_BEST)
    .slice(0, MAX_SOURCES)
    .map((item, index) => ({ candidate: item.candidate, rank: index + 1, score: Math.round((2 / (RRF_K + index + 1)) * 10_000) / 10_000 }));
}
