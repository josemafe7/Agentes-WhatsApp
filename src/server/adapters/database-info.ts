// Engine-specific facts for Diagnóstico: database size and applied migrations (SQLite/libSQL SQL lives only in
// adapters). A Postgres implementation would use pg_database_size() and its own migrations table.
import "server-only";
import { sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";

export type AppliedMigrations = {
  count: number;
  /** `created_at` of the newest applied migration: drizzle stores the journal's `when` (epoch ms). */
  lastCreatedAt: number | null;
};

export type DatabaseInfo = {
  /** page_count × page_size; null when the engine does not say. */
  sizeBytes: number | null;
  /** null when the migrations table cannot be read (e.g. a database that was never migrated). */
  migrations: AppliedMigrations | null;
};

function toNumber(value: unknown): number | null {
  const number = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function databaseSize(executor: Executor): Promise<number | null> {
  try {
    const pages = await executor.get<{ page_count: unknown }>(sql`PRAGMA page_count`);
    const size = await executor.get<{ page_size: unknown }>(sql`PRAGMA page_size`);
    const count = toNumber(pages?.page_count);
    const pageSize = toNumber(size?.page_size);
    return count !== null && pageSize !== null ? count * pageSize : null;
  } catch {
    return null;
  }
}

async function appliedMigrations(executor: Executor): Promise<AppliedMigrations | null> {
  try {
    const row = await executor.get<{ applied: unknown; last: unknown }>(
      sql`SELECT count(*) AS applied, max(created_at) AS last FROM __drizzle_migrations`,
    );
    return { count: toNumber(row?.applied) ?? 0, lastCreatedAt: toNumber(row?.last) };
  } catch {
    return null;
  }
}

/** Size and migrations of the database; never throws (Diagnóstico shows «sin datos» instead). */
export async function getDatabaseInfo(executor: Executor = defaultDb): Promise<DatabaseInfo> {
  const [sizeBytes, migrations] = await Promise.all([databaseSize(executor), appliedMigrations(executor)]);
  return { sizeBytes, migrations };
}
