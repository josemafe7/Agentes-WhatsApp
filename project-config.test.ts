// Project configuration that protects production: what Next.js writes to the logs and the Vercel cron.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next.config.ts [SEG-02] [SEG-14]", () => {
  it("never writes Server Function arguments (passwords, keys, codes) to the terminal", () => {
    // Next.js logs every Server Function call with its arguments in development unless this is off.
    const logging = nextConfig.logging;
    expect(logging).not.toBeUndefined();
    expect(logging === false || logging?.serverFunctions === false).toBe(true);
  });
});

describe("next.config.ts: the guides of Ayuda go with the compiled app [AJU-17]", () => {
  it("adds docs/guia-*.md and the start-up checklist to the output of the /ayuda pages", () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {};
    for (const route of ["/ayuda", "/ayuda/*"]) {
      expect(includes[route], route).toEqual(expect.arrayContaining(["./docs/guia-*.md", "./docs/checklist-puesta-en-marcha.md"]));
    }
  });
});

type VercelConfig = { crons?: { path: string; schedule: string }[]; regions?: string[] };

describe("vercel.json (docs/plataforma-despliegue.md, docs/guia-despliegue.md)", () => {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as VercelConfig;

  it("has a daily cron to /api/cron/tick, valid on Hobby: never more often than once a day", () => {
    expect(config.crons).toEqual([{ path: "/api/cron/tick", schedule: expect.any(String) }]);
    for (const cron of config.crons ?? []) {
      const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.schedule.trim().split(/\s+/);
      expect(minute, cron.schedule).toMatch(/^\d+$/);
      expect(hour, cron.schedule).toMatch(/^\d+$/);
      expect([dayOfMonth, month, dayOfWeek], cron.schedule).toEqual(["*", "*", "*"]);
    }
  });

  it("runs the functions in the European Union, next to the database", () => {
    expect(config.regions).toEqual(["dub1"]);
  });
});
