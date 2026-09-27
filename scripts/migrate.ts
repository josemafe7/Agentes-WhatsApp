// `pnpm db:migrate`: brings the database of DATABASE_URL up to date with the migrations in drizzle/ (the embedded one,
// data/pglite, or Supabase). A DATABASE_URL already in the environment wins over .env.local: `DATABASE_URL="…" pnpm
// db:migrate` migrates Supabase while .env.local keeps the local database.
import { loadLocalEnv } from "./lib/cli";
import { runMigrateCommand } from "./lib/migrate-command";

async function main(): Promise<void> {
  loadLocalEnv();
  process.exitCode = await runMigrateCommand();
}

void main();
