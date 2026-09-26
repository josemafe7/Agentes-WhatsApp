// `pnpm db:fresh [--yes] [--remote-i-know]`: deletes everything and leaves an empty installation; the next visit
// opens the setup wizard ([ARR-17]).
import { closeDb } from "../src/db";
import { loadLocalEnv } from "./lib/cli";
import { runResetCommand } from "./lib/reset-command";

async function main(): Promise<void> {
  loadLocalEnv();
  try {
    process.exitCode = await runResetCommand("fresh", process.argv.slice(2));
  } catch (error) {
    console.error("No se pudo dejar la instalación vacía.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

void main();
