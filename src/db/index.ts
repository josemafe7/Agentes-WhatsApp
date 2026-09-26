// libSQL client and Drizzle instance. Local file in development (data/local.db), Turso when published.
// No `import "server-only"` here: scripts, the worker and Vitest import it too (only server code does).
import { createClient, type Client, type ResultSet } from "@libsql/client";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core";
import { withBusyRetry } from "./busy-retry";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "file:./data/local.db";

type Schema = typeof schema;
export type Database = LibSQLDatabase<Schema> & { $client: Client };
/** A transaction handle: inside `db.transaction(async (tx) => …)` use only `tx`, never `db`. */
export type Transaction = SQLiteTransaction<"async", ResultSet, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that runs queries: the database or an open transaction. */
export type Executor = Database | Transaction;

export function isLocalDatabaseUrl(url: string): boolean {
  return url.startsWith("file:") || url === ":memory:";
}

export function databaseUrlFromEnv(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/**
 * New client for `url`.
 * - Local files: no synchronous SQLite busy timeout; busy operations are retried asynchronously instead
 *   (src/db/busy-retry.ts explains why). WAL is set by the migrations (src/db/migrate.ts).
 * - Foreign keys: libSQL's bundled SQLite enforces them on every new connection (checked with
 *   @libsql/client 0.18.0); the app still deletes children explicitly and never relies on cascades.
 * - Turso (libsql://): authToken from DATABASE_AUTH_TOKEN.
 */
export function createDatabaseClient(url: string = databaseUrlFromEnv(), authToken?: string): Client {
  if (isLocalDatabaseUrl(url)) return withBusyRetry(createClient({ url }));
  const token = authToken ?? process.env.DATABASE_AUTH_TOKEN?.trim();
  return createClient({ url, ...(token ? { authToken: token } : {}) });
}

type Cached = { url: string; client: Client; db: Database };
// Survives Next.js dev hot reloads (one client per process); keyed by URL so tests can switch databases.
const globalCache = globalThis as unknown as { __dominiaDb?: Cached };

/** The Drizzle instance for DATABASE_URL, created on first use (never at import time). */
export function getDb(): Database {
  const url = databaseUrlFromEnv();
  const cached = globalCache.__dominiaDb;
  if (cached && cached.url === url) return cached.db;
  cached?.client.close();
  const client = createDatabaseClient(url);
  const database = drizzle(client, { schema }) as Database;
  globalCache.__dominiaDb = { url, client, db: database };
  return database;
}

/** Closes the cached client (tests and scripts). */
export function closeDb(): void {
  globalCache.__dominiaDb?.client.close();
  globalCache.__dominiaDb = undefined;
}

/**
 * Lazy handle to `getDb()`: importing a module that uses `db` opens nothing until the first query, so
 * `next build` and imports without a database do not fail.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const real = getDb();
    const value: unknown = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
