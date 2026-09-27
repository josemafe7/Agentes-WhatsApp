// The agent's hand-off rules ([TRA-01], [AGE-09]): phrases of the customer that hand the conversation to a person
// before answering (keywords and sensitive topics), and «no lo sé» answers counted until the configured number.
// Pure functions: matching ignores case and accents and only takes whole words («persona» never matches «personas»).
import "server-only";
import type { SystemToolName } from "@/lib/agent-tools";
import type { ToolCallRecord } from "@/server/ai/tools";

/** What the knowledge tool returns when nothing is relevant ([CON-18]). */
export const KNOWLEDGE_NO_RESULTS = "SIN_RESULTADOS";

/** Lower case, without accents or repeated spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first phrase found as whole words in `text`, or null. */
export function findPhrase(text: string, phrases: readonly string[] | undefined): string | null {
  if (!phrases?.length) return null;
  const haystack = normalizeForMatch(text);
  if (!haystack) return null;
  for (const phrase of phrases) {
    const needle = normalizeForMatch(phrase);
    if (!needle) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "u");
    if (pattern.test(haystack)) return phrase;
  }
  return null;
}

/** Ways an answer says it does not know (normalized text). */
export const UNCERTAINTY_PATTERNS: readonly RegExp[] = [
  /\bno lo se\b/,
  /\bno (lo )?sabria (decirte|decir)\b/,
  /\bno tengo (esa|esta|dicha|la|suficiente) informacion\b/,
  /\bno dispongo de (esa|esta|dicha|la) informacion\b/,
  /\bno tengo (esos|estos) datos\b/,
  /\bno (puedo|podria) confirmar(te|lo)?\b/,
  /\bno encuentro (esa|esta|la) informacion\b/,
  /\bdesconozco\b/,
];

const KNOWLEDGE_TOOL: SystemToolName = "buscar_conocimiento";

/**
 * An answer that does not know ([CON-18], [AGE-09]): the knowledge was searched and no search of the turn found
 * anything (a first search without results and a second one that found the fact is an answer that knows), or the
 * text says so. Only the tool's own «SIN_RESULTADOS» counts, compared exactly: a fragment that merely contains those
 * words (a web page, a document) is data and never steers the hand-off ([HER-09]).
 */
export function isUnknownAnswer(text: string, toolCalls: readonly ToolCallRecord[] = []): boolean {
  const searches = toolCalls.filter((call) => call.name === KNOWLEDGE_TOOL && call.ok).map((call) => call.result.resultado);
  const foundNothing = searches.some((result) => result === KNOWLEDGE_NO_RESULTS);
  const foundSomething = searches.some((result) => typeof result === "string" && result !== KNOWLEDGE_NO_RESULTS);
  if (foundNothing && !foundSomething) return true;
  const normalized = normalizeForMatch(text);
  return UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(normalized));
}
