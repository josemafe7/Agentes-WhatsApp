// Helpers of `pnpm dev` (scripts/dev.mjs): when to prepare the installation first ([ARR-02]), which port, and the
// local ticker that calls the cron route with CRON_SECRET without ever printing it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTicker, localDatabaseFile, localUrlOverrides, resolvePort, setupReason } from "./dev.mjs";

let rootDir: string;
const SECRETS = "APP_ENCRYPTION_KEY=a\nBETTER_AUTH_SECRET=b\nCRON_SECRET=c\n";

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-dev-"));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("pnpm dev: first-run preparation [ARR-02]", () => {
  it("prepares when .env.local is missing", () => {
    expect(setupReason(rootDir, {})).toContain(".env.local");
  });

  it("prepares when the local database file is missing, and not once it exists", () => {
    fs.writeFileSync(path.join(rootDir, ".env.local"), `DATABASE_URL=file:./data/local.db\n${SECRETS}`);
    expect(setupReason(rootDir, {})).toContain("local.db");
    fs.mkdirSync(path.join(rootDir, "data"));
    fs.writeFileSync(path.join(rootDir, "data", "local.db"), "");
    expect(setupReason(rootDir, {})).toBeNull();
  });

  it("prepares when a secret of .env.local is empty (a hand copy of .env.example), naming it but not its value", () => {
    fs.mkdirSync(path.join(rootDir, "data"));
    fs.writeFileSync(path.join(rootDir, "data", "local.db"), "");
    fs.writeFileSync(path.join(rootDir, ".env.local"), "APP_ENCRYPTION_KEY=abc\nBETTER_AUTH_SECRET=def\nCRON_SECRET=\n");
    expect(setupReason(rootDir, {})).toBe("falta CRON_SECRET en .env.local");
    expect(setupReason(rootDir, { CRON_SECRET: "del-entorno" })).toBeNull();
  });

  it("uses DATABASE_URL from the environment before .env.local, and does not look for a remote database file", () => {
    fs.writeFileSync(path.join(rootDir, ".env.local"), `DATABASE_URL=file:./data/local.db\n${SECRETS}`);
    expect(setupReason(rootDir, { DATABASE_URL: "file:./data/otra.db" })).toContain("otra.db");
    expect(setupReason(rootDir, { DATABASE_URL: "libsql://negocio.turso.io" })).toBeNull();
  });

  it("resolves relative database files against the project folder", () => {
    expect(localDatabaseFile("file:./data/local.db", rootDir)).toBe(path.join(rootDir, "data", "local.db"));
    expect(localDatabaseFile("libsql://x.turso.io", rootDir)).toBeNull();
    expect(localDatabaseFile("file::memory:", rootDir)).toBeNull();
  });
});

describe("pnpm dev: port", () => {
  it("takes -p/--port, then PORT, then 3000", () => {
    expect(resolvePort(["-p", "3055"], { PORT: "4000" })).toBe(3055);
    expect(resolvePort(["--port", "3056"], {})).toBe(3056);
    expect(resolvePort(["--port=3057"], {})).toBe(3057);
    expect(resolvePort([], { PORT: "4000" })).toBe(4000);
    expect(resolvePort([], {})).toBe(3000);
  });
});

describe("pnpm dev: local ticker", () => {
  const SECRET = "secreto-del-cron-de-prueba-0123456789";

  it("calls the cron route with the Bearer secret", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ticker = createTicker({
      url: "http://localhost:3000/api/cron/tick",
      secret: SECRET,
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 202 });
      },
    });
    await ticker.tickOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:3000/api/cron/tick");
    expect(calls[0].init.method).toBe("POST");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("stays quiet while the server starts and warns once, without the secret, when it fails later", async () => {
    const warnings: string[] = [];
    let status: number | "down" = "down";
    const ticker = createTicker({
      url: "http://localhost:3000/api/cron/tick",
      secret: SECRET,
      warn: (line: string) => warnings.push(line),
      fetchImpl: async () => {
        if (status === "down") throw new Error(`connect ECONNREFUSED ${SECRET}`);
        return new Response(null, { status });
      },
    });
    await ticker.tickOnce();
    expect(warnings).toEqual([]);
    status = 401;
    await ticker.tickOnce();
    await ticker.tickOnce();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CRON_SECRET");
    status = "down";
    await ticker.tickOnce();
    expect(warnings.join("\n")).not.toContain(SECRET);
  });

  it("never overlaps two calls", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const ticker = createTicker({
      url: "http://localhost:3000/api/cron/tick",
      secret: SECRET,
      fetchImpl: async () => {
        calls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response(null, { status: 202 });
      },
    });
    const first = ticker.tickOnce();
    await ticker.tickOnce();
    release();
    await first;
    expect(calls).toBe(1);
  });
});

describe("pnpm dev on another port: the local addresses follow it", () => {
  const defaults = { APP_URL: "http://localhost:3000", BETTER_AUTH_URL: "http://localhost:3000" };

  it("points APP_URL and BETTER_AUTH_URL of .env.local at the port really used (sign-in checks the origin)", () => {
    expect(localUrlOverrides({}, defaults, 3200)).toEqual({
      APP_URL: "http://localhost:3200",
      BETTER_AUTH_URL: "http://localhost:3200",
    });
  });

  it("changes nothing on the port of the addresses, for addresses that are not local, or without them", () => {
    expect(localUrlOverrides({}, defaults, 3000)).toEqual({});
    expect(localUrlOverrides({}, { APP_URL: "https://mi-tunel.example", BETTER_AUTH_URL: "https://mi-tunel.example" }, 3200)).toEqual({});
    expect(localUrlOverrides({}, {}, 3200)).toEqual({});
    expect(localUrlOverrides({}, { APP_URL: "no es una url" }, 3200)).toEqual({});
  });

  it("the process environment wins over .env.local, as in Next.js", () => {
    expect(localUrlOverrides({ APP_URL: "https://mi-tunel.example" }, defaults, 3200)).toEqual({ BETTER_AUTH_URL: "http://localhost:3200" });
    expect(localUrlOverrides({ BETTER_AUTH_URL: "http://127.0.0.1:3000" }, {}, 3200)).toEqual({ BETTER_AUTH_URL: "http://127.0.0.1:3200" });
  });
});
