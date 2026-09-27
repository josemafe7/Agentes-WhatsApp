// Column helpers shared by every table (docs/decisions/0003): UUID text ids, UTC timestamps with milliseconds,
// JSON in jsonb columns and real booleans. Ids and timestamps are set in JS, so raw inserts and both drivers agree.
import { sql } from "drizzle-orm";
import { boolean, customType, jsonb, json as pgJson, timestamp as pgTimestamp, text } from "drizzle-orm/pg-core";

/** Fixed embedding size of the product (docs/decisions/0013). */
export const EMBEDDING_DIMENSIONS = 1536;

export const newId = (): string => crypto.randomUUID();

/** `id` text primary key with a random UUID v4. */
export const id = () => text("id").primaryKey().$defaultFn(newId);

/** UTC instant as `timestamp(3) with time zone` (`Date` in TypeScript, milliseconds like JS). */
export const timestamp = (name: string) => pgTimestamp(name, { withTimezone: true, precision: 3, mode: "date" });

export const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

/** `created_at` + `updated_at`, spread into every table. */
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

export const bool = (name: string) => boolean(name);

/** JSON document in a jsonb column. */
export const json = <T>(name: string) => jsonb(name).$type<T>();

/** SQL default for JSON arrays (`'[]'`) and objects (`'{}'`), so raw inserts in adapters get valid JSON too. */
export const EMPTY_JSON_ARRAY = sql`'[]'::jsonb`;
export const EMPTY_JSON_OBJECT = sql`'{}'::jsonb`;

/**
 * JSON kept exactly as written, in a json column: jsonb sorts object keys, and some objects are shown back in the
 * order the person typed them (a contact's custom fields, a tool's parameters and headers).
 */
export const orderedJson = <T>(name: string) => pgJson(name).$type<T>();
export const EMPTY_ORDERED_JSON_OBJECT = sql`'{}'::json`;

/**
 * Postgres full-text vector (docs/busqueda-hibrida.md). Only as a generated column: the database writes it, the
 * app never does, and the adapters search it with `@@`.
 */
export const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
