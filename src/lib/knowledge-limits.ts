// The numbers of the knowledge that the screens use too (limits shown or checked while typing) and the token
// estimate: shared by the browser and the server, so this file never imports anything of the server.
// src/server/knowledge/constants.ts and tokens.ts re-export them for the pipeline ([CON-*], docs/busqueda-hibrida.md).

/**
 * Characters per token for Spanish without a tokenizer (docs/busqueda-hibrida.md §6). 4 is OpenAI's rule for
 * English; Spanish gives more tokens per character, so 3.5 over-estimates rather than under-estimates.
 */
export const CHARS_PER_TOKEN = 3.5;

/** Largest file a knowledge base accepts (a 100+ page PDF fits; Mistral's own limit is 50 MB). */
export const MAX_KB_FILE_BYTES = 25 * 1024 * 1024;
/** Web pages found in a sitemap that are added at once ([CON-04]). */
export const SITEMAP_MAX_PAGES = 50;
/** Refresh interval of a web page when none is given ([CON-09]). */
export const DEFAULT_REFRESH_HOURS = 24 * 7;
export const MIN_REFRESH_HOURS = 24;
export const MAX_REFRESH_HOURS = 24 * 90;
/** Longest query searched (the rest is cut). */
export const MAX_QUERY_CHARS = 1_000;

/**
 * Token estimate without a tokenizer: characters / 3.5, rounded up. The caps (30,000 tokens of context files, 3,500
 * of search answer) are kept with a margin because the estimate errs on the high side for Spanish.
 */
export function estimateTokens(text: string): number {
  const length = text.trim().length;
  return length === 0 ? 0 : Math.ceil(length / CHARS_PER_TOKEN);
}

/** Characters that fit in `tokens` (the inverse of estimateTokens). */
export function charsForTokens(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}
