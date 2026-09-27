// `pnpm db:reset` ([ARR-16]) and `pnpm db:fresh` ([ARR-17]) on this test file's own database, in memory: they empty it
// and fill it again (never data/pglite). Deleting the folder of an embedded database is tested on its own below.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { businessSettings, user } from "@/db/schema";
import { getInstallState } from "@/server/demo/install-state";
import { createBusiness, createUser } from "@/test/factories";
import { removeWithRetry } from "@/test/remove-with-retry";
import { DEMO_USERS } from "../../seed";
import { DatabaseInUseError, deleteEmbeddedDatabase, runResetCommand, type ResetMode } from "./reset-command";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase, tableCounts } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true" };
/** The shape of a Supabase connection (transaction pooler); never a real one. */
const SUPABASE_URL = "postgresql://postgres.abcdefghijklmnop:secreto-de-prueba@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
const yes = async () => true;
const no = async () => false;

function reset(mode: ResetMode, argv: string[], options: { env?: Record<string, string>; confirm?: () => Promise<boolean> } = {}) {
  const out = captureOutput();
  return runResetCommand(mode, argv, { out, env: options.env ?? DEMO_ENV, confirm: options.confirm ?? yes }).then((code) => ({
    code,
    out,
  }));
}

async function realBusiness() {
  await createBusiness({ name: "Taller Real" });
  await createUser("owner", { email: "dueno@taller.example" });
}

/**
 * An embedded database folder in a temporary folder. Its lock file (`<folder>.lock`, src/db/index.ts) holds the PID of
 * the process that has it open: `lockedBy` writes one.
 */
function embeddedDatabase(lockedBy?: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-reset-"));
  const dataDir = path.join(dir, "pglite");
  fs.mkdirSync(path.join(dataDir, "base", "1"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "PG_VERSION"), "18");
  fs.writeFileSync(path.join(dataDir, "base", "1", "1259"), "x");
  if (lockedBy !== undefined) fs.writeFileSync(`${dataDir}.lock`, String(lockedBy));
  return { dir, dataDir };
}

/** A live process that is not this one: the one that started this test file. */
const OTHER_LIVE_PROCESS = process.ppid;

beforeEach(async () => {
  expect(process.env.DATABASE_URL).toMatch(/^pglite:memory#/);
  await emptyDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pnpm db:reset", () => {
  it("[ARR-16] deletes everything and leaves the demo as newly installed", async () => {
    await realBusiness();
    const { code, out } = await reset("demo", ["--yes"]);
    expect(out.errors).toEqual([]);
    expect(code).toBe(0);
    // It warned that the database held a real business before deleting it.
    expect(out.lines.join("\n")).toContain("negocio real");
    expect(await db.select().from(user).where(eq(user.email, "dueno@taller.example"))).toHaveLength(0);
    expect(await db.select().from(user)).toHaveLength(DEMO_USERS.length);
    expect(await getInstallState()).toMatchObject({ kind: "demo", sector: "peluqueria" });
  });

  it("[ARR-16] --sector chooses the demo that is loaded", async () => {
    const { code } = await reset("demo", ["--yes", "--sector=taller"]);
    expect(code).toBe(0);
    const [settings] = await db.select().from(businessSettings);
    expect(settings.sector).toBe("taller");
  });

  it("asks first: answering no deletes nothing", async () => {
    await realBusiness();
    const before = await tableCounts();
    const { code, out } = await reset("demo", [], { confirm: no });
    expect(code).toBe(1);
    expect(out.lines.join("\n")).toContain("No se ha borrado nada");
    expect(await tableCounts()).toEqual(before);
  });

  it("[ARR-18] refuses without DEMO_MODE=true before deleting anything", async () => {
    await realBusiness();
    const before = await tableCounts();
    const { code, out } = await reset("demo", ["--yes"], { env: {} });
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("DEMO_MODE");
    expect(await tableCounts()).toEqual(before);
  });

  it("[ARR-10] an unknown sector is refused before deleting anything", async () => {
    await realBusiness();
    const before = await tableCounts();
    const { code } = await reset("demo", ["--yes", "--sector=veterinaria"]);
    expect(code).toBe(1);
    expect(await tableCounts()).toEqual(before);
  });

  it("refuses a database on a server (Supabase) unless --remote-i-know, without repeating its URL", async () => {
    vi.stubEnv("DATABASE_URL", SUPABASE_URL);
    const { code, out } = await reset("demo", ["--yes"]);
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("--remote-i-know");
    expect(out.text()).not.toContain("secreto-de-prueba");
  });

  it("refuses Turso (libsql://), no longer used, with the reason and before deleting anything", async () => {
    await realBusiness();
    const before = await tableCounts();
    vi.stubEnv("DATABASE_URL", "libsql://negocio-real.turso.io");
    const { code, out } = await reset("demo", ["--yes", "--remote-i-know"]);
    // Back to this test file's database before querying it (Turso's URL cannot be opened).
    vi.unstubAllEnvs();
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("Turso ya no se usa");
    expect(await tableCounts()).toEqual(before);
  });

  it("refuses while the embedded database is open in another process (pnpm dev or the worker), deleting nothing", async () => {
    const { dir, dataDir } = embeddedDatabase(OTHER_LIVE_PROCESS);
    vi.stubEnv("DATABASE_URL", `pglite:${dataDir}`);
    const { code, out } = await reset("demo", ["--yes"]);
    vi.unstubAllEnvs();
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("está en uso");
    expect(fs.readdirSync(dataDir).sort()).toEqual(["PG_VERSION", "base"]);
    await removeWithRetry(dir);
  });
});

describe("pnpm db:fresh", () => {
  it("[ARR-17] deletes everything and leaves an empty installation, without demo or users, for the wizard", async () => {
    await runSeedCommand([], { env: DEMO_ENV, out: captureOutput() });
    const { code, out } = await reset("fresh", ["--yes"], { env: {} });
    expect(code).toBe(0);
    expect(await db.select().from(user)).toHaveLength(0);
    expect(await getInstallState()).toEqual({ kind: "empty", fresh: true });
    expect(out.lines.join("\n")).toContain("asistente de arranque");
  });

  it("[ARR-17] does not accept demo options", async () => {
    const { code } = await reset("fresh", ["--yes", "--sector=taller"]);
    expect(code).toBe(1);
  });

  it("refuses a database on a server (Supabase) unless --remote-i-know", async () => {
    vi.stubEnv("DATABASE_URL", SUPABASE_URL);
    const { code, out } = await reset("fresh", ["--yes"]);
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("--remote-i-know");
  });
});

describe("deleting the embedded database", () => {
  it("removes its folder and the lock left by a process that has ended (pnpm dev stopped with Ctrl+C)", async () => {
    const ended = spawnSync(process.execPath, ["-e", ""]).pid;
    const { dir, dataDir } = embeddedDatabase(ended);
    deleteEmbeddedDatabase(dataDir);
    expect(fs.readdirSync(dir)).toEqual([]);
    await removeWithRetry(dir);
  });

  it("a database open in another process is reported in use and kept whole", async () => {
    const { dir, dataDir } = embeddedDatabase(OTHER_LIVE_PROCESS);
    expect(() => deleteEmbeddedDatabase(dataDir)).toThrow(DatabaseInUseError);
    expect(fs.readdirSync(dataDir).sort()).toEqual(["PG_VERSION", "base"]);
    expect(fs.existsSync(`${dataDir}.lock`)).toBe(true);
    await removeWithRetry(dir);
  });
});
