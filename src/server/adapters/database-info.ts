// Engine-specific facts for Diagnóstico: database size and applied migrations (Postgres SQL lives only in
// adapters). The migrations table is the one of Drizzle's migrator: drizzle.__drizzle_migrations.
import "server-only";
import { sql } from "drizzle-orm";
import { db as defaultDb, rowsOf, type Executor } from "@/db";

export type AppliedMigrations = {
  count: number;
  /** `created_at` of the newest applied migration: drizzle stores the journal's `when` (epoch ms). */
  lastCreatedAt: number | null;
};

export type DatabaseInfo = {
  /** pg_database_size of this database; null when the engine does not say. */
  sizeBytes: number | null;
  /** null when the migrations table cannot be read (e.g. a database that was never migrated). */
  migrations: AppliedMigrations | null;
};

/** bigint columns and count(*) come back as strings, numbers or bigints depending on the driver. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function databaseSize(executor: Executor): Promise<number | null> {
  try {
    const [row] = rowsOf<{ size: unknown }>(await executor.execute(sql`SELECT pg_database_size(current_database()) AS size`));
    return toNumber(row?.size);
  } catch {
    return null;
  }
}

async function appliedMigrations(executor: Executor): Promise<AppliedMigrations | null> {
  try {
    const [row] = rowsOf<{ applied: unknown; last: unknown }>(
      await executor.execute(sql`SELECT count(*) AS applied, max(created_at) AS last FROM drizzle.__drizzle_migrations`),
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
