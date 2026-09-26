// `pnpm seed [--sector=<sector>] [--force-demo]`: loads the demo of a sector ([ARR-10]), replacing the demo
// already there ("instead of the hair salon"). Refuses an unknown sector before opening the database, refuses
// outside local demos unless --force-demo ([ARR-18]) and always refuses real business data ([ARR-19]).
import { DemoRefusedError, loadDemo } from "../../seed";
import { migrateDatabase } from "../../src/db/migrate";
import { DEFAULT_SECTOR, getSectorPreset, isSector, unknownSectorMessage } from "../../src/lib/sectors";
import { demoRefusal, type DemoEnvironment } from "../../src/server/demo/guard";
import { consoleOutput, parseOptions, printDemoUsers, UsageError, type Output } from "./cli";

type SeedCommandOptions = { out?: Output; env?: DemoEnvironment; now?: Date };

/** Returns the process exit code. Expected refusals are printed; unexpected errors are thrown. */
export async function runSeedCommand(argv: readonly string[], options: SeedCommandOptions = {}): Promise<number> {
  const out = options.out ?? consoleOutput;
  try {
    await seed(argv, out, options);
    return 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof DemoRefusedError) {
      out.error(error.message);
      return 1;
    }
    throw error;
  }
}

async function seed(argv: readonly string[], out: Output, options: SeedCommandOptions): Promise<void> {
  const flags = parseOptions(argv, {
    sector: { type: "string" },
    "force-demo": { type: "boolean" },
  });
  const sector = flags.sector ?? DEFAULT_SECTOR;
  if (!isSector(sector)) throw new UsageError(unknownSectorMessage(sector));
  const refusal = demoRefusal(options.env ?? process.env, { forceDemo: flags["force-demo"] });
  if (refusal) throw new DemoRefusedError(`No se carga la demo. ${refusal}`);

  await migrateDatabase();
  const result = await loadDemo({ sector, replaceDemo: true, now: options.now });
  const verb = result.replaced ? "sustituida por" : "cargada:";
  out.log(`Demo ${verb} ${result.businessName} (${getSectorPreset(result.sector).label}).`);
  printDemoUsers(out, result.users, result.password);
}
