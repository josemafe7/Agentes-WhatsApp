// `pnpm dev`: prepares the installation on the first run ([ARR-02]), starts `next dev` and a local ticker that
// runs the background work every 15 s (docs/decisions/0008). Plain Node, so it starts without tsx; it does not
// use `predev`. Secrets are read from .env.local only to call the cron route, and are never printed.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const TICK_INTERVAL_MS = 15_000;
/** The first call compiles the route in dev mode, which can take a while. */
const TICK_TIMEOUT_MS = 60_000;
/** Time `next dev` gets to stop by itself before its whole process tree is ended. */
const SHUTDOWN_GRACE_MS = 5_000;
const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_URL = "file:./data/local.db";
/** Secrets the setup generates (scripts/lib/env-local.ts); an empty one is filled by running the setup again. */
const REQUIRED_SECRETS = ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET", "CRON_SECRET"];

/**
 * Variables of an env file, or null if it does not exist.
 * @param {string} file
 * @returns {Record<string, string> | null}
 */
export function readEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Absolute path of a local `file:` database URL (relative to `rootDir`), or null for remote or in-memory ones.
 * @param {string} url
 * @param {string} rootDir
 */
export function localDatabaseFile(url, rootDir) {
  if (!url.startsWith("file:") || url.includes(":memory:")) return null;
  if (url.startsWith("file://")) return fileURLToPath(url.split("?")[0]);
  return path.resolve(rootDir, url.slice("file:".length).split("?")[0]);
}

/**
 * Why the installation must be prepared first, or null if it is ready. The process environment wins over
 * .env.local, as in Next.js.
 * @param {string} rootDir
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function setupReason(rootDir, env) {
  const local = readEnvFile(path.join(rootDir, ".env.local"));
  if (!local) return "falta .env.local";
  const emptySecret = REQUIRED_SECRETS.find((name) => !(env[name]?.trim() || local[name]?.trim()));
  if (emptySecret) return `falta ${emptySecret} en .env.local`;
  const url = env.DATABASE_URL?.trim() || local.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const file = localDatabaseFile(url, rootDir);
  if (file && !fs.existsSync(file)) return `falta la base de datos ${path.relative(rootDir, file)}`;
  return null;
}

/**
 * Port of `next dev`: `-p`/`--port` argument, then PORT, then 3000.
 * @param {readonly string[]} args
 * @param {Record<string, string | undefined>} env
 */
export function resolvePort(args, env) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-p" || arg === "--port") && args[i + 1]) return Number(args[i + 1]);
    if (arg.startsWith("--port=")) return Number(arg.slice("--port=".length));
  }
  const fromEnv = Number(env.PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PORT;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * APP_URL and BETTER_AUTH_URL for the port `next dev` really uses. .env.local points them at
 * http://localhost:3000; on another port (`pnpm dev -p 3200`, `PORT=3200`) sign-in would refuse the origin and
 * emailed links would open the wrong port. Only local addresses are adjusted: a tunnel or real domain stays.
 * The process environment wins over .env.local, as in Next.js.
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, string | undefined>} localEnv
 * @param {number} port
 * @returns {Record<string, string>}
 */
export function localUrlOverrides(env, localEnv, port) {
  /** @type {Record<string, string>} */
  const overrides = {};
  for (const name of ["APP_URL", "BETTER_AUTH_URL"]) {
    const value = env[name]?.trim() || localEnv[name]?.trim();
    if (!value || !URL.canParse(value)) continue;
    const url = new URL(value);
    if (!LOCAL_HOSTS.has(url.hostname) || url.port === String(port)) continue;
    url.port = String(port);
    overrides[name] = url.origin;
  }
  return overrides;
}

/**
 * Calls the cron route every `intervalMs` with `Authorization: Bearer <secret>`. Quiet while the server starts;
 * warns once when something goes wrong, never with the secret. Skips a call while the previous one is running.
 * @param {{ url: string; secret: string; intervalMs?: number; fetchImpl?: typeof fetch; warn?: (line: string) => void }} options
 */
export function createTicker({ url, secret, intervalMs = TICK_INTERVAL_MS, fetchImpl = fetch, warn = console.warn }) {
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let running = false;
  let reachedOnce = false;
  let warned = false;

  /** @param {string} line */
  const warnOnce = (line) => {
    if (!warned) warn(line);
    warned = true;
  };

  async function tickOnce() {
    if (running) return;
    running = true;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(TICK_TIMEOUT_MS),
      });
      reachedOnce = true;
      if (response.status === 401) {
        warnOnce("[tick] La app rechaza CRON_SECRET: si lo has cambiado en .env.local, reinicia pnpm dev.");
      } else if (!response.ok) {
        warnOnce(`[tick] El trabajo en segundo plano respondió ${response.status}. Se reintenta cada ${intervalMs / 1000} s.`);
      } else {
        warned = false;
      }
    } catch {
      // Before the first answer the server is still starting: that is expected.
      if (reachedOnce) warnOnce("[tick] No se pudo lanzar el trabajo en segundo plano; se reintenta solo.");
    } finally {
      running = false;
    }
  }

  return {
    tickOnce,
    start() {
      timer ??= setInterval(() => void tickOnce(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * Runs a command with the terminal attached and resolves with its exit code.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<number>}
 */
function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", cwd });
    child.on("error", () => resolve(1));
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

/**
 * Ends a process and its children (on Windows with taskkill: `next dev` starts its own child process).
 * @param {import("node:child_process").ChildProcess} child
 */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(import.meta.url);
  const args = process.argv.slice(2);

  const reason = setupReason(rootDir, process.env);
  if (reason) {
    console.log(`Preparando la instalación (${reason})…`);
    // tsx directly, never `pnpm setup` (a pnpm command that edits PATH). Same flags as `pnpm run setup`.
    const tsxCli = require.resolve("tsx/cli");
    const code = await runNode([tsxCli, "--conditions=react-server", path.join("scripts", "setup.ts")], rootDir);
    if (code !== 0) {
      console.error("La preparación ha fallado: revisa el mensaje de arriba.");
      process.exit(code);
    }
  }

  const port = resolvePort(args, process.env);
  const localEnv = readEnvFile(path.join(rootDir, ".env.local")) ?? {};
  const urls = localUrlOverrides(process.env, localEnv, port);
  const adjusted = urls.APP_URL ?? urls.BETTER_AUTH_URL;
  if (adjusted) console.log(`La app usará ${adjusted} como dirección (APP_URL y BETTER_AUTH_URL siguen al puerto).`);
  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", ...args], { stdio: "inherit", cwd: rootDir, env: { ...process.env, ...urls } });

  const secret = process.env.CRON_SECRET?.trim() || localEnv.CRON_SECRET?.trim();
  const ticker = secret ? createTicker({ url: `http://localhost:${port}/api/cron/tick`, secret }) : null;
  if (ticker) ticker.start();
  else console.warn("[tick] Falta CRON_SECRET en .env.local: el trabajo en segundo plano no se lanzará solo.");

  let stopping = false;
  /** @param {NodeJS.Signals} signal */
  const stop = (signal) => {
    ticker?.stop();
    if (stopping) return killTree(child);
    stopping = true;
    // Ctrl+C reaches `next dev` too (same terminal). Other signals are passed on; on Windows they cannot be.
    if (process.platform !== "win32") child.kill(signal);
    else if (signal !== "SIGINT" && signal !== "SIGBREAK") killTree(child);
    setTimeout(() => killTree(child), SHUTDOWN_GRACE_MS).unref();
  };
  for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"])) {
    if (signal === "SIGBREAK" && process.platform !== "win32") continue;
    process.on(signal, () => stop(signal));
  }

  child.on("error", (error) => {
    ticker?.stop();
    console.error(`No se pudo arrancar next dev: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    ticker?.stop();
    process.exit(stopping ? 0 : signal ? 1 : (code ?? 0));
  });
}

/** True when this file is the script Node was started with (not when a test imports it). */
function isEntryPoint() {
  try {
    return process.argv[1] !== undefined && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) void main();
