// Small helpers shared by the command-line scripts: options, questions, env loading and output.
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { Role } from "../../src/lib/enums";
import { ROLE_LABELS } from "../../src/lib/permissions";

export type Output = { log: (line: string) => void; error: (line: string) => void };
export const consoleOutput: Output = { log: (line) => console.log(line), error: (line) => console.error(line) };

/** Thrown for wrong command-line options; the message is Spanish and ready to show. */
export class UsageError extends Error {}

type Options = NonNullable<ParseArgsConfig["options"]>;

/** Parses `--name=value` / `--flag` options; unknown options and positional arguments are errors. */
export function parseOptions<T extends Options>(argv: readonly string[], options: T) {
  try {
    return parseArgs({ args: [...argv], options, strict: true, allowPositionals: false }).values;
  } catch {
    const known = Object.keys(options).map((name) => `--${name}`).join(", ");
    throw new UsageError(`Opción no válida en «${argv.join(" ")}». Opciones: ${known}.`);
  }
}

/** Loads `.env.local` of `rootDir` into process.env without overriding what is already set. */
export function loadLocalEnv(rootDir: string = process.cwd()): boolean {
  const file = path.join(rootDir, ".env.local");
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

const YES_ANSWERS = new Set(["s", "si", "sí", "y", "yes"]);

/** Asks a yes/no question in the terminal. Without an interactive terminal the answer is «no». */
export async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} (s/N) `);
    return YES_ANSWERS.has(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

/** Prints the demo users table (the same one as in the README). */
export function printDemoUsers(
  out: Output,
  users: readonly { email: string; role: Role }[],
  password: string,
): void {
  const width = Math.max(...users.map((u) => u.email.length));
  out.log(`Usuarios de prueba (contraseña: ${password}):`);
  for (const u of users) out.log(`  ${u.email.padEnd(width)}  ${ROLE_LABELS[u.role]}`);
}
