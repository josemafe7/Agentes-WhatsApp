// drizzle-kit: `pnpm db:generate` diffs src/db/schema against drizzle/meta (it never connects to the database, so it
// needs no credentials and reads no .env file). Migrations are applied only by src/db/migrate.ts (`pnpm db:migrate`).
// Never use `drizzle-kit push`: it skips the migration history and the custom migration (extensions, es_unaccent).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
