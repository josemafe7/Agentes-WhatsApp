// `pnpm db:migrate`: brings the database of DATABASE_URL up to date with the migrations in drizzle/: the embedded one
// (data/pglite, created if missing) or Supabase. Safe to repeat: applied migrations are skipped. The messages name the
// database but never show its URL or password, not even inside a driver's error.
import { databaseUrlFromEnv, resolveDatabaseTarget } from "../../src/db";
import { migrateDatabase } from "../../src/db/migrate";
import { consoleOutput, describeDatabase, type Output } from "./cli";

const HIDDEN = "[oculto]";
/** A connection string (postgres:// or postgresql://) inside a message. */
const CONNECTION_STRING = /postgres(?:ql)?:\/\/\S*/gi;

/** Returns the process exit code. */
export async function runMigrateCommand(options: { out?: Output } = {}): Promise<number> {
  const out = options.out ?? consoleOutput;
  const url = databaseUrlFromEnv();
  let where = "la base de datos";
  try {
    where = describeDatabase(resolveDatabaseTarget(url));
    await migrateDatabase(url);
    out.log(`Base de datos al día: ${where}.`);
    return 0;
  } catch (error) {
    out.error(`No se pudieron aplicar las migraciones en ${where}.`);
    for (const message of errorMessages(error)) out.error(withoutConnection(message, url));
    return 1;
  }
}

/** The message of an error and of its causes: Drizzle wraps the driver's error, which says why (password, network…). */
function errorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth++) {
    messages.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages;
}

/** The message without the connection string or its password. */
function withoutConnection(message: string, url: string): string {
  let result = message.replace(CONNECTION_STRING, HIDDEN);
  for (const password of passwordsOf(url)) result = result.split(password).join(HIDDEN);
  return result;
}

/** The password of a connection string, as written and decoded. */
function passwordsOf(url: string): string[] {
  let raw = "";
  try {
    raw = new URL(url).password;
  } catch {
    // Not a URL: there is no password to look for (and CONNECTION_STRING hides it whole).
  }
  if (!raw) return [];
  try {
    return [...new Set([raw, decodeURIComponent(raw)])];
  } catch {
    return [raw];
  }
}
