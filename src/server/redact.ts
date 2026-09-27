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
  [/\b(password|passwd|token|secret|api[_-]?key|access_token|refresh_token|client_secret|code)=([^&\s"']+)/gi, `$1=${REDACTED}`],
];

/** Replaces token-looking substrings (Bearer headers, API keys, Meta and Telegram tokens, JWTs, ?token=…). */
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
const DATABASE_CODE = /^[A-Z][A-Z0-9_]{0,59}$/;

/** The database's own code of a failed query (SQLITE_BUSY, SQLITE_CONSTRAINT_UNIQUE…), never its values. */
function databaseCode(error: unknown): string | null {
  const cause = error instanceof DrizzleQueryError ? (error.cause as { code?: unknown; extendedCode?: unknown } | undefined) : undefined;
  const code = [cause?.extendedCode, cause?.code].find((value): value is string => typeof value === "string" && DATABASE_CODE.test(value));
  return code ?? null;
}

/** Safe, short message of an unknown error for logs and stored errors. */
export function safeErrorMessage(error: unknown, maxLength = 500): string {
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : "Error desconocido";
  const failedQuery = message.indexOf(FAILED_QUERY);
  if (error instanceof DrizzleQueryError || failedQuery >= 0) {
    const code = databaseCode(error);
    message = `${failedQuery > 0 ? message.slice(0, failedQuery) : ""}Error de la base de datos${code ? ` (${code})` : ""}.`;
  }
  const redacted = redactSecrets(message);
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}
