// `pnpm seed:embeddings` ([ARR-13]): recalculates the demo knowledge embeddings stored in the repository
// (seed/fixtures/embeddings.json) with the default model. Needs OPENROUTER_API_KEY in .env.local and costs a little
// AI; without it, it refuses and changes nothing. The work is in seed/knowledge/embeddings-command.ts.
import { runSeedEmbeddingsCommand } from "../seed/knowledge/embeddings-command";
import { safeErrorMessage } from "../src/server/redact";
import { loadLocalEnv } from "./lib/cli";

async function main(): Promise<void> {
  // process.loadEnvFile of .env.local, without overriding what is already set in the shell.
  loadLocalEnv();
  try {
    process.exitCode = await runSeedEmbeddingsCommand();
  } catch (error) {
    // A demo document that cannot be read, for example. Redacted anyway: the key never reaches the terminal.
    console.error("No se han podido calcular los embeddings de la demo. No se ha cambiado nada.");
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
