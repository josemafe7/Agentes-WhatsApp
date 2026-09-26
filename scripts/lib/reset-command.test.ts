// `pnpm db:reset` ([ARR-16]) and `pnpm db:fresh` ([ARR-17]) on this test file's own database file: they delete it
// and create it again (never data/local.db).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { businessSettings, user } from "@/db/schema";
import { getInstallState } from "@/server/demo/install-state";
import { createBusiness, createUser } from "@/test/factories";
import { removeWithRetry } from "@/test/remove-with-retry";
import { DEMO_USERS } from "../../seed";
import { DatabaseInUseError, deleteLocalDatabase, runResetCommand, type ResetMode } from "./reset-command";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase, tableCounts } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true" };
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

beforeEach(async () => {
  expect(process.env.DATABASE_URL).toMatch(/dominia-vitest-/);
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

  it("refuses a database that is not a local file unless --remote-i-know", async () => {
    vi.stubEnv("DATABASE_URL", "libsql://negocio-real.turso.io");
    const { code, out } = await reset("demo", ["--yes"]);
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("--remote-i-know");
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

  it("refuses a database that is not a local file unless --remote-i-know", async () => {
    vi.stubEnv("DATABASE_URL", "libsql://negocio-real.turso.io");
    const { code, out } = await reset("fresh", ["--yes"]);
    expect(code).toBe(1);
    expect(out.errors.join("\n")).toContain("--remote-i-know");
  });
});

describe("deleting the database file", () => {
  it("removes the database with its WAL and shared-memory files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-reset-"));
    const file = path.join(dir, "local.db");
    for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.writeFileSync(`${file}${suffix}`, "x");
    await deleteLocalDatabase(file);
    expect(fs.readdirSync(dir)).toEqual([]);
    await removeWithRetry(dir);
  });

  it.runIf(process.platform === "win32")("a database open in another program is reported in use and kept whole", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-reset-"));
    const file = path.join(dir, "local.db");
    const other = createClient({ url: `file:${file.split(path.sep).join("/")}` });
    await other.execute("CREATE TABLE t (x)");
    await expect(deleteLocalDatabase(file)).rejects.toBeInstanceOf(DatabaseInUseError);
    expect(fs.existsSync(file)).toBe(true);
    other.close();
    await removeWithRetry(dir);
  });
});
