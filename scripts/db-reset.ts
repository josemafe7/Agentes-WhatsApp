// `pnpm db:reset [--sector=<sector>] [--yes] [--remote-i-know] [--force-demo]`: deletes everything and loads the
// demo again ([ARR-16]).
import { closeDb } from "../src/db";
import { loadLocalEnv } from "./lib/cli";
import { runResetCommand } from "./lib/reset-command";

async function main(): Promise<void> {
  loadLocalEnv();
  try {
    process.exitCode = await runResetCommand("demo", process.argv.slice(2));
  } catch (error) {
    console.error("No se pudo rehacer la demo.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
