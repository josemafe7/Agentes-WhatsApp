// Applies the SQL migrations of drizzle/ (generated + custom) with a dedicated client that is closed after.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDatabaseClient, databaseUrlFromEnv, isLocalDatabaseUrl } from "./index";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export type MigrateOptions = {
  url?: string;
  authToken?: string;
  migrationsFolder?: string;
  /** WAL for local files (default true). The test template uses the rollback journal so it can be copied. */
  wal?: boolean;
};

/** Absolute path of a local `file:` database URL, or null for remote / in-memory URLs. */
export function localDatabasePath(url: string): string | null {
  if (!url.startsWith("file:") || url.includes(":memory:")) return null;
  if (url.startsWith("file://")) return fileURLToPath(url.split("?")[0]);
  return path.resolve(process.cwd(), url.slice("file:".length).split("?")[0]);
}

/** Creates the folder of a local database file if needed (libSQL does not). */
export function ensureDatabaseFolder(url: string): void {
  const file = localDatabasePath(url);
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
}

export async function migrateDatabase(options: MigrateOptions = {}): Promise<void> {
  const url = options.url ?? databaseUrlFromEnv();
  ensureDatabaseFolder(url);
  const client = createDatabaseClient(url, options.authToken);
  try {
    if (isLocalDatabaseUrl(url) && options.wal !== false) await enableWal(client);
    await migrate(drizzle(client), { migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER });
  } finally {
    client.close();
  }
}

/**
 * WAL journal for a local file, stored in the file itself: readers never block the writer, and concurrent
 * writers (dev server, ticker, worker) queue on the busy timeout instead of dead-locking.
 */
export async function enableWal(client: Client): Promise<void> {
  await client.execute("PRAGMA journal_mode = WAL");
}

/** Switches an existing local database file to WAL (used by the tests on their copy of the template). */
export async function enableWalForUrl(url: string): Promise<void> {
  const client = createDatabaseClient(url);
  try {
    await enableWal(client);
  } finally {
    client.close();
  }
}
