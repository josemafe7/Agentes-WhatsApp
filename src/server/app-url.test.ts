import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appUrl,
  assertProductionConfig,
  BASE_URL_OVERRIDE_VARIABLES,
  baseUrlOverridesAllowed,
  getAppUrl,
  isLoopbackAppUrl,
  ProductionConfigError,
  productionConfigProblems,
  productionConfigWarnings,
} from "./app-url";

afterEach(() => vi.unstubAllEnvs());

const PRODUCTION = { NODE_ENV: "production", APP_URL: "https://agentes.mipeluqueria.es", BETTER_AUTH_URL: "https://agentes.mipeluqueria.es" };

describe("public address of the installation", () => {
  it("uses APP_URL without a trailing slash", () => {
    vi.stubEnv("APP_URL", "https://agentes.mipeluqueria.es/");
    expect(getAppUrl()).toBe("https://agentes.mipeluqueria.es");
    expect(appUrl("invitacion/abc")).toBe("https://agentes.mipeluqueria.es/invitacion/abc");
  });

  it("knows when the app runs only on this computer (localhost, 127.0.0.1 or [::1])", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3100", "http://[::1]:3000", "https://localhost:3200"]) {
      expect(isLoopbackAppUrl({ APP_URL: url }), url).toBe(true);
    }
    for (const url of ["https://agentes.mipeluqueria.es", "http://192.168.1.20:3000", "http://localhost.mipeluqueria.es"]) {
      expect(isLoopbackAppUrl({ APP_URL: url }), url).toBe(false);
    }
    // Both addresses count, and without any the app is not «on this computer» on purpose.
    expect(isLoopbackAppUrl({ APP_URL: "http://localhost:3000", BETTER_AUTH_URL: "https://agentes.mipeluqueria.es" })).toBe(false);
    expect(isLoopbackAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "agentes.vercel.app" })).toBe(false);
  });
});

describe("a published app refuses to start with an unsafe configuration", () => {
  it("nothing to say outside production (pnpm dev, tests) or with https addresses", () => {
    expect(productionConfigProblems({ NODE_ENV: "development", APP_URL: "http://localhost:3000", OPENROUTER_BASE_URL: "http://127.0.0.1:3101" })).toEqual([]);
    expect(productionConfigProblems(PRODUCTION)).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "production", APP_URL: "https://agentes.mipeluqueria.es" })).toEqual([]);
  });

  it("needs APP_URL (or BETTER_AUTH_URL) with https://: sign-in links and cookies are built from it", () => {
    const [missing] = productionConfigProblems({ NODE_ENV: "production" });
    expect(missing).toMatch(/APP_URL/);
    expect(missing).toMatch(/https:\/\//);
    for (const value of ["http://agentes.mipeluqueria.es", "http://192.168.1.20:3000", "agentes.mipeluqueria.es", "ftp://x.es", "https://usuario:clave@agentes.es"]) {
      const problems = productionConfigProblems({ ...PRODUCTION, APP_URL: value });
      expect(problems, value).toHaveLength(1);
      expect(problems[0]).toMatch(/^APP_URL /);
      // The value itself is never repeated in the message (it could carry a password).
      expect(problems[0]).not.toContain(value);
    }
    expect(productionConfigProblems({ ...PRODUCTION, BETTER_AUTH_URL: "http://agentes.mipeluqueria.es" })[0]).toMatch(/^BETTER_AUTH_URL /);
  });

  it("the compiled app tried on this computer (pnpm build && pnpm start) starts with http://localhost, and says it only works here", () => {
    for (const host of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      const local = { NODE_ENV: "production", APP_URL: host, BETTER_AUTH_URL: host };
      expect(productionConfigProblems(local), host).toEqual([]);
      const [warning] = productionConfigWarnings(local);
      expect(warning, host).toMatch(/^APP_URL y BETTER_AUTH_URL usa http:\/\/localhost: .*solo se puede usar en este ordenador/);
      expect(warning).not.toContain(host);
    }
    // With https (a published app), in development or in the Playwright servers there is nothing to warn about.
    expect(productionConfigWarnings(PRODUCTION)).toEqual([]);
    expect(productionConfigWarnings({ NODE_ENV: "development", APP_URL: "http://localhost:3000" })).toEqual([]);
    expect(productionConfigWarnings({ NODE_ENV: "production", APP_URL: "http://localhost:3100", E2E_ALLOW_BASE_URL_OVERRIDES: "true" })).toEqual([]);
  });

  it("[HER-14] refuses to let the HTTP tools into the server's own network (ALLOW_LOCAL_HTTP_TOOLS), except in the Playwright servers", () => {
    const [problem] = productionConfigProblems({ ...PRODUCTION, ALLOW_LOCAL_HTTP_TOOLS: "true" });
    expect(problem).toMatch(/ALLOW_LOCAL_HTTP_TOOLS/);
    expect(productionConfigProblems({ ...PRODUCTION, ALLOW_LOCAL_HTTP_TOOLS: "false" })).toEqual([]);
    const playwright = { NODE_ENV: "production", APP_URL: "http://localhost:3100", BETTER_AUTH_URL: "http://localhost:3100", E2E_ALLOW_BASE_URL_OVERRIDES: "true" };
    expect(productionConfigProblems({ ...playwright, ALLOW_LOCAL_HTTP_TOOLS: "true" })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "development", ALLOW_LOCAL_HTTP_TOOLS: "true" })).toEqual([]);
  });

  it("the Playwright flag only counts when the app runs on this computer: a published app with it still refuses both", () => {
    const published = { ...PRODUCTION, E2E_ALLOW_BASE_URL_OVERRIDES: "true" };
    expect(baseUrlOverridesAllowed(published)).toBe(false);
    expect(productionConfigProblems({ ...published, ALLOW_LOCAL_HTTP_TOOLS: "true" })[0]).toMatch(/ALLOW_LOCAL_HTTP_TOOLS/);
    expect(productionConfigProblems({ ...published, OPENROUTER_BASE_URL: "https://proxy.example" })[0]).toMatch(/OPENROUTER_BASE_URL/);
    // One address on this computer is not enough when the other is public.
    expect(baseUrlOverridesAllowed({ NODE_ENV: "production", APP_URL: "http://localhost:3100", BETTER_AUTH_URL: "https://agentes.mipeluqueria.es", E2E_ALLOW_BASE_URL_OVERRIDES: "true" })).toBe(false);
    expect(baseUrlOverridesAllowed({ NODE_ENV: "production", E2E_ALLOW_BASE_URL_OVERRIDES: "true" })).toBe(false);
    expect(baseUrlOverridesAllowed({ NODE_ENV: "production", APP_URL: "http://127.0.0.1:3100", E2E_ALLOW_BASE_URL_OVERRIDES: "true" })).toBe(true);
    // With the flag not honoured, a published app on http://localhost says again that it only works here.
    expect(productionConfigWarnings({ NODE_ENV: "production", APP_URL: "http://localhost:3100", BETTER_AUTH_URL: "https://agentes.mipeluqueria.es", E2E_ALLOW_BASE_URL_OVERRIDES: "true" })).toHaveLength(1);
  });

  it("APP_URL and BETTER_AUTH_URL must be the same address: https for the app with http for the sign-in would leave the cookies without Secure", () => {
    const [problem] = productionConfigProblems({ NODE_ENV: "production", APP_URL: "https://agentes.mipeluqueria.es", BETTER_AUTH_URL: "http://localhost:3000" });
    expect(problem).toMatch(/APP_URL y BETTER_AUTH_URL/);
    expect(problem).not.toContain("mipeluqueria");
    expect(productionConfigProblems({ NODE_ENV: "production", APP_URL: "https://agentes.mipeluqueria.es", BETTER_AUTH_URL: "https://otra.mipeluqueria.es" })[0]).toMatch(/APP_URL y BETTER_AUTH_URL/);
    // The same address, written with or without a slash at the end, is fine.
    expect(productionConfigProblems({ NODE_ENV: "production", APP_URL: "https://agentes.mipeluqueria.es/", BETTER_AUTH_URL: "https://agentes.mipeluqueria.es" })).toEqual([]);
  });

  it("the worker (pnpm worker) follows the rules of a published app whatever NODE_ENV says", () => {
    const unsafe = { APP_URL: "http://agentes.mipeluqueria.es", ALLOW_LOCAL_HTTP_TOOLS: "true", OPENROUTER_BASE_URL: "https://proxy.example" };
    expect(productionConfigProblems(unsafe)).toEqual([]);
    expect(productionConfigProblems(unsafe, { worker: true })).toHaveLength(3);
    expect(productionConfigProblems({ NODE_ENV: "development", ...unsafe }, { worker: true })).toHaveLength(3);
    expect(() => assertProductionConfig({ APP_URL: "http://agentes.mipeluqueria.es" }, { worker: true })).toThrow(ProductionConfigError);
    expect(productionConfigWarnings({ APP_URL: "http://localhost:3000" }, { worker: true })).toHaveLength(1);
    expect(productionConfigProblems({ APP_URL: "https://agentes.mipeluqueria.es" }, { worker: true })).toEqual([]);
  });

  it("refuses to point the external services somewhere else", () => {
    expect(BASE_URL_OVERRIDE_VARIABLES).toEqual([
      "META_GRAPH_BASE_URL",
      "OPENROUTER_BASE_URL",
      "GOOGLE_OAUTH_BASE_URL",
      "GOOGLE_API_BASE_URL",
      "MS_LOGIN_BASE_URL",
      "MS_GRAPH_BASE_URL",
      "MISTRAL_BASE_URL",
      "TELEGRAM_API_BASE_URL",
    ]);
    for (const name of BASE_URL_OVERRIDE_VARIABLES) {
      const problems = productionConfigProblems({ ...PRODUCTION, [name]: "https://proxy.evil.example" });
      expect(problems, name).toHaveLength(1);
      expect(problems[0]).toContain(name);
      expect(problems[0]).not.toContain("evil");
    }
    // Empty means unset.
    expect(productionConfigProblems({ ...PRODUCTION, OPENROUTER_BASE_URL: " " })).toEqual([]);
  });

  it("the Playwright servers (E2E_ALLOW_BASE_URL_OVERRIDES=true) may use the mock server and http://localhost", () => {
    const e2e = {
      NODE_ENV: "production",
      E2E_ALLOW_BASE_URL_OVERRIDES: "true",
      APP_URL: "http://localhost:3100",
      BETTER_AUTH_URL: "http://localhost:3100",
      OPENROUTER_BASE_URL: "http://127.0.0.1:3101/openrouter/api/v1",
      META_GRAPH_BASE_URL: "http://127.0.0.1:3101/meta",
    };
    expect(productionConfigProblems(e2e)).toEqual([]);
    // Only this machine may go without https, even with the flag.
    expect(productionConfigProblems({ ...e2e, APP_URL: "http://agentes.mipeluqueria.es" })[0]).toMatch(/^APP_URL /);
    // Any other value of the flag is not the flag.
    expect(productionConfigProblems({ ...e2e, E2E_ALLOW_BASE_URL_OVERRIDES: "1" }).length).toBeGreaterThan(0);
  });

  it("lists every problem at once, in Spanish", () => {
    const problems = productionConfigProblems({ NODE_ENV: "production", APP_URL: "http://x.es", MISTRAL_BASE_URL: "https://m.example" });
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/tiene que/);
  });
});
