// Empties every table of the schema, children before parents (foreign keys are enforced and never cascade).
// Used to replace the demo (`pnpm seed`) and to empty a remote database (`--remote-i-know`).
import "server-only";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Executor } from "@/db";
import * as schema from "@/db/schema";

function schemaTables(): SQLiteTable[] {
  const exports: unknown[] = Object.values(schema);
  return exports.filter((value): value is SQLiteTable => is(value, SQLiteTable));
}

/** Tables ordered so that no table is emptied while another one still references it. */
export function tablesInDeleteOrder(tables: readonly SQLiteTable[] = schemaTables()): SQLiteTable[] {
  const byName = new Map(tables.map((table) => [getTableConfig(table).name, table]));
  const referencedBy = new Map<string, Set<string>>();
  for (const table of tables) {
    const { name, foreignKeys } = getTableConfig(table);
    for (const foreignKey of foreignKeys) {
      const parent = getTableConfig(foreignKey.reference().foreignTable).name;
      if (parent === name) continue;
      referencedBy.set(parent, (referencedBy.get(parent) ?? new Set()).add(name));
    }
  }
  const remaining = new Set(byName.keys());
  const order: SQLiteTable[] = [];
  while (remaining.size > 0) {
    const next = [...remaining].find((name) => ![...(referencedBy.get(name) ?? [])].some((child) => remaining.has(child)));
    const table = next === undefined ? undefined : byName.get(next);
    if (next === undefined || table === undefined) throw new Error("Las claves ajenas forman un ciclo: no se puede vaciar la base.");
    order.push(table);
    remaining.delete(next);
  }
  return order;
}

/** Deletes every row of every table (migrations are kept). Run it inside a transaction. */
export async function clearAllData(executor: Executor): Promise<void> {
  for (const table of tablesInDeleteOrder()) await executor.delete(table);
}
