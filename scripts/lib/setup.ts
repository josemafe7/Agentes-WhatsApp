// `pnpm run setup` (and the first `pnpm dev`): prepares a local installation ([ARR-02]) and can be repeated
// without changing anything ([ARR-03]): secrets are never regenerated, data is never duplicated or deleted.
import fs from "node:fs";
import path from "node:path";
import { loadDemo } from "../../seed";
import { databaseUrlFromEnv, isLocalDatabaseUrl } from "../../src/db";
import { migrateDatabase } from "../../src/db/migrate";
import { DEFAULT_SECTOR, getSectorPreset } from "../../src/lib/sectors";
import { demoRefusal } from "../../src/server/demo/guard";
import { getInstallState } from "../../src/server/demo/install-state";
import { consoleOutput, loadLocalEnv, printDemoUsers, type Output } from "./cli";
import { ensureEnvLocal, type EnvLocalResult } from "./env-local";

export type SetupDemoOutcome =
  /** The demo was loaded now. */
  | "loaded"
  /** The demo was already there. */
  | "demo"
  /** Real business data: nothing touched. */
  | "real"
  /** Emptied on purpose with `pnpm db:fresh`: the setup wizard runs on the next visit. */
  | "fresh"
  /** Empty, but the demo does not belong here (DEMO_MODE off, production or a remote database). */
  | "skipped";

export type SetupResult = { env: EnvLocalResult; demo: SetupDemoOutcome };

export async function runSetup(options: { rootDir: string; out?: Output; now?: Date }): Promise<SetupResult> {
  const { rootDir, out = consoleOutput } = options;

  const env = ensureEnvLocal(rootDir);
  if (env.created) out.log("Creado .env.local con secretos nuevos y la demo activada (DEMO_MODE=true).");
  else if (env.filled.length > 0) out.log(`Añadido a .env.local lo que faltaba: ${env.filled.join(", ")}.`);
  else out.log(".env.local ya existe: no se cambia.");
  loadLocalEnv(rootDir);

  fs.mkdirSync(path.join(rootDir, "data"), { recursive: true });
  const url = databaseUrlFromEnv();
  await migrateDatabase({ url });
  out.log("Base de datos al día.");

  const state = await getInstallState();
  if (state.kind === "demo") {
    out.log("La demo ya estaba cargada: no se toca nada.");
    return { env, demo: "demo" };
  }
  if (state.kind === "real") {
    out.log("La base de datos ya tiene los datos del negocio: no se toca nada.");
    return { env, demo: "real" };
  }
  if (state.fresh) {
    out.log("Instalación vacía (pnpm db:fresh): al abrir la app aparecerá el asistente de arranque.");
    return { env, demo: "fresh" };
  }
  const refusal = isLocalDatabaseUrl(url)
    ? demoRefusal(process.env)
    : "La base de datos no es local: la demo solo se carga sola en local.";
  if (refusal) {
    out.log(`Instalación vacía: no se carga la demo. ${refusal}`);
    return { env, demo: "skipped" };
  }

  const demo = await loadDemo({ sector: DEFAULT_SECTOR, now: options.now });
  out.log(`Demo cargada: ${demo.businessName} (${getSectorPreset(demo.sector).label}).`);
  printDemoUsers(out, demo.users, demo.password);
  return { env, demo: "loaded" };
}
