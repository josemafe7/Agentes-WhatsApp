// TextSearch: keyword search over kb_chunks.search_vector, the tsvector Postgres generates from title, section and
// content with the `es_unaccent` configuration (no accents, no case, Spanish stems: «tintes» finds «tinte»),
// docs/busqueda-hibrida.md §3 and §8. The query is an OR of keywords, always passed as a parameter to
// websearch_to_tsquery, which never fails on syntax.
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db as defaultDb, rowsOf, type Executor } from "@/db";
import { DEFAULT_SEARCH_LIMIT, type KbScope, type SearchHit, type SearchOptions } from "./search-types";

export interface TextSearch {
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
  /** Nothing to rebuild in Postgres: search_vector is a generated column, always in step with its row. */
  rebuild(): Promise<void>;
}

const MIN_TERM_LENGTH = 2;
const MAX_TERMS = 12;
/** Words from this long also search their plural («uña» → «uñas»). */
const MIN_PLURAL_TERM_LENGTH = 3;
/** Words from this long ending in «s» also search their singular («cancelaciones» → «cancelacion»). */
const MIN_SINGULAR_TERM_LENGTH = 5;

// Spanish stop words (compared without accents). In an OR query «de» or «la» would match almost everything and fill
// the 40 results with noise, so they never reach the query (es_unaccent drops its own list as well).
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

/** Accents off for comparing with the stop words, but «ñ» kept: «uña» is not «una». */
function withoutAccents(text: string): string {
  return text
    .normalize("NFC")
    .replaceAll("ñ", "\u0000")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replaceAll("\u0000", "ñ");
}

const isSearchable = (word: string) => word.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(withoutAccents(word));

/**
 * The word and its other number (plural: «s» after a vowel, «es» after a consonant; singular: without the «s» or
 * «es»). es_unaccent gives most plurals the stem of their singular («tintes», «tinte» → tint), but it removes the
 * accent before stemming, so an ending the stemmer only knows accented stays: «cancelación» and «cancelacion» →
 * cancelacion, «cancelaciones» → cancel. Searching both forms finds either.
 */
function numberForms(word: string): string[] {
  if (!/^\p{L}+$/u.test(word)) return [word];
  if (!word.endsWith("s")) {
    if (word.length < MIN_PLURAL_TERM_LENGTH) return [word];
    return [word, /[aeiouáéíóú]$/u.test(word) ? `${word}s` : `${word}es`];
  }
  if (word.length < MIN_SINGULAR_TERM_LENGTH) return [word];
  return word.endsWith("es") ? [word, word.slice(0, -1), word.slice(0, -2)] : [word, word.slice(0, -1)];
}

/**
 * websearch_to_tsquery text for what a customer or agent wrote: its keywords and their other number joined with
 * `or` (`tinte or tintes or precio or precios`), or null when nothing is left to search. Only runs of letters and
 * digits are kept, so quotes and «-» (NOT in websearch syntax) never reach it; a word «or» typed by the customer
 * lands between two `or` operators, where websearch reads it as a word.
 */
export function buildFtsQuery(text: string): string | null {
  const words = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const word of words) {
    if (!isSearchable(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length === MAX_TERMS) break;
  }
  if (terms.length === 0) return null;
  return [...new Set(terms.flatMap(numberForms).filter(isSearchable))].join(" or ");
}

/** `(c.kb_id = $1 AND c.index_version = $2) OR …`: only current chunks of the allowed bases. */
export function kbScopeCondition(kbs: readonly KbScope[]): SQL {
  return sql.join(
    kbs.map((kb) => sql`(c.kb_id = ${kb.kbId} AND c.index_version = ${kb.indexVersion})`),
    sql` OR `,
  );
}

export class PgTextSearch implements TextSearch {
  private readonly db: Executor;

  constructor(options: { db?: Executor } = {}) {
    this.db = options.db ?? defaultDb;
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    const terms = buildFtsQuery(query);
    if (!terms || options.kbs.length === 0) return [];
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    // ts_rank_cd is higher for better matches; the filter applies before LIMIT, so it is exact.
    const rows = rowsOf<{ chunk_id: string; rank: number }>(
      await this.db.execute(sql`
        SELECT c.id AS chunk_id, ts_rank_cd(c.search_vector, q.query) AS rank
        FROM kb_chunks AS c, websearch_to_tsquery('public.es_unaccent', ${terms}) AS q(query)
        WHERE c.search_vector @@ q.query AND (${kbScopeCondition(options.kbs)})
        ORDER BY rank DESC, c.id
        LIMIT ${limit}
      `),
    );
    return rows.map((row) => ({ chunkId: row.chunk_id, score: row.rank }));
  }

  async rebuild(): Promise<void> {
    // search_vector is GENERATED ALWAYS … STORED: Postgres writes it on every insert and update of the chunk.
  }
}

let shared: TextSearch | undefined;

export function getTextSearch(): TextSearch {
  shared ??= new PgTextSearch();
  return shared;
}
