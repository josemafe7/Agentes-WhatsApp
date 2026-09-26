// `pnpm db:migrate`: brings the database of DATABASE_URL up to date with the migrations in drizzle/.
// Creates data/ for a local file. Safe to repeat: applied migrations are skipped.
import { databaseUrlFromEnv, isLocalDatabaseUrl } from "../src/db";
import { migrateDatabase } from "../src/db/migrate";

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Without .env.local the default local database (data/local.db) is used.
  }
  const url = databaseUrlFromEnv();
  const where = isLocalDatabaseUrl(url) ? url : "la base de datos remota (Turso)";
  try {
    await migrateDatabase({ url });
    console.log(`Base de datos al día: ${where}`);
  } catch (error) {
    console.error(`No se pudieron aplicar las migraciones en ${where}.`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

void main();
