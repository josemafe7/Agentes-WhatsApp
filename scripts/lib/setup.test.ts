// `pnpm run setup` ([ARR-02], [ARR-03], [ARR-17], [ARR-19]) in a temporary project folder. The database is this
// test file's own (DATABASE_URL set by src/test/setup.ts wins over the .env.local being tested).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { FRESH_MARKER_KEY, getInstallState } from "@/server/demo/install-state";
import { setKv } from "@/server/kv";
import { createBusiness, createUser } from "@/test/factories";
import { removeWithRetry } from "@/test/remove-with-retry";
import { runSetup } from "./setup";
import { captureOutput, emptyDatabase, tableCounts } from "./testing";

const EXAMPLE = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
let rootDir: string;
let envBefore: NodeJS.ProcessEnv;

const envLocal = () => path.join(rootDir, ".env.local");
const readEnvLocal = () => fs.readFileSync(envLocal(), "utf8");

beforeEach(async () => {
  // The .env.local under test says DATABASE_URL=file:./data/local.db: make sure the test database wins.
  expect(process.env.DATABASE_URL).toMatch(/dominia-vitest-/);
  envBefore = { ...process.env };
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-setup-"));
  fs.writeFileSync(path.join(rootDir, ".env.example"), EXAMPLE);
  await emptyDatabase();
});

afterEach(async () => {
  // setup loads .env.local into process.env: put the test environment back.
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
  await removeWithRetry(rootDir);
});

describe("pnpm run setup", () => {
  it("[ARR-02] creates .env.local with random secrets and the demo on, the data folder, and loads the demo", async () => {
    const out = captureOutput();
    const result = await runSetup({ rootDir, out });
    expect(result).toEqual({ env: { created: true, filled: [] }, demo: "loaded" });

    const values = parseEnv(readEnvLocal());
    expect(Buffer.from(values.APP_ENCRYPTION_KEY ?? "", "base64")).toHaveLength(32);
    expect(values.BETTER_AUTH_SECRET?.length).toBeGreaterThanOrEqual(32);
    expect(values.CRON_SECRET?.length).toBeGreaterThanOrEqual(32);
    expect(values.DEMO_MODE).toBe("true");
    // Everything else comes from .env.example as it is.
    const example = parseEnv(EXAMPLE);
    for (const [key, value] of Object.entries(example)) {
      if (!["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET", "CRON_SECRET", "DEMO_MODE"].includes(key)) expect(values[key]).toBe(value);
    }
    // The comments of .env.example are kept.
    expect(readEnvLocal()).toContain("[SECRETO]");
    expect(fs.existsSync(path.join(rootDir, "data"))).toBe(true);
    expect(await getInstallState()).toMatchObject({ kind: "demo", sector: "peluqueria" });

    // Secrets are never printed.
    for (const secret of [values.APP_ENCRYPTION_KEY, values.BETTER_AUTH_SECRET, values.CRON_SECRET]) {
      expect(out.text()).not.toContain(secret);
    }
  });

  it("[ARR-02] secrets are different on every installation", async () => {
    await runSetup({ rootDir, out: captureOutput() });
    const first = parseEnv(readEnvLocal());
    fs.rmSync(envLocal());
    await runSetup({ rootDir, out: captureOutput() });
    const second = parseEnv(readEnvLocal());
    expect(second.APP_ENCRYPTION_KEY).not.toBe(first.APP_ENCRYPTION_KEY);
    expect(second.BETTER_AUTH_SECRET).not.toBe(first.BETTER_AUTH_SECRET);
    expect(second.CRON_SECRET).not.toBe(first.CRON_SECRET);
  });

  it("[ARR-03] running it again changes nothing: same secrets, no duplicated data, nothing deleted", async () => {
    await runSetup({ rootDir, out: captureOutput() });
    const envText = readEnvLocal();
    const counts = await tableCounts();
    const users = await db.select({ id: user.id }).from(user);

    const second = await runSetup({ rootDir, out: captureOutput() });
    expect(second).toEqual({ env: { created: false, filled: [] }, demo: "demo" });
    expect(readEnvLocal()).toBe(envText);
    expect(await tableCounts()).toEqual(counts);
    expect(await db.select({ id: user.id }).from(user)).toEqual(users);
  });

  it("[ARR-03] never overwrites a value of an existing .env.local; only fills a missing secret", async () => {
    const mine = [
      "# Mi configuración",
      `APP_ENCRYPTION_KEY=${Buffer.alloc(32, 9).toString("base64")}`,
      "BETTER_AUTH_SECRET=mi-secreto-de-sesiones-que-no-se-toca-0123",
      "CRON_SECRET=",
      "DEMO_MODE=false",
      "OPENROUTER_API_KEY=sk-or-mia",
      "",
    ].join("\n");
    fs.writeFileSync(envLocal(), mine);

    const result = await runSetup({ rootDir, out: captureOutput() });
    expect(result.env).toEqual({ created: false, filled: ["CRON_SECRET"] });
    const text = readEnvLocal();
    const values = parseEnv(text);
    // Every line except the empty CRON_SECRET is exactly as it was.
    const untouched = mine.split("\n").filter((line) => !line.startsWith("CRON_SECRET="));
    for (const line of untouched) expect(text.split("\n")).toContain(line);
    expect(values.CRON_SECRET?.length).toBeGreaterThanOrEqual(32);
    // DEMO_MODE=false: the installation stays empty, without the demo.
    expect(result.demo).toBe("skipped");
    expect(await db.select().from(user)).toHaveLength(0);

    await runSetup({ rootDir, out: captureOutput() });
    expect(readEnvLocal()).toBe(text);
  });

  it("[ARR-17] after pnpm db:fresh the setup leaves the installation empty for the wizard", async () => {
    await setKv(FRESH_MARKER_KEY, true);
    const result = await runSetup({ rootDir, out: captureOutput() });
    expect(result.demo).toBe("fresh");
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("[ARR-19] with a real business the setup migrates and touches nothing else", async () => {
    await createBusiness({ name: "Clínica Real" });
    await createUser("owner", { email: "dueno@clinica.example" });
    const counts = await tableCounts();
    const result = await runSetup({ rootDir, out: captureOutput() });
    expect(result.demo).toBe("real");
    expect(await tableCounts()).toEqual(counts);
  });
});
