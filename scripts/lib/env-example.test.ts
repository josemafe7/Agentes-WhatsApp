// `.env.example` ([ARR-04]): it explains every variable, carries no secret values, and its example values work as they
// are for a local install. `pnpm run setup` builds `.env.local` from it and only adds the random secrets ([ARR-02],
// scripts/lib/setup.test.ts, which also loads the demo with it).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDatabaseTarget } from "@/db";
import { createFileStorage } from "@/server/adapters/file-storage";
import { productionConfigProblems, productionConfigWarnings } from "@/server/app-url";
import { assertTrustedProxyHopsConfigured } from "@/server/client-ip";
import { assertEncryptionKeyConfigured } from "@/server/crypto";
import { removeWithRetry } from "@/test/remove-with-retry";
import { ensureEnvLocal, GENERATED_SECRETS } from "./env-local";

const EXAMPLE = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
const LINES = EXAMPLE.split(/\r?\n/);
/** `NAME=value`, or `# NAME=value` for an optional variable left commented out. */
const ASSIGNMENT = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/;
const PROSE = /^#\s*\S+(?:\s+\S+){2,}/;

type Variable = { name: string; value: string; active: boolean; comments: string[] };

/** Every variable with the comment block right above it (a group of variables shares the block above the group). */
function variables(): Variable[] {
  const found: Variable[] = [];
  LINES.forEach((line, index) => {
    const match = ASSIGNMENT.exec(line);
    if (!match) return;
    const comments: string[] = [];
    for (let above = index - 1; above >= 0; above--) {
      const text = LINES[above];
      if (!text.startsWith("#")) break;
      if (!ASSIGNMENT.test(text)) comments.unshift(text);
    }
    found.push({ name: match[1], value: match[2].trim(), active: !line.startsWith("#"), comments });
  });
  return found;
}

/** Where a DATABASE_URL leads, with the embedded database's folder as an absolute path. */
function databaseOf(url: string) {
  const target = resolveDatabaseTarget(url);
  return target.kind === "embedded" ? { kind: target.kind, dataDir: path.resolve(target.dataDir) } : target;
}

let tempDir: string | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (tempDir) await removeWithRetry(tempDir);
  tempDir = null;
});

describe(".env.example [ARR-04]", () => {
  it("explains every variable, in Spanish, right above it", () => {
    const all = variables();
    expect(all.length).toBeGreaterThan(15);
    for (const variable of all) {
      expect(variable.comments.some((comment) => PROSE.test(comment)), variable.name).toBe(true);
    }
    // The installation's own variables are all there.
    const names = all.map((variable) => variable.name);
    for (const name of ["DATABASE_URL", "APP_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "APP_ENCRYPTION_KEY", "CRON_SECRET", "SETUP_TOKEN", "DEMO_MODE", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
      expect(names, name).toContain(name);
    }
    // Turso and Vercel Blob are no longer used: their variables are gone.
    for (const name of ["DATABASE_AUTH_TOKEN", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"]) expect(names, name).not.toContain(name);
  });

  it("carries no secret value: every [SECRETO] is empty and nothing looks like a real key", () => {
    const secrets = variables().filter((variable) => variable.comments.some((comment) => comment.includes("[SECRETO]")));
    // The Supabase connection string carries the database password, and the secret key bypasses Row Level Security.
    expect(secrets.map((variable) => variable.name)).toEqual(expect.arrayContaining(["DATABASE_URL", "SUPABASE_SECRET_KEY", "APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET", "CRON_SECRET", "SETUP_TOKEN", "OPENROUTER_API_KEY"]));
    for (const secret of secrets) expect(secret.value, secret.name).toBe("");
    for (const { name, value } of variables()) {
      expect(value, name).not.toMatch(/sk-or-|\bEAA[A-Za-z0-9]{10,}|GOCSPX-|sb_(secret|publishable)_|\beyJ[A-Za-z0-9_-]{10,}|:\/\/[^\s/:@]+:[^\s/@]+@|[A-Za-z0-9+/_-]{32,}/);
    }
  });

  it("its local values work as they are: the embedded database, the demo, http://localhost, files on disk, and the setup only adds the secrets", async () => {
    const values = parseEnv(EXAMPLE);
    // An empty DATABASE_URL is the embedded database (PGlite) in data/pglite, never a server.
    expect(databaseOf(values.DATABASE_URL ?? "")).toEqual({ kind: "embedded", dataDir: path.resolve("data", "pglite") });
    expect(createFileStorage(values).kind).toBe("disk");
    expect(values.DEMO_MODE).toBe("true");
    // In development (`pnpm dev`) and even compiled on this computer (`pnpm build && pnpm start`, with a warning).
    expect(productionConfigProblems({ ...values, NODE_ENV: "development" })).toEqual([]);
    expect(productionConfigProblems({ ...values, NODE_ENV: "production" })).toEqual([]);
    expect(productionConfigWarnings({ ...values, NODE_ENV: "production" })).toHaveLength(1);
    expect(() => assertTrustedProxyHopsConfigured(values)).not.toThrow();

    // The secrets it leaves empty are exactly those the setup generates, and then the app can start.
    const emptyRequired = ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET", "CRON_SECRET"];
    expect(Object.keys(GENERATED_SECRETS).sort()).toEqual(emptyRequired.sort());
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-env-"));
    fs.writeFileSync(path.join(tempDir, ".env.example"), EXAMPLE);
    ensureEnvLocal(tempDir);
    const local = parseEnv(fs.readFileSync(path.join(tempDir, ".env.local"), "utf8"));
    vi.stubEnv("APP_ENCRYPTION_KEY", local.APP_ENCRYPTION_KEY ?? "");
    expect(() => assertEncryptionKeyConfigured()).not.toThrow();
    for (const name of emptyRequired) expect(local[name]?.length ?? 0, name).toBeGreaterThanOrEqual(32);
  });
});
