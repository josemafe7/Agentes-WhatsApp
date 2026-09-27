// `pnpm seed [--sector=<sector>] [--force-demo]`: loads the demo of a sector ([ARR-10], [ARR-18], [ARR-19]).
import { closeDb } from "../src/db";
import { loadLocalEnv } from "./lib/cli";
import { runSeedCommand } from "./lib/seed-command";

async function main(): Promise<void> {
  loadLocalEnv();
  try {
    process.exitCode = await runSeedCommand(process.argv.slice(2));
  } catch (error) {
    console.error("No se pudo cargar la demo.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
