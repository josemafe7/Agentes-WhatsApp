// Empties every table of the schema with one TRUNCATE: parents and children go together, so the foreign keys
// (enforced, never cascading) allow it. Used to replace the demo (`pnpm seed`), to empty a server database
// (`--remote-i-know`) and by the tests.
import "server-only";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { Executor } from "@/db";
import * as schema from "@/db/schema";

/** Every table of the schema (src/db/schema/index.ts). */
export function schemaTables(): PgTable[] {
  const exports: unknown[] = Object.values(schema);
  return exports.filter((value): value is PgTable => is(value, PgTable));
}

/** Deletes every row of every table (the migrations, in the `drizzle` schema, stay). Run it inside a transaction. */
export async function clearAllData(executor: Executor): Promise<void> {
  const tables = schemaTables().map((table) => sql.identifier(getTableConfig(table).name));
  await executor.execute(sql`TRUNCATE TABLE ${sql.join(tables, sql`, `)} RESTART IDENTITY`);
}
