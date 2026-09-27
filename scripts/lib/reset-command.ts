// `pnpm db:reset` (delete everything → migrate → demo, [ARR-16]) and `pnpm db:fresh` (delete everything → migrate →
// empty installation with the setup wizard, [ARR-17]). Both delete data: they ask first unless --yes, and refuse a
// database on a server (Supabase) unless --remote-i-know.
import fs from "node:fs";
import path from "node:path";
import { DemoRefusedError, loadDemo } from "../../seed";
import { closeDb, databaseUrlFromEnv, db, resolveDatabaseTarget, type DatabaseTarget } from "../../src/db";
import { migrateDatabase } from "../../src/db/migrate";
import { DEFAULT_SECTOR, getSectorPreset, isSector, unknownSectorMessage } from "../../src/lib/sectors";
import { DISK_STORAGE_DIR, isSupabaseStorageConfigured } from "../../src/server/adapters/file-storage";
import { clearAllData } from "../../src/server/demo/clear-data";
import { demoRefusal, type DemoEnvironment } from "../../src/server/demo/guard";
import { FRESH_MARKER_KEY, getInstallState, type InstallState } from "../../src/server/demo/install-state";
import { setKv } from "../../src/server/kv";
import { askYesNo, consoleOutput, describeDatabase, parseOptions, printDemoUsers, UsageError, type Output } from "./cli";

export type ResetMode = "demo" | "fresh";

type ResetOptions = {
  out?: Output;
  env?: DemoEnvironment;
  now?: Date;
  /** Asks the confirmation question (tests answer it). */
  confirm?: (question: string) => Promise<boolean>;
};

/** The embedded database is open in another process (the app or the worker); nothing was deleted. */
export class DatabaseInUseError extends Error {
  constructor() {
    super("La base de datos está en uso: para la app (pnpm dev) y el worker, y vuelve a lanzar la orden. No se ha borrado nada.");
  }
}

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
  const target = databaseTarget(url);
  if (target.kind === "server" && !flags["remote-i-know"]) {
    throw new UsageError(
      "La base de datos no es la local (DATABASE_URL apunta a Supabase u otro servidor de Postgres): por seguridad no se borra. Si de verdad quieres vaciarla, añade --remote-i-know.",
    );
  }
  const dataDir = target.kind === "embedded" ? target.dataDir : null;
  if (dataDir && openInAnotherProcess(dataDir)) throw new DatabaseInUseError();

  out.log(`Se va a borrar TODO lo que hay en ${describeDatabase(target)}: usuarios, ajustes, canales, contactos, conversaciones y citas.`);
  if ((await readState(dataDir))?.kind === "real") {
    out.log("¡Atención! Esta base de datos tiene los datos de un negocio real, no es la demo.");
  }
  out.log(
    mode === "demo"
      ? `Después se cargará la demo de ${getSectorPreset(sector).label}.`
      : "Después quedará una instalación vacía: al abrir la app aparecerá el asistente de arranque.",
  );
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

  if (dataDir) {
    // PGlite keeps its folder open: this process lets go of it first. A damaged database that fails to close is
    // deleted all the same (closing always releases the lock).
    await closeDb().catch(() => undefined);
    deleteEmbeddedDatabase(dataDir);
    // Uploaded files of this installation go too (disk storage next to the database, as in data/).
    if (!isSupabaseStorageConfigured() && path.dirname(dataDir) === path.dirname(DISK_STORAGE_DIR)) {
      fs.rmSync(DISK_STORAGE_DIR, { recursive: true, force: true });
    }
  } else {
    // Supabase (with --remote-i-know), or the in-memory database of the tests: emptied, not deleted.
    await db.transaction((tx) => clearAllData(tx));
  }
  await migrateDatabase(url);

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

/** Where DATABASE_URL points; one the app cannot use (Turso's libsql://…) is refused with the reason. */
function databaseTarget(url: string): DatabaseTarget {
  try {
    return resolveDatabaseTarget(url);
  } catch (error) {
    throw new UsageError(`No se ha borrado nada. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** What the database holds now, or null when it does not exist yet or cannot be read. */
async function readState(dataDir: string | null): Promise<InstallState | null> {
  if (dataDir && !fs.existsSync(dataDir)) return null;
  try {
    return await getInstallState();
  } catch {
    // An outdated or damaged database is still deleted; the state only adds a warning.
    return null;
  }
}

/**
 * True while another live process has the embedded database open: src/db/index.ts keeps the PID of the process
 * that opened the folder in `<folder>.lock`, and takes over the lock of a process that has ended.
 */
function openInAnotherProcess(dataDir: string): boolean {
  let pid: number;
  try {
    pid = Number.parseInt(fs.readFileSync(`${dataDir}.lock`, "utf8").trim(), 10);
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const LOCKED_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

/**
 * Deletes an embedded database: its folder and its lock file. It refuses while another process has the folder open
 * (the app or the worker), so a database in use is never deleted under it. Windows may keep a file locked for a
 * moment after a process closes it: the deletion retries for a while before giving up.
 */
export function deleteEmbeddedDatabase(dataDir: string): void {
  if (openInAnotherProcess(dataDir)) throw new DatabaseInUseError();
  try {
    for (const target of [dataDir, `${dataDir}.lock`]) {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && LOCKED_CODES.has(code)) throw new DatabaseInUseError();
    throw error;
  }
}
