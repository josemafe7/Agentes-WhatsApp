// Keeps secrets and personal data out of logs, stored errors and the audit log ([SEG-02], [SEG-14]).
import "server-only";
import { DrizzleQueryError } from "drizzle-orm";

export const REDACTED = "[redactado]";
const MAX_DEPTH = 6;

const SECRET_KEY_PATTERN = /pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|^pin$|pin_|signature|credential|enc$/i;
const SECRET_VALUE_PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\bsk-[A-Za-z0-9-_]{12,}/g, REDACTED],
  [/\bEAA[A-Za-z0-9]{20,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [/\bbot\d+:[A-Za-z0-9_-]{20,}/g, `bot${REDACTED}`],
  // Supabase API keys: sb_secret_… and sb_publishable_….
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/g, `sb_$1_${REDACTED}`],
  // User and password of a Postgres connection string, up to the last «@» (a password may carry «@» or «/»).
  [/\b(postgres(?:ql)?:\/\/)[^\s"'<>]*@/gi, `$1${REDACTED}@`],
  [/\b(password|passwd|token|secret|api[_-]?key|access_token|refresh_token|client_secret|code)=([^&\s"']+)/gi, `$1=${REDACTED}`],
];

/**
 * Replaces token-looking substrings (Bearer headers, API keys, Meta, Telegram and Supabase tokens, JWTs, the
 * credentials of a Postgres connection string, ?token=…).
 */
export function redactSecrets(text: string): string {
  return SECRET_VALUE_PATTERNS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

/** Deep copy with secret-named fields replaced and token-looking strings redacted. */
export function stripSecrets(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : stripSecrets(item, depth + 1);
  }
  return result;
}

/** What Drizzle puts in front of a failed query: the SQL and then EVERY parameter (phones, identifiers, texts…). */
const FAILED_QUERY = "Failed query:";
/** SQLSTATE of a Postgres error: five digits or capital letters (23505 unique_violation, 55P03 lock_not_available…). */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** Constraint names are identifiers; anything else is not shown. */
const CONSTRAINT_NAME = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
/** Code of a driver error that is not Postgres' own (ECONNREFUSED, CONNECT_TIMEOUT…). */
const DRIVER_CODE = /^[A-Z][A-Z0-9_]{0,59}$/;

type PostgresErrorFields = { code: string; constraint_name?: unknown; constraint?: unknown };

/**
 * A Postgres error from postgres.js (PostgresError) or PGlite (DatabaseError): both carry the SQLSTATE in `code` and a
 * `severity`. Their message, detail and where may hold values of the row («Key (email)=(ana@…) already exists»,
 * «invalid input syntax for type integer: "600…"»), and the driver adds the query and its parameters: none is kept.
 */
function postgresError(error: unknown): PostgresErrorFields | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  return typeof code === "string" && SQLSTATE.test(code) && typeof severity === "string" ? (error as PostgresErrorFields) : null;
}

/**
 * The database's own description of a failed query, never its values: SQLSTATE and constraint name (postgres.js calls
 * it `constraint_name`, PGlite `constraint`) of a Postgres error, bare or wrapped by Drizzle, or the code of another
 * driver error wrapped by Drizzle.
 */
function databaseCode(error: unknown): string | null {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  const postgres = postgresError(cause);
  if (postgres) {
    const constraint = [postgres.constraint_name, postgres.constraint].find(
      (value): value is string => typeof value === "string" && CONSTRAINT_NAME.test(value),
    );
    return constraint ? `${postgres.code}, ${constraint}` : postgres.code;
  }
  const code = error instanceof DrizzleQueryError ? (cause as { code?: unknown } | undefined)?.code : undefined;
  return typeof code === "string" && DRIVER_CODE.test(code) ? code : null;
}

/** Safe, short message of an unknown error for logs and stored errors. */
export function safeErrorMessage(error: unknown, maxLength = 500): string {
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : "Error desconocido";
  const failedQuery = message.indexOf(FAILED_QUERY);
  if (error instanceof DrizzleQueryError || postgresError(error) || failedQuery >= 0) {
    const code = databaseCode(error);
    message = `${failedQuery > 0 ? message.slice(0, failedQuery) : ""}Error de la base de datos${code ? ` (${code})` : ""}.`;
  }
  const redacted = redactSecrets(message);
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}
