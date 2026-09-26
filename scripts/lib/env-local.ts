// Creates `.env.local` from `.env.example` with fresh random secrets and the demo on ([ARR-02]). An existing
// `.env.local` keeps every value it has ([ARR-03]); only a secret that is missing or empty is generated.
// Secret values are never printed or returned.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const SECRET_BYTES = 32;

/** Secrets the installation needs, with how each one is generated. */
export const GENERATED_SECRETS: Readonly<Record<string, () => string>> = {
  // AES-256-GCM key: exactly 32 random bytes in Base64 (src/server/crypto.ts).
  APP_ENCRYPTION_KEY: () => randomBytes(SECRET_BYTES).toString("base64"),
  BETTER_AUTH_SECRET: () => randomBytes(SECRET_BYTES).toString("base64url"),
  CRON_SECRET: () => randomBytes(SECRET_BYTES).toString("base64url"),
};

/** Values a new local `.env.local` always gets. */
const NEW_FILE_VALUES: Readonly<Record<string, string>> = { DEMO_MODE: "true" };

export type EnvLocalResult = {
  /** The file did not exist and was created from .env.example. */
  created: boolean;
  /** Names (never values) of the secrets generated into an existing file. */
  filled: string[];
};

const ASSIGNMENT = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/;

export function ensureEnvLocal(rootDir: string): EnvLocalResult {
  const target = path.join(rootDir, ".env.local");
  if (!fs.existsSync(target)) {
    const example = path.join(rootDir, ".env.example");
    if (!fs.existsSync(example)) throw new Error("Falta .env.example: no se puede crear .env.local.");
    const values = { ...NEW_FILE_VALUES, ...generateAll() };
    const content = setValues(fs.readFileSync(example, "utf8"), values);
    // `wx`: never overwrite a file created meanwhile. Mode 600 keeps it private on Linux and macOS.
    fs.writeFileSync(target, content, { flag: "wx", mode: 0o600 });
    return { created: true, filled: [] };
  }
  const current = fs.readFileSync(target, "utf8");
  const parsed = parseEnv(current);
  const missing = Object.keys(GENERATED_SECRETS).filter((name) => !parsed[name]?.trim());
  if (missing.length === 0) return { created: false, filled: [] };
  const values = Object.fromEntries(missing.map((name) => [name, GENERATED_SECRETS[name]()]));
  fs.writeFileSync(target, setValues(current, values));
  return { created: false, filled: missing };
}

function generateAll(): Record<string, string> {
  return Object.fromEntries(Object.entries(GENERATED_SECRETS).map(([name, generate]) => [name, generate()]));
}

/**
 * Sets `values` in the text of an env file: an existing `NAME=` line is replaced, a missing one is appended.
 * Comments and every other line stay exactly as they were. Only used for names whose value is empty or new.
 */
function setValues(text: string, values: Readonly<Record<string, string>>): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const pending = new Map(Object.entries(values));
  const lines = text.split(/\r?\n/).map((line) => {
    const match = ASSIGNMENT.exec(line);
    const name = match?.[2];
    if (!match || name === undefined || !pending.has(name)) return line;
    const value = pending.get(name);
    pending.delete(name);
    return `${match[1]}${name}=${value}`;
  });
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const [name, value] of pending) lines.push(`${name}=${value}`);
  return lines.join(newline) + newline;
}
