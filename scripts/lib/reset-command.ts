// `pnpm db:reset` (delete everything → migrate → demo, [ARR-16]) and `pnpm db:fresh` (delete everything → migrate →
// empty installation with the setup wizard, [ARR-17]). Both delete data: they ask first unless --yes, and refuse a
// database that is not a local file unless --remote-i-know.
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { DemoRefusedError, loadDemo } from "../../seed";
import { closeDb, databaseUrlFromEnv, db, isLocalDatabaseUrl } from "../../src/db";
import { localDatabasePath, migrateDatabase } from "../../src/db/migrate";
import { DEFAULT_SECTOR, getSectorPreset, isSector, unknownSectorMessage } from "../../src/lib/sectors";
import { DISK_STORAGE_DIR, isBlobStorageConfigured } from "../../src/server/adapters/file-storage";
import { clearAllData } from "../../src/server/demo/clear-data";
import { demoRefusal, type DemoEnvironment } from "../../src/server/demo/guard";
import { FRESH_MARKER_KEY, getInstallState, type InstallState } from "../../src/server/demo/install-state";
import { setKv } from "../../src/server/kv";
import { askYesNo, consoleOutput, parseOptions, printDemoUsers, UsageError, type Output } from "./cli";

export type ResetMode = "demo" | "fresh";

type ResetOptions = {
  out?: Output;
  env?: DemoEnvironment;
  now?: Date;
  /** Asks the confirmation question (tests answer it). */
  confirm?: (question: string) => Promise<boolean>;
};

/** The database file is open in another process (the app or the worker); nothing was deleted. */
export class DatabaseInUseError extends Error {}

/** Returns the process exit code. Expected refusals are printed; unexpected errors are thrown. */
export async function runResetCommand(mode: ResetMode, argv: readonly string[], options: ResetOptions = {}): Promise<number> {
  const out = options.out ?? consoleOutput;
  try {
    return await reset(mode, argv, out, options);
  } catch (error) {
    if (error instanceof UsageError || error instanceof DemoRefusedError || error instanceof DatabaseInUseError) {
      out.error(error.message);
      return 1;
    }
    throw error;
  }
}

async function reset(mode: ResetMode, argv: readonly string[], out: Output, options: ResetOptions): Promise<number> {
  const flags = parseOptions(argv, {
    yes: { type: "boolean" },
    "remote-i-know": { type: "boolean" },
    sector: { type: "string" },
    "force-demo": { type: "boolean" },
  });
  if (mode === "fresh" && (flags.sector !== undefined || flags["force-demo"])) {
    throw new UsageError("--sector y --force-demo solo valen para pnpm db:reset: pnpm db:fresh no carga la demo.");
  }
  const sector = flags.sector ?? DEFAULT_SECTOR;
  if (!isSector(sector)) throw new UsageError(unknownSectorMessage(sector));
  if (mode === "demo") {
    const refusal = demoRefusal(options.env ?? process.env, { forceDemo: flags["force-demo"] });
    if (refusal) throw new DemoRefusedError(`No se borra nada. ${refusal}`);
  }

  const url = databaseUrlFromEnv();
  if (!isLocalDatabaseUrl(url) && !flags["remote-i-know"]) {
    throw new UsageError(
      "La base de datos no es un archivo local (DATABASE_URL apunta a Turso u otro servidor): por seguridad no se borra. Si de verdad quieres vaciarla, añade --remote-i-know.",
    );
  }
  const file = localDatabasePath(url);

  out.log(`Se va a borrar TODO lo que hay en ${file ?? "la base de datos remota"}: usuarios, ajustes, canales, contactos, conversaciones y citas.`);
  if ((await readState(file))?.kind === "real") {
    out.log("¡Atención! Esta base de datos tiene los datos de un negocio real, no es la demo.");
  }
  out.log(
    mode === "demo"
      ? `Después se cargará la demo de ${getSectorPreset(sector).label}.`
      : "Después quedará una instalación vacía: al abrir la app aparecerá el asistente de arranque.",
  );
  if (file) out.log("Antes para la app (pnpm dev) y el worker si están en marcha.");
  if (!flags.yes) {
    if (!options.confirm && !process.stdin.isTTY) {
      throw new UsageError("No se ha borrado nada: sin una terminal donde preguntar, añade --yes para confirmar.");
    }
    const confirm = options.confirm ?? askYesNo;
    if (!(await confirm("¿Seguro que quieres borrarlo todo?"))) {
      out.log("No se ha borrado nada.");
      return 1;
    }
  }

  closeDb();
  if (file) {
    await deleteLocalDatabase(file);
    // Uploaded files of this installation go too (disk storage next to the database, as in data/).
    if (!isBlobStorageConfigured() && path.dirname(file) === path.dirname(DISK_STORAGE_DIR)) {
      fs.rmSync(DISK_STORAGE_DIR, { recursive: true, force: true });
    }
  } else {
    await db.transaction((tx) => clearAllData(tx));
  }
  await migrateDatabase({ url });

  if (mode === "demo") {
    const result = await loadDemo({ sector, now: options.now });
    out.log(`Listo: demo de ${result.businessName} (${getSectorPreset(result.sector).label}) recién cargada.`);
    printDemoUsers(out, result.users, result.password);
  } else {
    await setKv(FRESH_MARKER_KEY, true);
    out.log("Listo: instalación vacía. Abre la app y sigue el asistente de arranque.");
    out.log("Si va a ser la de un negocio real, pon DEMO_MODE=false en .env.local para quitar el aviso «Modo demo».");
  }
  return 0;
}

/** What the database holds now, or null when it does not exist yet or cannot be read. */
async function readState(file: string | null): Promise<InstallState | null> {
  if (file && !fs.existsSync(file)) return null;
  try {
    return await getInstallState();
  } catch {
    // An outdated or damaged database is still deleted; the state only adds a warning.
    return null;
  } finally {
    closeDb();
  }
}

const LOCKED_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const DELETE_ATTEMPTS = 20;
const DELETE_RETRY_MS = 100;

/**
 * Deletes a local database and its journal files. Windows refuses to delete a file that is open. libSQL closes a
 * connection for good only when its statements are garbage-collected, so this process may still hold the file
 * after closing it: the first time the file is locked, it runs the garbage collector and retries for a while. If
 * it stays locked, another process (the app or the worker) is using it. The main file goes first, so a database
 * in use is left whole.
 */
export async function deleteLocalDatabase(file: string): Promise<void> {
  let collected = false;
  for (const target of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    for (let attempt = 1; ; attempt++) {
      try {
        fs.rmSync(target, { force: true });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!code || !LOCKED_CODES.has(code)) throw error;
        if (attempt >= DELETE_ATTEMPTS) {
          throw new DatabaseInUseError(
            "La base de datos está en uso: para la app (pnpm dev) y el worker, y vuelve a lanzar la orden. No se ha borrado nada.",
          );
        }
        if (!collected) {
          collectGarbage();
          collected = true;
        }
        await new Promise((resolve) => setTimeout(resolve, DELETE_RETRY_MS));
      }
    }
  }
}

/** Runs V8's garbage collector (exposed at runtime: scripts are not started with --expose-gc). */
function collectGarbage(): void {
  v8.setFlagsFromString("--expose-gc");
  const gc: unknown = vm.runInNewContext("gc");
  if (typeof gc === "function") gc();
}
