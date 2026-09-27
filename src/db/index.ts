// Postgres connection and Drizzle instance, chosen by DATABASE_URL:
// - postgres:// or postgresql:// → a Postgres server (Supabase when published) through postgres.js;
// - empty, or the old SQLite `file:` setting → Postgres embedded in the process (PGlite) in ./data/pglite: the demo
//   works from a clean clone, without accounts or Docker;
// - pglite:<folder> → PGlite in that folder (E2E); pglite:memory → in memory (Vitest, one per test file).
// No `import "server-only"` here: scripts, the worker and Vitest import it too (only server code does).
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { after } from "next/server";
import postgres from "postgres";
import * as schema from "./schema";

type Schema = typeof schema;
/** The same Drizzle API on both drivers. Raw `execute()` results differ by driver: read them with rowsOf(). */
export type Database = PgDatabase<PgQueryResultHKT, Schema> & { $client: PGlite | postgres.Sql };
/**
 * A transaction handle: inside `db.transaction(async (tx) => …)` use only `tx`, never `db`. With PGlite a query on
 * `db` waits until the open transaction ends, so inside its callback it would wait forever.
 */
export type Transaction = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that runs queries: the database or an open transaction. */
export type Executor = Database | Transaction;

/** Folder of the embedded database, relative to the working directory. */
export const EMBEDDED_DATABASE_DIR = "./data/pglite";

/** Advisory lock every top-level transaction takes: one writer at a time, as with SQLite (see withWriteLock). */
export const WRITE_LOCK_KEY = 727252001;
/** Advisory lock of the realtime adapter: `seq` follows commit order (src/server/adapters/realtime.ts). */
export const REALTIME_LOCK_KEY = 727252002;

export type DatabaseTarget = { kind: "server"; url: string } | { kind: "embedded"; dataDir: string } | { kind: "memory" };

export function databaseUrlFromEnv(): string {
  return process.env.DATABASE_URL?.trim() ?? "";
}

/** A Postgres server URL (Supabase, or a Postgres of your own). */
export function isServerDatabase(url: string = databaseUrlFromEnv()): boolean {
  return /^postgres(ql)?:\/\//i.test(url.trim());
}

/** The SQLite setting of earlier versions (`file:./data/local.db`): now it means the embedded database. */
export function isLegacyFileDatabaseUrl(url: string): boolean {
  return url.trim().startsWith("file:");
}

/** Where DATABASE_URL points. Errors never repeat the URL: it may carry the password. */
export function resolveDatabaseTarget(url: string = databaseUrlFromEnv()): DatabaseTarget {
  const value = url.trim();
  if (isServerDatabase(value)) return { kind: "server", url: value };
  if (value.startsWith("libsql:")) throw new Error("Turso ya no se usa: pon la conexión de Supabase en DATABASE_URL.");
  // Vercel has no disk that outlives a request: only a server database works there.
  if (process.env.VERCEL) throw new Error("Falta DATABASE_URL de Supabase: en Vercel no hay base de datos integrada.");
  if (value === "" || isLegacyFileDatabaseUrl(value)) return { kind: "embedded", dataDir: path.resolve(EMBEDDED_DATABASE_DIR) };
  // `pglite:memory#<id>`: the id tells apart the in-memory databases of the test files.
  if (/^pglite:memory(#.*)?$/.test(value)) return { kind: "memory" };
  const folder = value.startsWith("pglite:") ? value.slice("pglite:".length).trim() : "";
  if (folder) return { kind: "embedded", dataDir: path.resolve(folder) };
  throw new Error(
    "DATABASE_URL no es válida: pon la conexión de Supabase (postgresql://…), déjala vacía para la base integrada o usa pglite:<carpeta>.",
  );
}

/**
 * postgres.js options for a server. `prepare: false` is required by Supabase's transaction pooler (port 6543, the
 * one for Vercel); from a VPS use the session pooler (port 5432). TLS always, except to this same machine. No
 * search_path here: Supabase's default one already includes the `extensions` schema of the migrations.
 */
export function serverConnectionOptions(url: string): postgres.Options<Record<string, postgres.PostgresType>> {
  return {
    prepare: false,
    ssl: isLocalHost(url) ? false : "require",
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    connection: { application_name: "dominia-agentes" },
  };
}

function isLocalHost(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const SEARCH_PATH = "SET search_path TO public, extensions";

/**
 * PGlite with the extensions of the migrations (vector, unaccent). The search_path is not kept in the data folder,
 * so it is set before any other query runs (PGlite runs queries in order); without it halfvec and `<=>` are unknown.
 */
export function createPglite(dataDir?: string, options: { loadDataDir?: Blob | File } = {}): PGlite {
  const client = new PGlite(dataDir ?? "memory://", { ...options, extensions: { vector, unaccent } });
  // A failure here is a failed start-up, which every later query reports too.
  client.exec(SEARCH_PATH).catch(() => undefined);
  return client;
}

/**
 * Every top-level `transaction()` first takes WRITE_LOCK_KEY, so transactions run one at a time, as they did with
 * SQLite's `BEGIN IMMEDIATE`: the booking checks ([AGD-13]), the queue and the realtime cursor rely on it. Nested
 * transactions (`tx.transaction`, savepoints) already hold it, and read-only ones (`{ accessMode: "read only" }`)
 * write nothing, so they skip it. A transaction that waits longer than 15 s for a lock fails instead of hanging.
 * Better Auth's transactions go through here too.
 */
function withWriteLock<T extends Database>(database: T): T {
  const transaction = database.transaction.bind(database);
  const locked: Database["transaction"] = (callback, config) => {
    if (config?.accessMode === "read only") return transaction(callback, config);
    const running = transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL lock_timeout = '15s'"));
      await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${WRITE_LOCK_KEY})`));
      return callback(tx);
    }, config);
    keepAliveUntilSettled(running);
    return running;
  };
  return Object.assign(database, { transaction: locked });
}

/**
 * On Vercel a function may be frozen as soon as its response is sent. A transaction still open then (for example in a
 * page whose render was cut short by a quick navigation) would keep the write lock, and every other write would wait.
 * after() keeps the function alive until the transaction ends. Outside a request (scripts, the worker, the tests)
 * after() throws: there is nothing to keep alive.
 */
function keepAliveUntilSettled(promise: Promise<unknown>): void {
  try {
    after(() => promise.then(
      () => undefined,
      () => undefined,
    ));
  } catch {
    // Outside a request.
  }
}

// PGlite does not stop two processes from opening the same folder (that would corrupt it): `<folder>.lock` holds
// the PID of the process that has it open. It is removed on close and when the process exits; a lock of a dead
// process (killed with Ctrl+C) is taken over.
type LockState = { held: Set<string>; exitHook: boolean };
const lockState = ((globalThis as unknown as { __dominiaDbLocks?: LockState }).__dominiaDbLocks ??= {
  held: new Set(),
  exitHook: false,
});

function lockPid(lockFile: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockFile, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** An empty or unreadable lock written less than 5 s ago: another process is still writing its PID into it. */
function isFreshLock(lockFile: string): boolean {
  try {
    return Date.now() - fs.statSync(lockFile).mtimeMs < 5_000;
  } catch {
    return false;
  }
}

function displayPath(dataDir: string): string {
  const relative = path.relative(process.cwd(), dataDir);
  return (relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : dataDir).split(path.sep).join("/");
}

function acquireLock(dataDir: string): void {
  const lockFile = `${dataDir}.lock`;
  const inUse = () =>
    new Error(`La base local (${displayPath(dataDir)}) está abierta en otro proceso (¿pnpm dev en marcha?). Ciérralo y vuelve a probar.`);
  // Created with "wx" (fails if it already exists), so two processes starting at the same instant can't both take it.
  // A lock left by a process that no longer exists (or an empty one older than a few seconds) is removed and taken again.
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = lockPid(lockFile);
      if (pid === process.pid) break;
      if (pid !== null ? isProcessAlive(pid) : isFreshLock(lockFile)) throw inUse();
      if (attempt > 0) throw inUse();
      fs.rmSync(lockFile, { force: true });
    }
  }
  lockState.held.add(lockFile);
  if (!lockState.exitHook) {
    lockState.exitHook = true;
    process.once("exit", () => {
      for (const file of lockState.held) removeOwnLock(file);
    });
  }
}

function releaseLock(dataDir: string): void {
  const lockFile = `${dataDir}.lock`;
  lockState.held.delete(lockFile);
  removeOwnLock(lockFile);
}

function removeOwnLock(lockFile: string): void {
  try {
    if (lockPid(lockFile) === process.pid) fs.rmSync(lockFile, { force: true });
  } catch {
    // Left behind: the next process sees a dead PID and takes it over.
  }
}

type Connection = { key: string; database: Database; close: () => Promise<void>; server?: boolean; lastUsedAt?: number };

/**
 * A server connection unused for this long is not reused: opened again instead. On Vercel a function waits frozen
 * between requests, and on the way back its sockets may be dead (the network drops idle flows without telling
 * anyone): a query sent on one waits for an answer that never comes, until the function times out (504). Reconnecting
 * costs one handshake with the pooler.
 */
export const SERVER_IDLE_RESET_MS = 30_000;

/** Identity of a database: the same folder is the same database, whatever the URL that names it. */
function databaseKey(url: string, target: DatabaseTarget): string {
  if (target.kind === "server") return `server:${target.url}`;
  if (target.kind === "embedded") return `embedded:${target.dataDir}`;
  return `memory:${url.trim()}`;
}

function connect(target: DatabaseTarget, key: string, max?: number): Connection {
  if (target.kind === "server") {
    const client = postgres(target.url, { ...serverConnectionOptions(target.url), ...(max ? { max } : {}) });
    return {
      key,
      database: withWriteLock(drizzlePostgres(client, { schema }) as Database),
      // In-flight queries get a few seconds; one stuck on a dead socket then fails instead of hanging.
      close: () => client.end({ timeout: 10 }),
      server: true,
      lastUsedAt: Date.now(),
    };
  }
  if (target.kind === "memory") {
    const client = createPglite();
    return { key, database: withWriteLock(drizzlePglite(client, { schema }) as Database), close: () => client.close() };
  }
  // PGlite creates the folder itself, but not its parent (data/).
  fs.mkdirSync(path.dirname(target.dataDir), { recursive: true });
  acquireLock(target.dataDir);
  try {
    const client = createPglite(target.dataDir);
    const close = async () => {
      try {
        await client.close();
      } finally {
        releaseLock(target.dataDir);
      }
    };
    return { key, database: withWriteLock(drizzlePglite(client, { schema }) as Database), close };
  } catch (error) {
    releaseLock(target.dataDir);
    throw error;
  }
}

// Survives Next.js dev hot reloads (one connection per process); keyed by database so tests can switch.
const globalCache = globalThis as unknown as { __dominiaDb?: Connection };

/** The Drizzle instance for DATABASE_URL, created on first use (never at import time). */
export function getDb(): Database {
  const url = databaseUrlFromEnv();
  const target = resolveDatabaseTarget(url);
  const key = databaseKey(url, target);
  const cached = globalCache.__dominiaDb;
  const now = Date.now();
  if (cached?.key === key && !(cached.server && now - (cached.lastUsedAt ?? now) > SERVER_IDLE_RESET_MS)) {
    cached.lastUsedAt = now;
    return cached.database;
  }
  globalCache.__dominiaDb = undefined;
  cached?.close().catch(() => undefined);
  const connection = connect(target, key);
  globalCache.__dominiaDb = connection;
  return connection.database;
}

/** Closes the shared connection (scripts, the worker and the tests); the next query opens it again. */
export async function closeDb(): Promise<void> {
  const cached = globalCache.__dominiaDb;
  globalCache.__dominiaDb = undefined;
  await cached?.close();
}

/**
 * The database of `url` for one job (src/db/migrate.ts): the shared connection when it is already open on that
 * database (PGlite must not open a folder twice; closing it stays with closeDb), otherwise a connection of its own
 * that `close` ends.
 */
export function openDatabase(url: string): { database: Database; target: DatabaseTarget; close: () => Promise<void> } {
  const target = resolveDatabaseTarget(url);
  const key = databaseKey(url, target);
  const cached = globalCache.__dominiaDb;
  if (cached?.key === key) return { database: cached.database, target, close: async () => {} };
  const connection = connect(target, key, 1);
  return { database: connection.database, target, close: connection.close };
}

/**
 * Tests only (src/test/setup.ts): makes `client`, an in-memory PGlite already migrated, the database of the current
 * DATABASE_URL (`pglite:memory#<id>`), so getDb() and `db` use it until closeDb().
 */
export async function useTestDatabase(client: PGlite): Promise<void> {
  const url = databaseUrlFromEnv();
  const target = resolveDatabaseTarget(url);
  if (target.kind !== "memory") throw new Error("useTestDatabase: DATABASE_URL must be pglite:memory#<id>.");
  await closeDb();
  await client.exec(SEARCH_PATH);
  globalCache.__dominiaDb = {
    key: databaseKey(url, target),
    database: withWriteLock(drizzlePglite(client, { schema }) as Database),
    close: () => client.close(),
  };
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

/** Rows of a raw `execute()` result: postgres.js returns the rows themselves, PGlite `{ rows }`. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  if (Array.isArray(rows)) return rows as T[];
  throw new TypeError("rowsOf: not the result of execute().");
}

/** A UNIQUE constraint failed (SQLSTATE 23505), on the driver error or its `cause` (Drizzle wraps driver errors). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export { schema };
