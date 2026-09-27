// Prepares the e2e databases before the app is built and started (docs/testing.md):
//   demo        (DATABASE_URL)                 delete → migrate → demo seed → e2e-only users → agenda fixtures
//   fresh       (E2E_FRESH_DATABASE_URL)       delete → migrate (empty install: the setup wizard)
//   restaurant  (E2E_RESTAURANT_DATABASE_URL)  delete → migrate → restaurant demo seed (the agenda by capacity)
// Each one is an embedded database (PGlite): a folder under data/ that only its app server opens. The steps run one
// after another, because a PGlite folder is open in one process at a time.
// It runs as the first part of the demo server's webServer command because Playwright starts its webServers
// before globalSetup: preparing the folders there would delete databases the servers already hold open.
// Only folders called data/e2e*-pglite are ever deleted: never data/pglite.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RETRY_DELAY_MS = 100;
const DELETE_RETRIES = 10;

function log(message) {
  process.stderr.write(`[e2e] ${message}\n`);
}

/** Folder of a `pglite:./data/e2e…-pglite` URL. Anything else is refused (the message never repeats the URL). */
function databaseDir(url, variable) {
  if (!url?.startsWith("pglite:")) throw new Error(`${variable} debe ser una base integrada de las pruebas (pglite:./data/e2e…-pglite).`);
  const dir = path.resolve(process.cwd(), url.slice("pglite:".length).trim());
  const dataDir = path.resolve(process.cwd(), "data");
  if (path.dirname(dir) !== dataDir || !/^e2e[\w-]*-pglite$/.test(path.basename(dir))) {
    throw new Error(`${variable} debe apuntar a data/e2e…-pglite; se niega a borrar ${dir}.`);
  }
  return dir;
}

/**
 * Deletes the database folder and its lock file (`<folder>.lock`, src/db/index.ts). Windows keeps files locked
 * briefly after a server stops: rmSync retries for a while.
 */
function deleteDatabase(dir) {
  for (const target of [dir, `${dir}.lock`]) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: DELETE_RETRIES, retryDelay: RETRY_DELAY_MS });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      throw new Error(`No se pudo borrar ${target} (${code}). ¿Sigue abierta otra app de pruebas en los puertos 3100, 3102 o 3103?`);
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
  const restaurantUrl = process.env.E2E_RESTAURANT_DATABASE_URL;
  const demoDir = databaseDir(demoUrl, "DATABASE_URL");
  const freshDir = databaseDir(freshUrl, "E2E_FRESH_DATABASE_URL");
  const restaurantDir = databaseDir(restaurantUrl, "E2E_RESTAURANT_DATABASE_URL");
  if (new Set([demoDir, freshDir, restaurantDir]).size !== 3) {
    throw new Error("La base de la demo, la vacía y la del restaurante deben ser carpetas distintas.");
  }

  log("Preparando las bases de datos de las pruebas…");
  deleteDatabase(demoDir);
  deleteDatabase(freshDir);
  deleteDatabase(restaurantDir);

  run("pnpm run db:migrate", { DATABASE_URL: demoUrl });
  run("pnpm run seed", { DATABASE_URL: demoUrl, DEMO_MODE: "true" });
  run("pnpm exec tsx --conditions=react-server e2e/support/create-e2e-users.ts", { DATABASE_URL: demoUrl });
  run("pnpm exec tsx --conditions=react-server e2e/support/create-agenda-fixtures.ts", { DATABASE_URL: demoUrl });

  run("pnpm run db:migrate", { DATABASE_URL: freshUrl });

  run("pnpm run db:migrate", { DATABASE_URL: restaurantUrl });
  run("pnpm run seed --sector=restaurante", { DATABASE_URL: restaurantUrl, DEMO_MODE: "true" });
  log("Bases de datos listas: demo en data/e2e-pglite, vacía en data/e2e-fresh-pglite y restaurante en data/e2e-restaurante-pglite.");
}

try {
  main();
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
