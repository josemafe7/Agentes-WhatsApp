// drizzle-kit: `pnpm db:generate` diffs src/db/schema against drizzle/meta (it never connects to the database).
// Never use `drizzle-kit push`: it would drop the FTS5 and vector index tables of the custom migration.
import { defineConfig } from "drizzle-kit";

try {
  // drizzle-kit does not read .env.local by itself (DATABASE_URL for `drizzle-kit studio`).
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local yet: the defaults below are enough to generate migrations.
}

export default defineConfig({
  // libSQL flavour of SQLite: works for local files and Turso URLs.
  dialect: "turso",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:./data/local.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  },
  strict: true,
  verbose: true,
});
