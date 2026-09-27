// `pnpm db:migrate`: which database it migrates and what it says. The environment of the process wins over .env.local
// (the loader every script uses), and a server is named «Supabase» without ever showing its URL or password.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeWithRetry } from "@/test/remove-with-retry";
import { loadLocalEnv } from "./cli";
import { runMigrateCommand } from "./migrate-command";
import { captureOutput } from "./testing";

let rootDir: string;
let envBefore: NodeJS.ProcessEnv;

beforeEach(() => {
  expect(process.env.DATABASE_URL).toMatch(/^pglite:memory#/);
  envBefore = { ...process.env };
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-migrate-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  // loadLocalEnv writes into process.env: put the test environment back.
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
  await removeWithRetry(rootDir);
});

describe("the environment of the scripts (.env.local)", () => {
  it("a DATABASE_URL already in the process wins over .env.local, even when .env.local leaves it empty", () => {
    // `DATABASE_URL="postgresql://…" pnpm db:migrate` next to the usual local .env.local (`DATABASE_URL=`).
    const fromProcess = process.env.DATABASE_URL;
    fs.writeFileSync(path.join(rootDir, ".env.local"), "DATABASE_URL=\nDOMINIA_SOLO_EN_ENV_LOCAL=si\n");
    expect(loadLocalEnv(rootDir)).toBe(true);
    expect(process.env.DATABASE_URL).toBe(fromProcess);
    // What the process does not have still comes from .env.local.
    expect(process.env.DOMINIA_SOLO_EN_ENV_LOCAL).toBe("si");
  });

  it("a variable blanked in the process stays blank (the e2e servers keep Supabase Storage out this way)", () => {
    process.env.SUPABASE_URL = "";
    fs.writeFileSync(path.join(rootDir, ".env.local"), "SUPABASE_URL=https://abcdefghijklmnop.supabase.co\n");
    loadLocalEnv(rootDir);
    expect(process.env.SUPABASE_URL).toBe("");
  });
});

describe("pnpm db:migrate", () => {
  it("brings the database up to date and says which one", async () => {
    const out = captureOutput();
    expect(await runMigrateCommand({ out })).toBe(0);
    expect(out.errors).toEqual([]);
    expect(out.lines).toEqual(["Base de datos al día: la base de datos en memoria."]);
  });

  it("names a server «Supabase» and never shows its URL or password, not even when it fails", async () => {
    // A Postgres server that does not answer: nothing listens on port 1 of this machine.
    vi.stubEnv("DATABASE_URL", "postgresql://postgres.abcdefghijklmnop:secreto-de-prueba@127.0.0.1:1/postgres");
    const out = captureOutput();
    expect(await runMigrateCommand({ out })).toBe(1);
    expect(out.errors[0]).toBe("No se pudieron aplicar las migraciones en la base de datos de Supabase.");
    expect(out.text()).not.toContain("secreto-de-prueba");
    expect(out.text()).not.toContain("postgresql://");
  });
});
