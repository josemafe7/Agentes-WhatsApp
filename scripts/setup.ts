// `pnpm run setup` (always with `run`: bare `pnpm setup` is a pnpm command that edits the computer's PATH).
// Prepares the local installation: .env.local with secrets, data/, migrations and the demo ([ARR-02], [ARR-03]).
import { closeDb } from "../src/db";
import { runSetup } from "./lib/setup";

async function main(): Promise<void> {
  console.log("Preparando la instalación…");
  try {
    await runSetup({ rootDir: process.cwd() });
    console.log("Instalación preparada.");
  } catch (error) {
    console.error("No se pudo preparar la instalación.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
