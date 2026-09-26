// Prepares both e2e databases before the app is built and started (docs/testing.md):
//   demo  (DATABASE_URL)            delete → migrate → demo seed → e2e-only users
//   fresh (E2E_FRESH_DATABASE_URL)  delete → migrate (empty install: the setup wizard)
// It runs as the first part of the demo server's webServer command because Playwright starts its webServers
// before globalSetup: preparing the files there would delete databases the servers already hold open.
// Only files called data/e2e*.db are ever deleted: never data/local.db.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RETRY_DELAY_MS = 250;
const DELETE_ATTEMPTS = 20;

function log(message) {
  process.stderr.write(`[e2e] ${message}\n`);
}

function databaseFile(url, variable) {
  if (!url?.startsWith("file:")) throw new Error(`${variable} debe ser un archivo local (file:…), no «${url ?? ""}».`);
  const file = path.resolve(process.cwd(), url.slice("file:".length).split("?")[0]);
  const dataDir = path.resolve(process.cwd(), "data");
  if (path.dirname(file) !== dataDir || !/^e2e[\w-]*\.db$/.test(path.basename(file))) {
    throw new Error(`${variable} debe apuntar a data/e2e*.db; se niega a borrar ${file}.`);
  }
  return file;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Deletes the database and its WAL/SHM/journal files. Windows keeps them locked briefly after a server stops. */
function deleteDatabase(file) {
  for (const target of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        fs.rmSync(target, { force: true });
        break;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "";
        if ((code === "EBUSY" || code === "EPERM") && attempt < DELETE_ATTEMPTS) {
          sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new Error(`No se pudo borrar ${target} (${code}). ¿Sigue abierta otra app de pruebas en los puertos 3100 o 3102?`);
      }
    }
  }
}

function run(command, env) {
  const childEnv = { ...process.env, ...env };
  // The seed refuses NODE_ENV=production (a published app); these are throw-away test databases.
  delete childEnv.NODE_ENV;
  // One command string (no args array): shell + args is deprecated in Node 24 (DEP0190).
  const result = spawnSync(command, { shell: true, stdio: ["ignore", "inherit", "inherit"], env: childEnv });
  if (result.status !== 0) throw new Error(`«${command}» terminó con el código ${result.status ?? result.signal}.`);
}

function main() {
  const demoUrl = process.env.DATABASE_URL;
  const freshUrl = process.env.E2E_FRESH_DATABASE_URL;
  const demoFile = databaseFile(demoUrl, "DATABASE_URL");
  const freshFile = databaseFile(freshUrl, "E2E_FRESH_DATABASE_URL");
  if (demoFile === freshFile) throw new Error("La base de la demo y la vacía deben ser archivos distintos.");

  log("Preparando las bases de datos de las pruebas…");
  deleteDatabase(demoFile);
  deleteDatabase(freshFile);

  run("pnpm run db:migrate", { DATABASE_URL: demoUrl });
  run("pnpm run seed", { DATABASE_URL: demoUrl, DEMO_MODE: "true" });
  run("pnpm exec tsx --conditions=react-server e2e/support/create-e2e-users.ts", { DATABASE_URL: demoUrl });

  run("pnpm run db:migrate", { DATABASE_URL: freshUrl });
  log("Bases de datos listas: demo en data/e2e.db y vacía en data/e2e-fresh.db.");
}

try {
  main();
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
