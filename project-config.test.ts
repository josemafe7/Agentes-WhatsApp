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

describe("next.config.ts: security headers [SEG-11]", () => {
  async function headersFor(source: string): Promise<Record<string, string>> {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((entry) => entry.source === source);
    if (!rule) throw new Error(`No headers for ${source}`);
    return Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
  }

  it("every response: no sniffing, no framing, a short referrer, no camera or location, HTTPS remembered, its own window group", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const headers = await headersFor("/:path*");
    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    // The same value the phase-0 e2e check reads on every page (e2e/demo/smoke.spec.ts).
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("no Content-Security-Policy for every route: pages get theirs with a nonce from src/proxy.ts, and two policies would both apply", async () => {
    expect(await headersFor("/:path*")).not.toHaveProperty("Content-Security-Policy");
  });

  it("nothing that would stop the web chat on the business's own site (/widget.js loads there)", async () => {
    const headers = await headersFor("/:path*");
    expect(headers).not.toHaveProperty("Cross-Origin-Resource-Policy");
    expect(headers).not.toHaveProperty("Cross-Origin-Embedder-Policy");
  });

  it("/sw.js: served as JavaScript, never cached, and its own strict policy (Next.js PWA guide)", async () => {
    expect(await headersFor("/sw.js")).toEqual({
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'",
    });
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
