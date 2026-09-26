// Column helpers shared by every table (docs/decisions/0003): UUID text ids, UTC epoch-ms timestamps,
// JSON in text columns and booleans as integers. Defaults live in JS so the SQL stays portable to Postgres.
import { sql } from "drizzle-orm";
import { customType, integer, text } from "drizzle-orm/sqlite-core";

/** Fixed embedding size of the product (docs/decisions/0013). */
export const EMBEDDING_DIMENSIONS = 1536;

export const newId = (): string => crypto.randomUUID();

/** `id` text primary key with a random UUID v4. */
export const id = () => text("id").primaryKey().$defaultFn(newId);

/** UTC instant stored as integer milliseconds (`Date` in TypeScript). */
export const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

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

export const bool = (name: string) => integer(name, { mode: "boolean" });

/** JSON document in a text column. */
export const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

/** SQL default for JSON arrays (`'[]'`) and objects (`'{}'`), so raw inserts in adapters get valid JSON too. */
export const EMPTY_JSON_ARRAY = sql`'[]'`;
export const EMPTY_JSON_OBJECT = sql`'{}'`;

/**
 * libSQL vector column `F32_BLOB(n)` (docs/busqueda-hibrida.md §2 and §4). Written with `vector32(json)`.
 * Never select it in normal queries (6 KB per row); the adapters read ids and distances only.
 */
export const f32Vector = customType<{
  data: number[];
  config: { dimensions: number };
  configRequired: true;
  driverData: ArrayBuffer | Uint8Array;
}>({
  dataType: (config) => `F32_BLOB(${config.dimensions})`,
  toDriver: (value) => sql`vector32(${JSON.stringify(value)})`,
  fromDriver: (value) => {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    // Copy into a fresh, aligned buffer: the driver's buffer may be shared or unaligned.
    return Array.from(new Float32Array(bytes.slice().buffer));
  },
});
