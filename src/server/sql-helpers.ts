// The few SQL pieces the Drizzle query builder lacks, shared by src/data and src/server so each rule lives in one place:
// - LIKE patterns that match their text literally. Postgres' LIKE (and ILIKE) takes `%` and `_` as wildcards and the
//   backslash as its escape character, so a search someone types, or a key looked for in stored JSON, has all three
//   escaped (a trailing backslash would otherwise be an error).
// - A jsonb column as text, to look for a quoted value inside it. Postgres writes jsonb with a space after `:` and `,`
//   (`{"fileKey": "media/…", "size": 1}`), so the patterns only ever look for a quoted value (`"media/…"`), never for a
//   key and its value together; the caller then checks the parsed value exactly in JS.
// - Where the NULLs of a sort go. SQLite put them first in ascending order and last in descending order, and the app
//   was written for that; Postgres does the opposite, so the sorts over nullable columns say it explicitly.
import "server-only";
import { like, sql, type AnyColumn, type SQL } from "drizzle-orm";

/** `value` with LIKE's wildcards and its escape character escaped, so it matches only itself. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** LIKE pattern: the text contains `value`. */
export const containing = (value: string): string => `%${escapeLike(value)}%`;

/** LIKE pattern: the text starts with `value`. */
export const startingWith = (value: string): string => `${escapeLike(value)}%`;

/**
 * The rows whose jsonb `column` contains `needle` in its text (usually a value in quotes: `JSON.stringify(key)`). It
 * only narrows the candidates: the caller checks the parsed value.
 */
export function jsonTextContains(column: AnyColumn, needle: string): SQL {
  return like(sql`${column}::text`, containing(needle));
}

/** Descending with the NULLs last, as SQLite sorted them. */
export const descNullsLast = (column: AnyColumn): SQL => sql`${column} desc nulls last`;

/** Ascending with the NULLs first, as SQLite sorted them. */
export const ascNullsFirst = (column: AnyColumn): SQL => sql`${column} asc nulls first`;
