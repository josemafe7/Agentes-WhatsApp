// Words as the simulated OpenRouter reads them: the pseudo-embeddings of POST /embeddings, the relevance of
// POST /rerank and the sentence the simulated model quotes from a knowledge fragment. Deterministic and without
// dependencies, so texts that share words are close and texts that share none are not (docs/busqueda-hibrida.md).
//
//   termsOf(text)        lower case, accents off, Spanish stop words and words under 3 characters left out, and a
//                        light stem (final «s», then a final a/e/o, from 5 letters): «tintes» and «tinte» → «tint».
//   embeddingFor(text)   hashed bag of words: each term adds 1 + ln(count) to one of `dimensions` slots (sha256 of the
//                        term picks the slot and the sign), then the vector is normalised. A text with no terms gets
//                        a stable unit vector of its own (sha256 of the text), never a zero vector.
//   similarity(a, b)     cosine of the two bags of words (exact terms, no hashing), from 0 to 1.
import { createHash } from "node:crypto";

// The same list as the app's word search (src/server/adapters/text-search.ts), compared without accents.
const STOP_WORDS = new Set(
  (
    "a al algo algun alguna algunas alguno algunos ante antes aqui asi aun bien cada como con contra cual cuales " +
    "cuando cuanto cuanta cuantos cuantas de del desde donde dos e el ella ellas ello ellos en entre era eran eres " +
    "es esa esas ese eso esos esta estaba estado estan estar estas este esto estos estoy fue fueron gracias ha " +
    "hace hacer han has hasta hay hola la las le les lo los mas me mi mis mucho muchos muy nada ni no nos nosotros " +
    "o os otra otras otro otros para pero poco por porque puede puedo que quien quienes se sea ser si sido sin " +
    "sobre soy su sus tambien tanto te tener tengo ti tiene tienen tu tus un una unas uno unos usted ustedes vosotros " +
    "y ya yo"
  ).split(" "),
);

const MIN_TERM_LENGTH = 3;
const MIN_STEM_LENGTH = 5;

function stem(word) {
  let result = word.length >= MIN_STEM_LENGTH && word.endsWith("s") ? word.slice(0, -1) : word;
  if (result.length >= MIN_STEM_LENGTH && /[aeo]$/.test(result)) result = result.slice(0, -1);
  return result;
}

/** The terms of a text, in order (repeated terms repeated). */
export function termsOf(text) {
  const words =
    String(text ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = [];
  for (const word of words) {
    if (word.length < MIN_TERM_LENGTH || STOP_WORDS.has(word)) continue;
    terms.push(stem(word));
  }
  return terms;
}

/** term → weight (1 + ln(count)). */
export function bagOfWords(text) {
  const counts = new Map();
  for (const term of termsOf(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  const bag = new Map();
  for (const [term, count] of counts) bag.set(term, 1 + Math.log(count));
  return bag;
}

function bagLength(bag) {
  let sum = 0;
  for (const weight of bag.values()) sum += weight * weight;
  return Math.sqrt(sum);
}

/** Cosine of the bags of words of two texts (0 when either has no terms). */
export function similarity(a, b) {
  const left = bagOfWords(a);
  const right = bagOfWords(b);
  const denominator = bagLength(left) * bagLength(right);
  if (denominator === 0) return 0;
  let dot = 0;
  for (const [term, weight] of left) dot += weight * (right.get(term) ?? 0);
  return dot / denominator;
}

/** A stable unit vector for a text without terms. */
function hashedUnitVector(text, dimensions) {
  const values = [];
  let seed = createHash("sha256").update(String(text)).digest();
  while (values.length < dimensions) {
    for (let index = 0; index + 1 < seed.length && values.length < dimensions; index += 2) values.push(seed.readInt16BE(index) / 32768);
    seed = createHash("sha256").update(seed).digest();
  }
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / length);
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/** The pseudo-embedding of a text: `dimensions` numbers, unit length (rounded to 6 decimals). */
export function embeddingFor(text, dimensions) {
  const bag = bagOfWords(text);
  const vector = new Array(dimensions).fill(0);
  for (const [term, weight] of bag) {
    const hash = createHash("sha256").update(term).digest();
    const slot = hash.readUInt32BE(0) % dimensions;
    vector[slot] += (hash[4] & 1 ? 1 : -1) * weight;
  }
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  // No terms (or terms that cancel out in the same slot): never a zero vector.
  if (length === 0) return hashedUnitVector(text, dimensions).map(round);
  return vector.map((value) => round(value / length));
}

/** The sentences of a text (whitespace collapsed; «[pág. N]» markers and Markdown heading marks left out). */
export function sentencesOf(text) {
  const clean = String(text ?? "")
    .replace(/\[pág\. \d+\]/g, " ")
    .replace(/^#{1,6}\s+(.*)$/gm, "$1.")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];
  return (clean.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [clean]).map((sentence) => sentence.trim()).filter(Boolean);
}

/** The sentence of `text` that shares the most terms with `question` (the first one on a tie), or "". */
export function bestSentence(text, question) {
  const wanted = new Set(termsOf(question));
  let best = "";
  let bestScore = -1;
  for (const sentence of sentencesOf(text)) {
    const score = new Set(termsOf(sentence).filter((term) => wanted.has(term))).size;
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  return best;
}
