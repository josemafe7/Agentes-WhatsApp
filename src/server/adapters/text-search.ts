// TextSearch: keyword search over kb_chunks with FTS5 (`unicode61 remove_diacritics 2`), docs/busqueda-hibrida.md §3.
// The query is an OR of quoted keywords, always passed as a parameter. A future Postgres implementation uses
// the `es_unaccent` configuration behind the same interface.
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { DEFAULT_SEARCH_LIMIT, type KbScope, type SearchHit, type SearchOptions } from "./search-types";

export interface TextSearch {
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
  /** Rebuilds the word index from kb_chunks (after VACUUM or a table re-creation). */
  rebuild(): Promise<void>;
}

const MIN_TERM_LENGTH = 2;
const MAX_TERMS = 12;

// Spanish stop words (compared without accents). FTS5 has no stop-word list, and in an OR query «de» or «la»
// would match almost everything and fill the 40 results with noise.
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

function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "");
}

/**
 * FTS5 MATCH expression for what a customer or agent wrote: `"precio" OR "tinte"`, or null when nothing is
 * left to search. Each term is quoted (quotes doubled), so FTS5 operators in the input are plain text.
 */
export function buildFtsQuery(text: string): string | null {
  const words = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const word of words) {
    if (word.length < MIN_TERM_LENGTH || STOP_WORDS.has(withoutAccents(word)) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length === MAX_TERMS) break;
  }
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

/** `(c.kb_id = ? AND c.index_version = ?) OR …`: only current chunks of the allowed bases. */
export function kbScopeCondition(kbs: readonly KbScope[]): SQL {
  return sql.join(
    kbs.map((kb) => sql`(c.kb_id = ${kb.kbId} AND c.index_version = ${kb.indexVersion})`),
    sql` OR `,
  );
}

export class LibsqlTextSearch implements TextSearch {
  private readonly db: Executor;

  constructor(options: { db?: Executor } = {}) {
    this.db = options.db ?? defaultDb;
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    const match = buildFtsQuery(query);
    if (!match || options.kbs.length === 0) return [];
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    // bm25() is lower for better matches; the filter applies before LIMIT, so it is exact.
    const rows = await this.db.all<{ chunk_id: string; rank: number }>(sql`
      SELECT c.id AS chunk_id, bm25(kb_chunks_fts) AS rank
      FROM kb_chunks_fts
      JOIN kb_chunks AS c ON c.rowid = kb_chunks_fts.rowid
      WHERE kb_chunks_fts MATCH ${match} AND (${kbScopeCondition(options.kbs)})
      ORDER BY rank, c.id
      LIMIT ${limit}
    `);
    return rows.map((row) => ({ chunkId: row.chunk_id, score: -row.rank }));
  }

  async rebuild(): Promise<void> {
    await this.db.run(sql`INSERT INTO kb_chunks_fts(kb_chunks_fts) VALUES('rebuild')`);
  }
}

let shared: TextSearch | undefined;

export function getTextSearch(): TextSearch {
  shared ??= new LibsqlTextSearch();
  return shared;
}
