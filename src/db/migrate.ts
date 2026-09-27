// Applies the SQL migrations of drizzle/ (generated + custom) with Drizzle's migrator; they are recorded in
// drizzle.__drizzle_migrations. The embedded database uses the same lock as the app (src/db/index.ts).
import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { databaseUrlFromEnv, openDatabase, type schema } from "./index";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export async function migrateDatabase(url: string = databaseUrlFromEnv()): Promise<void> {
  const { database, target, close } = openDatabase(url);
  const config = { migrationsFolder: MIGRATIONS_FOLDER };
  try {
    // Both migrators run the same SQL in one transaction; each is typed for its own driver.
    if (target.kind === "server") await migratePostgres(database as unknown as PostgresJsDatabase<typeof schema>, config);
    else await migratePglite(database as unknown as PgliteDatabase<typeof schema>, config);
  } finally {
    await close();
  }
}
